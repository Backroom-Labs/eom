#include "heart_rate.h"
#include "esp_timer.h"

static volatile uint8_t last_bpm = 0;
static volatile unsigned long last_ms = 0;

void heart_rate_set(uint8_t bpm) {
    last_bpm = bpm;
    last_ms = esp_timer_get_time() / 1000UL;
}

uint8_t heart_rate_get(void) {
    if (last_bpm == 0) return 0;
    if (esp_timer_get_time() / 1000UL - last_ms > HEART_RATE_STALE_MS) return 0;
    return last_bpm;
}
