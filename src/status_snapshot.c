#include "status_snapshot.h"

#include <string.h>

#ifdef EOM_HOST_TEST
// Host tests run on one thread.
#define SNAPSHOT_LOCK()
#define SNAPSHOT_UNLOCK()
#else
#include "freertos/FreeRTOS.h"
static portMUX_TYPE snapshot_lock = portMUX_INITIALIZER_UNLOCKED;
#define SNAPSHOT_LOCK() portENTER_CRITICAL(&snapshot_lock)
#define SNAPSHOT_UNLOCK() portEXIT_CRITICAL(&snapshot_lock)
#endif

// WebSocket readings go out at ~15 Hz and readings are taken at 50 Hz, so 8 raw values cover the gap.
#define WS_RAW_LEN 8

static status_snapshot_t latest;

void status_snapshot_publish(const status_snapshot_t* snapshot) {
    SNAPSHOT_LOCK();
    latest = *snapshot;
    SNAPSHOT_UNLOCK();
}

void status_snapshot_get(status_snapshot_t* out) {
    SNAPSHOT_LOCK();
    *out = latest;
    SNAPSHOT_UNLOCK();
}

bool status_snapshot_settings_locked(void) {
    bool locked;
    SNAPSHOT_LOCK();
    locked = latest.menu_locked;
    SNAPSHOT_UNLOCK();
    return locked;
}

void status_snapshot_to_json(const status_snapshot_t* s, cJSON* r) {
    cJSON_AddNumberToObject(r, "arousal", s->arousal);
    cJSON_AddNumberToObject(r, "cooldown", s->cooldown);
    cJSON_AddNumberToObject(r, "denied", s->denied);
    cJSON_AddNumberToObject(r, "millis", (double)s->millis);
    cJSON_AddNumberToObject(r, "motor", s->motor);
    cJSON_AddNumberToObject(r, "pavg", s->pressure_avg);
    cJSON_AddNumberToObject(r, "permit", s->permit_s);
    cJSON_AddNumberToObject(r, "pressure", s->pressure);
    cJSON_AddStringToObject(r, "runMode", s->mode_name ? s->mode_name : "");
    cJSON_AddNumberToObject(r, "sensitivity", s->sensitivity);
    cJSON_AddNumberToObject(r, "threshold", s->threshold);
    cJSON_AddBoolToObject(r, "lock", s->menu_locked);
    cJSON_AddNumberToObject(r, "safety", s->safety);
    cJSON_AddNumberToObject(r, "phase", s->phase);
    cJSON_AddNumberToObject(r, "orgasms", s->session_orgasms);
    cJSON_AddNumberToObject(r, "rest", s->rest_s);
    cJSON_AddNumberToObject(r, "baseline", s->baseline);
    cJSON_AddNumberToObject(r, "hr", s->hr);
    cJSON_AddBoolToObject(r, "hrWait", s->hr_waiting);
    cJSON_AddBoolToObject(r, "hrZone", s->hr_zone);
    cJSON_AddNumberToObject(r, "chanceDenials", s->chance_denials);

    // Detailed recording: the last WS_RAW_LEN raw readings. rawSeq counts readings since boot; the
    // last one in raw is number rawSeq - 1.
    cJSON_AddNumberToObject(r, "rawSeq", s->raw_seq);
    cJSON* raw = cJSON_AddArrayToObject(r, "raw");
    for (int i = STATUS_SNAPSHOT_RAW_LEN - WS_RAW_LEN; i < STATUS_SNAPSHOT_RAW_LEN; i++) {
        cJSON_AddItemToArray(raw, cJSON_CreateNumber(s->raw[i]));
    }
}

void status_snapshot_to_ble(const status_snapshot_t* s, uint8_t out[STATUS_SNAPSHOT_BLE_LEN]) {
    uint32_t time = (uint32_t)s->millis;
    const uint8_t head[30] = {
        (uint8_t)(s->pressure >> 4),   // 12-bit (0-4095) scaled to 8-bit
        (uint8_t)(s->arousal >> 4),
        (uint8_t)(s->threshold >> 4),
        s->motor,
        s->cooldown,
        s->denied,
        s->mode,
        s->vibration_mode,
        (uint8_t)(s->permit_s >> 8),   // MSB
        (uint8_t)(s->permit_s & 0xFF), // LSB
        s->led_r,
        s->led_g,
        s->led_b,
        (uint8_t)(time >> 24),
        (uint8_t)(time >> 16),
        (uint8_t)(time >> 8),
        (uint8_t)(time & 0xFF),
        s->menu_locked,
        s->safety,
        s->session_orgasms,
        s->phase,
        (uint8_t)(s->rest_s >> 8),     // MSB
        (uint8_t)(s->rest_s & 0xFF),   // LSB
        (uint8_t)(s->baseline >> 8),   // MSB, full 12-bit resolution
        (uint8_t)(s->baseline & 0xFF), // LSB
        s->hr,                         // bpm the EOM is using, 0 = none
        (uint8_t)((s->hr_waiting ? 0x01 : 0) | (s->hr_zone ? 0x02 : 0)),
        (uint8_t)((s->raw_seq >> 8) & 0xFF), // readings since boot (low 16 bits), MSB
        (uint8_t)(s->raw_seq & 0xFF),        // LSB; the last raw value is number raw_seq - 1
        STATUS_SNAPSHOT_RAW_LEN,             // raw values that follow, oldest first, 2 bytes each
    };
    memcpy(out, head, sizeof(head));
    for (int i = 0; i < STATUS_SNAPSHOT_RAW_LEN; i++) {
        out[30 + 2 * i] = s->raw[i] >> 8;
        out[31 + 2 * i] = s->raw[i] & 0xFF;
    }
    // After the raw values, where apps that predate it don't look.
    out[30 + 2 * STATUS_SNAPSHOT_RAW_LEN] = s->chance_denials;
}
