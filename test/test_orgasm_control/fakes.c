// Fakes for the hardware and modules orgasm_control talks to.
#include "fakes.h"

#include "config.h"
#include "eom-hal-esp32.h"
#include "heart_rate.h"
#include "safety.h"
#include "status_snapshot.h"
#include "system/websocket_handler.h"

uint16_t fake_pressure = 0;
int64_t fake_time_us = 0;
uint8_t fake_motor1 = 0;
uint32_t fake_random = 0;
int fake_random_calls = 0;
status_snapshot_t fake_snapshot;

config_t Config;
bool isConnected = true;
RGBColor rgb_off, rgb_white, rgb_red, rgb_green, rgb_blue, rgb_orange, rgb_yellow, rgb_purple;

int64_t esp_timer_get_time(void) { return fake_time_us; }
uint32_t esp_random(void) {
    fake_random_calls++;
    return fake_random;
}

uint16_t eom_hal_get_pressure_reading(void) { return fake_pressure; }
void eom_hal_init_pressure_sensor(void) {}
void eom_hal_set_motor1_speed(uint8_t speed) { fake_motor1 = speed; }
void eom_hal_set_motor2_speed(uint8_t speed) { (void)speed; }
void eom_hal_set_rgb(uint8_t r, uint8_t g, uint8_t b) { (void)r; (void)g; (void)b; }
void eom_hal_set_rgb_color(RGBColor* color) { (void)color; }
void eom_hal_set_led_flashing(uint8_t flashing) { (void)flashing; }
void eom_hal_set_led_flash_interval(uint16_t interval_ms) { (void)interval_ms; }
RGBColor eom_hal_get_rgb_color() { return rgb_off; }
RGBColor calculate_fade_color(RGBColor a, RGBColor b, float f) { (void)b; (void)f; return a; }

void config_enqueue_save(long save_at_ms) { (void)save_at_ms; }
uint8_t heart_rate_get(void) { return 0; }
void safety_tick(uint16_t pressure) { (void)pressure; }
safety_stop_t safety_get_stop_reason(void) { return (safety_stop_t)0; }
void safety_clear(void) {}
size_t websocket_client_count(void) { return 1; }
void status_snapshot_publish(const status_snapshot_t* snapshot) { fake_snapshot = *snapshot; }
