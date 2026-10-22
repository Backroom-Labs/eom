// Fakes for what orgasm_mode reads: the config and the roll.
#include "fakes.h"

#include "config.h"

uint32_t fake_random = 0;
float fake_increment_value = 0;
int fake_increment_calls = 0;

config_t Config;

uint32_t esp_random(void) { return fake_random; }

float fake_increment(void) {
    fake_increment_calls++;
    return fake_increment_value;
}
