#include "control_command.h"

#include "config.h"
#include "eom-hal-esp32.h"
#include "esp_log.h"
#include "heart_rate.h"
#include "orgasm_control.h"
#include "status_snapshot.h"
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/param.h>

#ifdef EOM_HOST_TEST
// Host tests run on one thread.
#define QUEUE_LOCK()
#define QUEUE_UNLOCK()
#else
#include "freertos/FreeRTOS.h"
static portMUX_TYPE queue_lock = portMUX_INITIALIZER_UNLOCKED;
#define QUEUE_LOCK() portENTER_CRITICAL(&queue_lock)
#define QUEUE_UNLOCK() portEXIT_CRITICAL(&queue_lock)
#endif

static const char* TAG = "control_command";

typedef enum {
    SET_MODE,     // always applied, even if already in that mode (restarts it)
    ENSURE_MODE,  // applied only if the mode differs (BLE control packets repeat the current mode)
    SET_MOTOR,
    TRIGGER_AROUSAL,
    RESET_DENIED,
    HEART_RATE,
    SIM_PRESSURE,
} kind_t;

typedef struct {
    kind_t kind;
    int value;   // mode, motor 1, bpm, or simulated pressure (-1 = the real sensor)
    int motor2;  // SET_MOTOR only: motor 2, or -1 to let it follow motor 1
} command_t;

#define QUEUE_LEN 16
static command_t queue[QUEUE_LEN];
static size_t queue_head = 0;
static size_t queue_count = 0;

// Queue all n commands, or none of them.
static cc_result_t enqueue(const command_t* cmds, size_t n) {
    bool full;
    QUEUE_LOCK();
    full = queue_count + n > QUEUE_LEN;
    if (!full) {
        for (size_t i = 0; i < n; i++) {
            queue[(queue_head + queue_count) % QUEUE_LEN] = cmds[i];
            queue_count++;
        }
    }
    QUEUE_UNLOCK();
    if (full) {
        ESP_LOGW(TAG, "Queue full, dropped %u control command(s)", (unsigned)n);
        return CC_QUEUE_FULL;
    }
    return CC_OK;
}

static void apply(const command_t* c) {
    switch (c->kind) {
    case SET_MODE: orgasm_control_set_output_mode((orgasm_output_mode_t)c->value); break;
    case ENSURE_MODE:
        if (orgasm_control_get_output_mode() != (orgasm_output_mode_t)c->value) {
            orgasm_control_set_output_mode((orgasm_output_mode_t)c->value);
        }
        break;
    case SET_MOTOR:
        if (orgasm_control_get_output_mode() != OC_MANUAL) orgasm_control_set_output_mode(OC_MANUAL);
        orgasm_control_set_pleasure((uint8_t)c->value);
        if (c->motor2 >= 0) orgasm_control_set_motor2((uint8_t)c->motor2);
        break;
    case TRIGGER_AROUSAL: orgasm_control_trigger_arousal(); break;
    case RESET_DENIED: orgasm_control_reset_denied(); break;
    case HEART_RATE: heart_rate_set((uint8_t)c->value); break;
    case SIM_PRESSURE: eom_hal_set_simulated_pressure(c->value); break;
    }
}

void control_command_apply_pending(void) {
    for (;;) {
        command_t c;
        QUEUE_LOCK();
        if (queue_count == 0) {
            QUEUE_UNLOCK();
            return;
        }
        c = queue[queue_head];
        queue_head = (queue_head + 1) % QUEUE_LEN;
        queue_count--;
        QUEUE_UNLOCK();
        apply(&c);
    }
}

// Settings are applied immediately, in the caller's task.
static cc_result_t set_config(const char* key, const char* value) {
    if (!set_config_value(key, value, NULL)) {
        ESP_LOGW(TAG, "Rejected setting %s=%s", key, value);
        return CC_BAD_ARG;
    }
    config_enqueue_save(1);
    return CC_OK;
}

static cc_result_t one(kind_t kind, int value) {
    command_t c = { .kind = kind, .value = value, .motor2 = -1 };
    return enqueue(&c, 1);
}

static cc_result_t bad_arg(const char* what) {
    ESP_LOGW(TAG, "Rejected %s", what);
    return CC_BAD_ARG;
}

static cc_result_t locked(const char* what) {
    ESP_LOGW(TAG, "Settings locked, refused %s", what);
    return CC_LOCKED;
}

// Remotes send percentages; above 100 is treated as 100.
static int percent_to_motor(uint8_t percent) {
    return (int)floor(MIN(percent, 100) * 2.55);
}

