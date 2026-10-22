// Fakes for everything ws_ota.c calls: the WebSocket handler, the OTA transfer and ota.h.

#include "fakes.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "system/ota.h"
#include "system/ota_transfer.h"

char fake_log[1024];
char fake_sent[256];
int fake_sent_fd;
bool fake_confirmed;
const ota_transport_t* fake_transport;
const char* EOM_VERSION = "3.8.0-beta.1";

static const websocket_command_t* commands[8];
static size_t command_count;

static void log_call(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    size_t used = strlen(fake_log);
    vsnprintf(fake_log + used, sizeof(fake_log) - used, fmt, args);
    va_end(args);
}

void fake_reset(void) {
    fake_log[0] = '\0';
    fake_sent[0] = '\0';
    fake_sent_fd = -1;
    fake_confirmed = true;
}

void websocket_register_command(const websocket_command_t* command) {
    commands[command_count++] = command;
}

esp_err_t websocket_send_text(int fd, const char* msg) {
    fake_sent_fd = fd;
    snprintf(fake_sent, sizeof(fake_sent), "%s", msg);
    return ESP_OK;
}

char* fake_run(const char* name, const char* json, int fd) {
    websocket_client_t client = { .server = NULL, .fd = fd };
    cJSON* value = cJSON_Parse(json);
    cJSON* response = cJSON_CreateObject();
    for (size_t i = 0; i < command_count; i++) {
        if (strcmp(commands[i]->command, name) == 0) {
            command_err_t err = commands[i]->func(value, response, &client);
            if (err != CMD_OK) cJSON_AddNumberToObject(response, "errno", err);
        }
    }
    char* out = cJSON_PrintUnformatted(response);
    cJSON_Delete(response);
    cJSON_Delete(value);
    return out;
}

esp_err_t ota_transfer_begin(
    const ota_transport_t* transport, uint32_t client, size_t image_size, bool allow_downgrade
) {
    log_call("begin:%u:%zu:%d ", (unsigned)client, image_size, allow_downgrade);
    fake_transport = transport;
    return ESP_OK;
}

void ota_transfer_data(
    const ota_transport_t* transport, uint32_t client, size_t offset, const uint8_t* data, size_t len
) {
    log_call("data:%u:%zu:%zu ", (unsigned)client, offset, len);
}

void ota_transfer_abort(const ota_transport_t* transport, uint32_t client) {
    log_call("abort:%u ", (unsigned)client);
}

const char* ota_get_board(void) {
    return "m5stack_atom_echo";
}

bool ota_firmware_confirmed(void) {
    return fake_confirmed;
}

size_t ota_max_image_size(void) {
    return 1966080;
}
