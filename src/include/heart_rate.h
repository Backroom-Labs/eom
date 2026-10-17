#ifndef __heart_rate_h
#define __heart_rate_h

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

// Heart rate from a sensor the app is connected to (an O2Ring). The app forwards it about once a
// second over BLE (control 0x06) or WebSocket ({"heartRate": n}). The EOM has no sensor of its own.

// Latest reading in bpm; 0 means no reading.
void heart_rate_set(uint8_t bpm);

// The latest reading, or 0 when there is none or it's older than HEART_RATE_STALE_MS. Every
// heart-rate feature falls back to pressure-only behaviour on 0.
uint8_t heart_rate_get(void);

#define HEART_RATE_STALE_MS 5000

#ifdef __cplusplus
}
#endif

#endif