cc_result_t control_command_from_ble(const uint8_t* buf, size_t len) {
    if (len == 0) return bad_arg("empty BLE control write");

    switch (buf[0]) {
    case 0x01: {
        // mode, trigger arousal, reset denied, optional motor 1, optional motor 2
        if (len < 4) return bad_arg("short BLE control packet");
        if (buf[1] >= _OC_MODE_MAX) return bad_arg("BLE mode byte");
        command_t cmds[4];
        size_t n = 0;
        bool has_motor = len >= 5;
        // A motor value means manual, whatever the mode byte says.
        int mode = has_motor ? OC_MANUAL : buf[1];
        // Packets repeat the current mode, so only a change to another mode counts as choosing one.
        bool chooses_mode = mode != OC_MANUAL && mode != orgasm_control_get_output_mode();
        if ((chooses_mode || buf[3]) && status_snapshot_settings_locked()) {
            return locked(buf[3] ? "BLE reset denied" : "BLE mode change");
        }
        cmds[n++] = (command_t){ .kind = ENSURE_MODE, .value = mode, .motor2 = -1 };
        if (buf[2]) cmds[n++] = (command_t){ .kind = TRIGGER_AROUSAL, .motor2 = -1 };
        if (buf[3]) cmds[n++] = (command_t){ .kind = RESET_DENIED, .motor2 = -1 };
        if (has_motor) cmds[n++] = (command_t){ .kind = SET_MOTOR, .value = buf[4], .motor2 = len >= 6 ? buf[5] : -1 };
        return enqueue(cmds, n);
    }
    case 0x02: {
        // "name:value", no quotes
        const uint8_t* colon = memchr(buf + 1, ':', len - 1);
        if (colon == NULL || colon == buf + 1) return bad_arg("BLE setting without a name:value");
        if (status_snapshot_settings_locked()) return locked("BLE setting");
        size_t name_len = colon - (buf + 1);
        size_t value_len = len - name_len - 2;
        char name[name_len + 1];
        char value[value_len + 1];
        memcpy(name, buf + 1, name_len);
        name[name_len] = '\0';
        memcpy(value, colon + 1, value_len);
        value[value_len] = '\0';
        return set_config(name, value);
    }
    case 0x05: {
        // Simulated pressure (test builds only): 2 bytes MSB first, 0xFFFF for the real sensor.
        if (len < 3) return bad_arg("short BLE simulated pressure");
        int value = (buf[1] << 8) | buf[2];
        return one(SIM_PRESSURE, value == 0xFFFF ? -1 : value);
    }
    case 0x06:
        // Heart rate in bpm from a sensor the app is connected to, 0 for no reading.
        if (len < 2) return bad_arg("short BLE heart rate");
        return one(HEART_RATE, buf[1]);
    default: return CC_UNKNOWN;
    }
}

cc_result_t control_command_from_remote(const uint8_t* buf, size_t len) {
    if (len == 0) return bad_arg("empty remote write");
    command_t c = {
        .kind = SET_MOTOR,
        .value = percent_to_motor(buf[0]),
        .motor2 = len >= 2 ? percent_to_motor(buf[1]) : -1,
    };
    return enqueue(&c, 1);
}

// One configSet entry as the text set_config_value() expects. Booleans become 1/0.
static cc_result_t set_config_json(const cJSON* item) {
    char text[24];
    if (cJSON_IsBool(item)) return set_config(item->string, cJSON_IsTrue(item) ? "1" : "0");
    if (cJSON_IsNumber(item)) {
        snprintf(text, sizeof(text), "%d", item->valueint);
        return set_config(item->string, text);
    }
    if (cJSON_IsString(item)) return set_config(item->string, item->valuestring);
    return bad_arg("configSet value type");
}

cc_result_t control_command_from_ws(const char* name, const cJSON* value) {
    if (!strcmp(name, "setMode")) {
        if (!cJSON_IsString(value)) return bad_arg("setMode without a mode name");
        orgasm_output_mode_t mode = orgasm_control_str_to_output_mode(value->valuestring);
        if (mode < 0 || mode >= _OC_MODE_MAX) return bad_arg("setMode mode name");
        if (mode != OC_MANUAL && status_snapshot_settings_locked()) return locked("setMode");
        return one(SET_MODE, mode);
    }
    if (!strcmp(name, "setMotor")) {
        if (!cJSON_IsNumber(value) || value->valueint < 0 || value->valueint > 255) return bad_arg("setMotor value");
        return one(SET_MOTOR, value->valueint);
    }
    if (!strcmp(name, "triggerArousal")) return one(TRIGGER_AROUSAL, 0);
    if (!strcmp(name, "resetDenied")) {
        if (status_snapshot_settings_locked()) return locked("resetDenied");
        return one(RESET_DENIED, 0);
    }
    if (!strcmp(name, "heartRate")) {
        if (!cJSON_IsNumber(value)) return bad_arg("heartRate value");
        int bpm = value->valueint;
        return one(HEART_RATE, bpm > 0 && bpm < 256 ? bpm : 0);
    }
    if (!strcmp(name, "simPressure")) {
        if (!cJSON_IsNumber(value)) return bad_arg("simPressure value");
        return one(SIM_PRESSURE, value->valueint);
    }
    if (!strcmp(name, "configSet")) {
        if (!cJSON_IsObject(value)) return bad_arg("configSet without an object");
        if (status_snapshot_settings_locked()) return locked("configSet");
        // Apply every valid entry; report a bad one after trying the rest.
        cc_result_t result = CC_OK;
        const cJSON* item;
        cJSON_ArrayForEach(item, value) {
            if (set_config_json(item) != CC_OK) result = CC_BAD_ARG;
        }
        return result;
    }
    return CC_UNKNOWN;
}
