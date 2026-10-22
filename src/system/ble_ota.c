#include "system/ble_ota.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "host/ble_hs.h"
#include "system/ota.h"
#include "system/ota_session.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "ble_ota";

#define OFFSET_LEN 4

uint16_t ble_ota_control_val_handle;
uint16_t ble_ota_data_val_handle;

static void notify(uint32_t conn_handle, uint8_t event, esp_err_t err, uint32_t value) {
    uint8_t msg[9];
    msg[0] = event;
    put_le32(msg + 1, (uint32_t)err);
    put_le32(msg + 5, value);
    struct os_mbuf* om = ble_hs_mbuf_from_flat(msg, sizeof(msg));
    if (om == NULL || ble_gatts_notify_custom(conn_handle, ble_ota_control_val_handle, om) != 0) {
        ESP_LOGW(TAG, "Couldn't send event %d", event);
    }
}

static const ota_transport_t transport = {
    .name = "BLE",
    .notify = notify,
};

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

static int begin(uint16_t conn_handle, const uint8_t* buf, size_t len) {
    if (len < 5) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    // A refusal reaches the client as a RESULT event, so the write itself succeeds.
    if (ota_session_begin(&transport, conn_handle, get_le32(buf + 1), len >= 6 && (buf[5] & 0x01)) == ESP_OK) {
        request_fast_connection(conn_handle);
    }
    return 0;
}

static int read_info(uint16_t conn_handle, struct os_mbuf* om) {
    char json[160];
    int n = snprintf(
        json,
        sizeof(json),
        "{\"version\":\"%s\",\"board\":\"%s\",\"mtu\":%u,\"maxSize\":%zu,\"confirmed\":%s}",
        esp_app_get_description()->version,
        ota_get_board(),
        ble_att_mtu(conn_handle),
        ota_max_image_size(),
        ota_firmware_confirmed() ? "true" : "false"
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
            ota_session_abort(&transport, conn_handle);
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
    if (len <= OFFSET_LEN || len > sizeof(buf) || os_mbuf_copydata(ctxt->om, 0, len, buf) != 0) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    // Writes without response get no reply, so anything unwanted is simply dropped.
    ota_session_data(&transport, conn_handle, get_le32(buf), buf + OFFSET_LEN, len - OFFSET_LEN);
    return 0;
}

void ble_ota_on_disconnect(uint16_t conn_handle) {
    ota_session_abort(&transport, conn_handle);
}
