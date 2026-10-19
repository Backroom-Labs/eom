#pragma once

#include <stdint.h>

// What the pressure sensor reads.
extern uint16_t fake_pressure;
// The clock esp_timer_get_time() reports, in microseconds.
extern int64_t fake_time_us;
// The last speed sent to motor 1.
extern uint8_t fake_motor1;
