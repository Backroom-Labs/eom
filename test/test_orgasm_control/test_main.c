// orgasm_control tests: the real control loop on a fake clock and pressure sensor.

#include <unity.h>

#include "fakes.h"
#include "orgasm_control.h"

#define TICK_MS 5  // how often main.c calls orgasm_control_tick(), roughly

static void run_ms(long ms) {
    for (long t = 0; t < ms; t += TICK_MS) {
        fake_time_us += TICK_MS * 1000;
        orgasm_control_tick();
    }
}

static void run_s(long s) {
    run_ms(s * 1000);
}

void setUp(void) {
    Config = (config_t){0};
    Config.update_frequency_hz = 30;
    Config.sensitivity_threshold = 1024;
    Config.motor_ramp_time_s = 120;
    Config.initial_pleasure = 10;
    Config.max_pleasure = 255;
    Config.max_motor_output = 255;
    Config.edge_delay = 10;
    Config.minimum_on_time = 1;
    Config.pressure_smoothing = 10;
    Config.vibration_mode = Depletion;

    fake_pressure = 0;
    fake_time_us = 3600LL * 1000000;  // an hour after boot, well past any edge delay
    orgasm_control_init();
    run_s(1);
}

void tearDown(void) {}

// Endless starts at initial_pleasure and ramps, wherever the pleasure was before.
static void assert_endless_ramps_from_initial(void) {
    orgasm_control_set_output_mode(OC_AUTOMATIC);
    run_ms(500);
    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(Config.initial_pleasure + 5, orgasm_control_get_pleasure(),
                                      "pleasure half a second into Endless");
    run_s(60);
    TEST_ASSERT_INT_WITHIN_MESSAGE(15, (10 + 255) / 2, orgasm_control_get_pleasure(),
                                   "pleasure halfway through the ramp");
}

static void test_endless_from_a_fresh_start_ramps(void) {
    assert_endless_ramps_from_initial();
}

static void test_endless_after_a_finished_session_ramps_again(void) {
    orgasm_control_set_output_mode(OC_AUTOMATIC);
    run_s(130);  // ramp all the way up
    TEST_ASSERT_EQUAL(255, orgasm_control_get_pleasure());
    orgasm_control_set_output_mode(OC_MANUAL);
    run_s(2);
    assert_endless_ramps_from_initial();
}

static void test_endless_from_manual_with_the_slider_up_ramps(void) {
    orgasm_control_set_pleasure(200);
    run_s(2);
    assert_endless_ramps_from_initial();
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_endless_from_a_fresh_start_ramps);
    RUN_TEST(test_endless_after_a_finished_session_ramps_again);
    RUN_TEST(test_endless_from_manual_with_the_slider_up_ramps);
    return UNITY_END();
}
