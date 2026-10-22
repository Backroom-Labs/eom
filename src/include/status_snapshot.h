#ifndef __status_snapshot_h
#define __status_snapshot_h

#ifdef __cplusplus
extern "C" {
#endif

#include "cJSON.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// The status snapshot (see GLOSSARY.md): the EOM's state at one moment, as reported to the app.
// orgasm_control publishes one at the end of every tick, so every value in it comes from the same
// tick. Any task can read the latest one and encode it for WebSocket or BLE.

// Raw pressure readings carried in a snapshot. BLE sends all of them; WebSocket the last 8.
#define STATUS_SNAPSHOT_RAW_LEN 16
// Size of the BLE status characteristic value.
#define STATUS_SNAPSHOT_BLE_LEN (30 + 2 * STATUS_SNAPSHOT_RAW_LEN)

typedef struct {
    uint64_t millis;         // milliseconds since boot when the tick published it
    uint16_t pressure;       // last reading, 12-bit
    uint16_t pressure_avg;   // smoothed reading
    uint16_t arousal;
    uint16_t threshold;      // edge threshold
    uint8_t sensitivity;     // sensor sensitivity setting
    uint8_t motor;           // pleasure after the max_pleasure / max_motor_output caps
    uint8_t cooldown;
    uint8_t denied;          // edges denied
    uint8_t mode;            // orgasm_output_mode_t
    const char* mode_name;   // the mode as the WebSocket names it, e.g. "ENDLESS"
    uint8_t vibration_mode;
    uint16_t permit_s;       // seconds until an orgasm is permitted
    bool menu_locked;
    uint8_t safety;          // safety_stop_t
    uint8_t phase;           // oc_after_orgasm_phase_t
    uint8_t session_orgasms;
    uint16_t rest_s;         // seconds left of a Milking rest
    uint16_t baseline;       // resting pressure, same scale as pressure
    uint8_t hr;              // heart rate in use, bpm; 0 = none
    bool hr_waiting;         // the cooldown is waiting for the heart rate to settle
    bool hr_zone;            // heart rate is in the edge zone
    uint8_t led_r, led_g, led_b;
    uint32_t raw_seq;        // readings since boot; the last raw value is reading raw_seq - 1
    uint16_t raw[STATUS_SNAPSHOT_RAW_LEN];  // oldest first; 0 before there were enough readings
} status_snapshot_t;

// Replace the latest snapshot. Only orgasm_control's tick calls this.
void status_snapshot_publish(const status_snapshot_t* snapshot);

// Copy out the latest snapshot (all zeros before the first tick).
void status_snapshot_get(status_snapshot_t* out);

// Whether the Settings lock was on in the latest snapshot. Any task can call this.
bool status_snapshot_settings_locked(void);

// Add the WebSocket "readings" fields to an object.
void status_snapshot_to_json(const status_snapshot_t* snapshot, cJSON* readings);

// Fill the BLE status characteristic value.
void status_snapshot_to_ble(const status_snapshot_t* snapshot, uint8_t out[STATUS_SNAPSHOT_BLE_LEN]);

#ifdef __cplusplus
}
#endif

#endif
