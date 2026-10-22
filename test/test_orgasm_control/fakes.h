#pragma once

#include <stdint.h>

#include "status_snapshot.h"

// What the pressure sensor reads.
extern uint16_t fake_pressure;
// The clock esp_timer_get_time() reports, in microseconds.
extern int64_t fake_time_us;
// What esp_random() returns, and how often it was called.
extern uint32_t fake_random;
extern int fake_random_calls;
// The last speed sent to motor 1.
extern uint8_t fake_motor1;
// The last status snapshot orgasm_control published (phase, cooldown, denied and so on).
extern status_snapshot_t fake_snapshot;
