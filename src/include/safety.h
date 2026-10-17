#ifndef __safety_h
#define __safety_h

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

// Why the safety checks last stopped the session. Sent to the UI (WS readings.safety, BLE status
// byte 18), so keep the values stable.
typedef enum safety_stop {
    SAFETY_OK = 0,
    SAFETY_SENSOR_FAULT = 1,
    SAFETY_DISCONNECTED = 2,
    SAFETY_SESSION_LIMIT = 3,
    SAFETY_HEART_RATE = 4,
} safety_stop_t;

// Runs once per control update with the latest pressure reading. Stops the session (Manual,
// pleasure 0) when the sensor looks broken, every client has gone, the session runs too long, or
// the heart rate stays above hr_max_bpm.
void safety_tick(uint16_t pressure);

safety_stop_t safety_get_stop_reason(void);
// Clears the stop reason; called when the user starts output again.
void safety_clear(void);

#ifdef __cplusplus
}
#endif

#endif
