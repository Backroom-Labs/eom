// Host tests only: the suite provides esp_random(), usually as a roll it sets by hand.
#pragma once
#include <stdint.h>
uint32_t esp_random(void);
