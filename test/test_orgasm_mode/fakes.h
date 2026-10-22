#pragma once

#include <stdint.h>

// What esp_random() returns.
extern uint32_t fake_random;
// What fake_increment() returns, and how often it was called.
extern float fake_increment_value;
extern int fake_increment_calls;

// Stands in for the vibration mode's increment().
float fake_increment(void);
