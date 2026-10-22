#include "system/ota_transfer.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "system/ota.h"
#include "system/ota_rx.h"
#include <inttypes.h>

static const char* TAG = "ota_transfer";

// Room for a full window plus the chunk that crosses it.
#define RX_BUFFER_SIZE (OTA_WINDOW + OTA_MAX_CHUNK)
#define PROGRESS_INTERVAL 4096
// Asks for a resend this often while no data arrives. BLE writes without response can be lost
// (some centrals drop them when their buffers fill), and then nothing else gets the transfer going.
#define STALL_RESEND_MS 1000
// Gives up if the client stops sending for this long.
#define IDLE_TIMEOUT_MS (20 * 1000)

// The transport's task fills rx; update_task() drains it into ota_write(). The lock guards
// starting and ending a transfer and the chunk rule, so a transport never writes to a buffer
// that's being freed.
static SemaphoreHandle_t s_lock;
static struct {
    TaskHandle_t task; // non-NULL while a transfer runs
    StreamBufferHandle_t rx;
    const ota_transport_t* transport;
    uint32_t client;
    size_t image_size;
    bool allow_downgrade;
    volatile bool ready; // partition erased, data is accepted
    volatile bool abort;
    ota_rx_t rx_state; // under s_lock
} s;

static void notify(uint8_t event, esp_err_t err, uint32_t value) {
    s.transport->notify(s.client, event, err, value);
}

static bool is_owner(const ota_transport_t* transport, uint32_t client) {
    return s.task != NULL && s.transport == transport && s.client == client;
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
                notify(OTA_EVT_RESEND, ESP_OK, received);
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
            notify(OTA_EVT_PROGRESS, ESP_OK, received);
            reported = received;
        }
    }
    return ota_end();
}

static void end_transfer(void) {
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
        notify(OTA_EVT_READY, ESP_OK, 0);
        err = receive_image();
        ota_abort(); // no-op unless the image is unfinished
        ESP_LOGI(
            TAG,
            "Heap after the transfer: %" PRIu32 " bytes free, lowest since boot %" PRIu32,
            esp_get_free_heap_size(),
            esp_get_minimum_free_heap_size()
        );
    }
    notify(OTA_EVT_RESULT, err, 0);
    end_transfer();

    if (err == ESP_OK) {
        // Let the result go out first.
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
    }
    vTaskDelete(NULL);
}

esp_err_t ota_transfer_begin(
    const ota_transport_t* transport, uint32_t client, size_t image_size, bool allow_downgrade
) {
    esp_err_t err = ESP_OK;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (s.task != NULL) {
        ESP_LOGE(TAG, "An update is already in progress over %s", s.transport->name);
        err = ESP_ERR_INVALID_STATE;
    } else if ((s.rx = xStreamBufferCreate(RX_BUFFER_SIZE, 1)) == NULL) {
        ESP_LOGE(TAG, "Out of memory for the receive buffer");
        err = ESP_ERR_NO_MEM;
    } else {
        s.transport = transport;
        s.client = client;
        s.image_size = image_size;
        s.allow_downgrade = allow_downgrade;
        s.ready = false;
        s.abort = false;
        ota_rx_reset(&s.rx_state);

        // Erasing the partition takes seconds, so it happens on the update task.
        if (xTaskCreate(update_task, "OTA", 8 * 1024, NULL, tskIDLE_PRIORITY + 2, &s.task) != pdPASS) {
            ESP_LOGE(TAG, "Couldn't start the update task");
            vStreamBufferDelete(s.rx);
            s.rx = NULL;
            s.task = NULL;
            err = ESP_ERR_NO_MEM;
        }
    }
    xSemaphoreGive(s_lock);

    if (err != ESP_OK) {
        transport->notify(client, OTA_EVT_RESULT, err, 0);
        return err;
    }
    ESP_LOGI(TAG, "Update of %zu bytes requested over %s", image_size, transport->name);
    return ESP_OK;
}

void ota_transfer_data(
    const ota_transport_t* transport, uint32_t client, size_t offset, const uint8_t* data, size_t len
) {
    bool resend = false;
    size_t resend_from = 0;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (is_owner(transport, client) && s.ready && !s.abort) {
        switch (ota_rx_chunk(&s.rx_state, offset, len, xStreamBufferSpacesAvailable(s.rx))) {
        case OTA_RX_ACCEPT:
            xStreamBufferSend(s.rx, data, len, 0);
            break;
        case OTA_RX_RESEND:
            resend = true;
            resend_from = s.rx_state.next_offset;
            break;
        case OTA_RX_DROP:
            break;
        }
    }
    xSemaphoreGive(s_lock);
    // Sent outside the lock: a Wi-Fi send can block while the socket is backed up.
    if (resend) transport->notify(client, OTA_EVT_RESEND, ESP_OK, resend_from);
}

void ota_transfer_abort(const ota_transport_t* transport, uint32_t client) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    if (is_owner(transport, client)) {
        ESP_LOGW(TAG, "Update over %s ended by the client", transport->name);
        s.abort = true;
    }
    xSemaphoreGive(s_lock);
}

void ota_transfer_init(void) {
    s_lock = xSemaphoreCreateMutex();
}
