#include "system/ble_ota.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
#include "system/ota.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "ble_ota";

// Room for a full window plus the chunk that crosses it.
#define RX_BUFFER_SIZE (BLE_OTA_WINDOW + BLE_ATT_ATTR_MAX_LEN)
#define PROGRESS_INTERVAL 4096
// Asks for a resend this often while no data arrives. Writes without response can be lost (some
// centrals drop them when their buffers fill), and then nothing else gets the transfer going again.
#define STALL_RESEND_MS 1000
// Gives up if the client stops sending for this long.
#define IDLE_TIMEOUT_MS (20 * 1000)
#define OFFSET_LEN 4

uint16_t ble_ota_control_val_handle;
uint16_t ble_ota_data_val_handle;

// The NimBLE host task fills rx; update_task() drains it into ota_write(). The lock guards starting
// and ending a session, so the host never writes to a buffer that's being freed.
static SemaphoreHandle_t s_lock;
static struct {
    TaskHandle_t task; // non-NULL while a session runs
    StreamBufferHandle_t rx;
    uint16_t conn_handle;
    size_t image_size;
    bool allow_downgrade;
    volatile bool ready; // partition erased, data is accepted
    volatile bool abort;
    // Only touched by the host task:
    size_t next_offset;
    bool resend_sent; // a RESEND is outstanding, so don't send another for every dropped chunk
} s;

static void notify(uint8_t event, esp_err_t err, uint32_t value) {
    uint8_t msg[9];
    msg[0] = event;
    put_le32(msg + 1, (uint32_t)err);
    put_le32(msg + 5, value);
    struct os_mbuf* om = ble_hs_mbuf_from_flat(msg, sizeof(msg));
    if (om == NULL || ble_gatts_notify_custom(s.conn_handle, ble_ota_control_val_handle, om) != 0) {
        ESP_LOGW(TAG, "Couldn't send event %d", event);
    }
}

// Shorter connection intervals and longer packets speed the transfer up a lot. Both are requests the
// central may turn down. The interval range fits Apple's accessory guidelines.
static void request_fast_connection(uint16_t conn_handle) {
    struct ble_gap_upd_params params = {
        .itvl_min = 12, // 15 ms, in 1.25 ms units
        .itvl_max = 24, // 30 ms
        .latency = 0,
        .supervision_timeout = 400, // 4 s, in 10 ms units
    };
    int rc = ble_gap_update_params(conn_handle, &params);
    if (rc != 0) {
        ESP_LOGW(TAG, "Connection parameter update failed: %d", rc);
    }
    rc = ble_gap_set_data_len(conn_handle, 251, 2120);
    if (rc != 0) {
        ESP_LOGW(TAG, "Data length update failed: %d", rc);
    }
}

static esp_err_t receive_image(void) {
    static uint8_t buf[1024];
    size_t received = 0;
    size_t reported = 0;
    TickType_t last_data = xTaskGetTickCount();
    TickType_t last_resend = last_data;

    while (received < s.image_size) {
        if (s.abort) {
            ESP_LOGW(TAG, "Update cancelled");
            return ESP_FAIL;
        }
        size_t n = xStreamBufferReceive(s.rx, buf, sizeof(buf), pdMS_TO_TICKS(250));
        if (n == 0) {
            TickType_t now = xTaskGetTickCount();
            if (now - last_data > pdMS_TO_TICKS(IDLE_TIMEOUT_MS)) {
                ESP_LOGE(TAG, "No data for %d s, giving up", IDLE_TIMEOUT_MS / 1000);
                return ESP_ERR_TIMEOUT;
            }
            // The buffer is empty, so everything received so far is written and the client should
            // continue from there.
            if (now - last_data > pdMS_TO_TICKS(STALL_RESEND_MS) &&
                now - last_resend > pdMS_TO_TICKS(STALL_RESEND_MS)) {
                ESP_LOGW(TAG, "Stalled at %zu bytes, asking for a resend", received);
                notify(BLE_OTA_EVT_RESEND, ESP_OK, received);
                last_resend = now;
            }
            continue;
        }
        last_data = xTaskGetTickCount();

        esp_err_t err = ota_write(buf, n);
        if (err != ESP_OK) {
            return err;
        }
        received += n;
        if (received - reported >= PROGRESS_INTERVAL || received == s.image_size) {
            notify(BLE_OTA_EVT_PROGRESS, ESP_OK, received);
            reported = received;
        }
    }
    return ota_end();
}

static void end_session(void) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s.ready = false;
    vStreamBufferDelete(s.rx);
    s.rx = NULL;
    s.task = NULL;
    xSemaphoreGive(s_lock);
}

static void update_task(void* arg) {
    esp_err_t err = ota_begin(s.image_size, s.allow_downgrade);
    if (err == ESP_OK) {
        s.ready = true;
        notify(BLE_OTA_EVT_READY, ESP_OK, 0);
        err = receive_image();
        ota_abort(); // no-op unless the image is unfinished
    }
    notify(BLE_OTA_EVT_RESULT, err, 0);
    end_session();

    if (err == ESP_OK) {
        // Let the result notification go out first.
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    }
    vTaskDelete(NULL);
}

