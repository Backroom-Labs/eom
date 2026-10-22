#include "system/ws_ota.h"
#include "cJSON.h"
#include "esp_log.h"
#include "system/ota.h"
#include "version.h"
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>

static const char* TAG = "ws_ota";

static void notify(uint32_t fd, uint8_t event, esp_err_t err, uint32_t value) {
    static const char* const names[] = {
        [OTA_EVT_READY] = "ready",
        [OTA_EVT_PROGRESS] = "progress",
        [OTA_EVT_RESEND] = "resend",
        [OTA_EVT_RESULT] = "result",
    };
    if (event >= sizeof(names) / sizeof(names[0]) || names[event] == NULL) return;
    char json[96];
    snprintf(
        json,
        sizeof(json),
        "{\"ota\":{\"event\":\"%s\",\"error\":%d,\"value\":%" PRIu32 "}}",
        names[event],
        (int)err,
        value
    );
    if (websocket_send_text((int)fd, json) != ESP_OK) {
        ESP_LOGW(TAG, "Couldn't send event %s", names[event]);
    }
}

static const ota_transport_t transport = {
    .name = "Wi-Fi",
    .notify = notify,
};

static command_err_t cmd_info(cJSON* command, cJSON* response, websocket_client_t* client) {
    cJSON_AddStringToObject(response, "version", EOM_VERSION);
    cJSON_AddStringToObject(response, "board", ota_get_board());
    cJSON_AddNumberToObject(response, "maxSize", (double)ota_max_image_size());
    cJSON_AddBoolToObject(response, "confirmed", ota_firmware_confirmed());
    return CMD_OK;
}

static command_err_t cmd_begin(cJSON* command, cJSON* response, websocket_client_t* client) {
    cJSON* size = cJSON_GetObjectItem(command, "size");
    if (!cJSON_IsNumber(size) || size->valuedouble < 1 || size->valuedouble > SIZE_MAX ||
        size->valuedouble != (double)(size_t)size->valuedouble) {
        return CMD_ARG_ERR;
    }
    bool allow_downgrade = cJSON_IsTrue(cJSON_GetObjectItem(command, "allowDowngrade"));
    // Whatever happens next, including a refusal, reaches the client as events.
    ota_session_begin(&transport, client->fd, (size_t)size->valuedouble, allow_downgrade);
    return CMD_OK;
}

static command_err_t cmd_abort(cJSON* command, cJSON* response, websocket_client_t* client) {
    ota_session_abort(&transport, client->fd);
    return CMD_OK;
}

static const websocket_command_t cmd_info_s = { .command = "otaInfo", .func = &cmd_info };
static const websocket_command_t cmd_begin_s = { .command = "otaBegin", .func = &cmd_begin };
static const websocket_command_t cmd_abort_s = { .command = "otaAbort", .func = &cmd_abort };

void ws_ota_register(void) {
    websocket_register_command(&cmd_info_s);
    websocket_register_command(&cmd_begin_s);
    websocket_register_command(&cmd_abort_s);
}

void ws_ota_on_binary(int fd, const uint8_t* frame, size_t len) {
    if (len <= WS_OTA_OFFSET_LEN) return;
    size_t offset = (size_t)frame[0] | (size_t)frame[1] << 8 | (size_t)frame[2] << 16 | (size_t)frame[3] << 24;
    ota_session_data(&transport, fd, offset, frame + WS_OTA_OFFSET_LEN, len - WS_OTA_OFFSET_LEN);
}

void ws_ota_on_close(int fd) {
    ota_session_abort(&transport, fd);
}
