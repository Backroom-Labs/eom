// Host tests only: the suite provides esp_timer_get_time(), usually as a clock it moves by hand.
#pragma once
#include <stdint.h>
int64_t esp_timer_get_time(void);