static int begin(uint16_t conn_handle, const uint8_t* buf, size_t len) {
    if (len < 5) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s.task != NULL) {
        xSemaphoreGive(s_lock);
        ESP_LOGE(TAG, "An update is already in progress");
        return BLE_OTA_ATT_ERR_BUSY;
    }
    s.rx = xStreamBufferCreate(RX_BUFFER_SIZE, 1);
    if (s.rx == NULL) {
        xSemaphoreGive(s_lock);
        ESP_LOGE(TAG, "Out of memory for the receive buffer");
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    s.conn_handle = conn_handle;
    s.image_size = get_le32(buf + 1);
    s.allow_downgrade = len >= 6 && (buf[5] & 0x01);
    s.ready = false;
    s.abort = false;
    s.next_offset = 0;
    s.resend_sent = false;

    // Erasing the partition takes seconds, so it happens on the update task.
    if (xTaskCreate(update_task, "BLE_OTA", 8 * 1024, NULL, tskIDLE_PRIORITY + 2, &s.task) != pdPASS) {
        vStreamBufferDelete(s.rx);
        s.rx = NULL;
        s.task = NULL;
        xSemaphoreGive(s_lock);
        ESP_LOGE(TAG, "Couldn't start the update task");
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    xSemaphoreGive(s_lock);

    ESP_LOGI(TAG, "Update of %zu bytes requested", s.image_size);
    request_fast_connection(conn_handle);
    return 0;
}

static int read_info(uint16_t conn_handle, struct os_mbuf* om) {
    const esp_partition_t* next = esp_ota_get_next_update_partition(NULL);
    esp_ota_img_states_t state;
    bool confirmed =
        esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) != ESP_OK ||
        state != ESP_OTA_IMG_PENDING_VERIFY;

    char json[160];
    int n = snprintf(
        json,
        sizeof(json),
        "{\"version\":\"%s\",\"board\":\"%s\",\"mtu\":%u,\"maxSize\":%" PRIu32 ",\"confirmed\":%s}",
        esp_app_get_description()->version,
        ota_get_board(),
        ble_att_mtu(conn_handle),
        next != NULL ? next->size : 0,
        confirmed ? "true" : "false"
    );
    return os_mbuf_append(om, json, n) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

int ble_ota_control_access(
    uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt* ctxt, void* arg
) {
    switch (ctxt->op) {
    case BLE_GATT_ACCESS_OP_READ_CHR:
        return read_info(conn_handle, ctxt->om);

    case BLE_GATT_ACCESS_OP_WRITE_CHR: {
        uint8_t buf[8];
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        if (len == 0 || len > sizeof(buf) || os_mbuf_copydata(ctxt->om, 0, len, buf) != 0) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        switch (buf[0]) {
        case BLE_OTA_CMD_BEGIN:
            return begin(conn_handle, buf, len);
        case BLE_OTA_CMD_ABORT:
            if (s.task != NULL && s.conn_handle == conn_handle) {
                s.abort = true;
            }
            return 0;
        default:
            return BLE_ATT_ERR_REQ_NOT_SUPPORTED;
        }
    }

    default:
        return BLE_ATT_ERR_UNLIKELY;
    }
}

int ble_ota_data_access(
    uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt* ctxt, void* arg
) {
    static uint8_t buf[BLE_ATT_ATTR_MAX_LEN];

    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
    if (len <= OFFSET_LEN || len > sizeof(buf)) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }

    // Writes without response get no reply, so anything unwanted is simply dropped.
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s.task != NULL && s.ready && !s.abort && s.conn_handle == conn_handle &&
        os_mbuf_copydata(ctxt->om, 0, len, buf) == 0) {
        size_t offset = get_le32(buf);
        size_t data_len = len - OFFSET_LEN;
        if (offset == s.next_offset && xStreamBufferSpacesAvailable(s.rx) >= data_len) {
            xStreamBufferSend(s.rx, buf + OFFSET_LEN, data_len, 0);
            s.next_offset += data_len;
            s.resend_sent = false;
        } else if (offset == s.next_offset || !s.resend_sent) {
            // Chunks already in flight after a gap are dropped quietly; a retry of the right offset
            // that still doesn't fit is answered every time, so the client can't stall.
            notify(BLE_OTA_EVT_RESEND, ESP_OK, s.next_offset);
            s.resend_sent = true;
        }
    }
    xSemaphoreGive(s_lock);
    return 0;
}

void ble_ota_init(void) {
    s_lock = xSemaphoreCreateMutex();
}

void ble_ota_on_disconnect(uint16_t conn_handle) {
    if (s.task != NULL && s.conn_handle == conn_handle) {
        ESP_LOGW(TAG, "Client disconnected during the update");
        s.abort = true;
    }
}
