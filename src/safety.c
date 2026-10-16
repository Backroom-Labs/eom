#include "safety.h"
#include "config.h"
#include "eom-hal-esp32.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "orgasm_control.h"
#include "system/websocket_handler.h"
#include <stdbool.h>

static const char* TAG = "safety";

// Sensor fault checks, only while an automatic mode runs (it relies on the sensor to detect edges):
// Consecutive failed reads (I2C errors). At 50 Hz this is half a second.
#define SENSOR_READ_FAIL_LIMIT 25
// Pinned at the top of the range. A clench can saturate it, but not for this long.
#define SENSOR_RAIL_MS (10 * 1000)
// The exact same value. A live sensor always has some noise or movement in it; a dead one, or a
// tube that came off, reads a constant.
#define SENSOR_FLAT_MS (30 * 1000)

static struct {
    safety_stop_t reason;
    bool active;
    unsigned long session_start_ms;
    unsigned long last_client_ms;
    unsigned long rail_start_ms;
    unsigned long flat_start_ms;
    uint16_t flat_value;
} state = { 0 };

static unsigned long now_ms(void) {
    return esp_timer_get_time() / 1000UL;
}

static void stop(safety_stop_t reason) {
    static const char* reasons[] = { "", "pressure sensor fault", "all clients disconnected", "session time limit" };
    ESP_LOGW(TAG, "Stopping: %s", reasons[reason]);

    state.reason = reason;
    state.active = false;
    orgasm_control_set_output_mode(OC_MANUAL);
    orgasm_control_set_pleasure(0);
}

static bool sensor_faulty(uint16_t pressure, unsigned long now) {
    if (eom_hal_get_pressure_read_failures() >= SENSOR_READ_FAIL_LIMIT) return true;

    if (pressure < EOM_HAL_PRESSURE_MAX) {
        state.rail_start_ms = now;
    } else if (now - state.rail_start_ms > SENSOR_RAIL_MS) {
        return true;
    }

    if (pressure != state.flat_value) {
        state.flat_value = pressure;
        state.flat_start_ms = now;
    } else if (now - state.flat_start_ms > SENSOR_FLAT_MS) {
        return true;
    }

    return false;
}

void safety_tick(uint16_t pressure) {
    unsigned long now = now_ms();
    bool automatic = orgasm_control_get_output_mode() != OC_MANUAL;
    bool active = automatic || orgasm_control_get_pleasure() > 0;

    if (isConnected || websocket_client_count() > 0) {
        state.last_client_ms = now;
    }

    if (!active) {
        state.active = false;
        return;
    }

    if (!state.active) {
        // Output just started: restart every timer.
        state.active = true;
        state.session_start_ms = now;
        state.last_client_ms = now;
        state.rail_start_ms = now;
        state.flat_start_ms = now;
        state.flat_value = pressure;
    }

    if (automatic && Config.sensor_fault_stop && sensor_faulty(pressure, now)) {
        stop(SAFETY_SENSOR_FAULT);
    } else if (Config.disconnect_stop_s > 0 && now - state.last_client_ms > Config.disconnect_stop_s * 1000UL) {
        stop(SAFETY_DISCONNECTED);
    } else if (Config.max_session_minutes > 0 &&
               now - state.session_start_ms > Config.max_session_minutes * 60UL * 1000UL) {
        stop(SAFETY_SESSION_LIMIT);
    }
}

safety_stop_t safety_get_stop_reason(void) {
    return state.reason;
}

void safety_clear(void) {
    state.reason = SAFETY_OK;
}
