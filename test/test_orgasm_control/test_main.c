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
    // An hour on from the last test (the first starts an hour after boot, well past any edge
    // delay). The clock never runs backwards.
    fake_time_us += 3600LL * 1000000;
    orgasm_control_set_output_mode(OC_MANUAL);  // init alone leaves the last test's session running
    orgasm_control_init();
    run_s(30);  // in Manual, long enough for the last test's arousal to fade
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

// Pressure rises by `height` above `rest` and falls back: a contraction worth `height` arousal.
static void pressure_peak(uint16_t rest, uint16_t height) {
    fake_pressure = rest + height;
    run_ms(200);
    fake_pressure = rest;
    run_ms(100);
}

// Endless, running long enough for edges to count (past minimum_on_time).
static void start_endless(void) {
    orgasm_control_set_output_mode(OC_AUTOMATIC);
    run_s(5);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure before the edge");
}

// ---- Edge detection

static void test_arousal_over_the_edge_threshold_is_denied(void) {
    start_endless();
    pressure_peak(0, 1500);  // edge threshold 1024
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure after the edge");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.motor, "motor reported after the edge");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials");
    TEST_ASSERT_EQUAL_MESSAGE(OC_AUTOMATIC, orgasm_control_get_output_mode(), "mode");
}

static void test_arousal_under_the_edge_threshold_is_not_denied(void) {
    start_endless();
    pressure_peak(0, 600);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.denied, "denials");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.cooldown, "cooldown");
}

static void test_each_edge_is_one_more_denial(void) {
    Config.edge_delay = 2;
    start_endless();
    for (int i = 1; i <= 3; i++) {
        pressure_peak(0, 1500);
        TEST_ASSERT_EQUAL_MESSAGE(i, fake_snapshot.denied, "denials");
        run_s(8);  // cooldown over, stimulation back on and past minimum_on_time
    }
}

static void test_ramp_stop_stops_at_an_edge(void) {
    Config.vibration_mode = RampStop;
    start_endless();
    pressure_peak(0, 1500);
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure after the edge");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials");
}

// Enhancement goes the other way: pleasure jumps to the maximum at an edge.
static void test_enhancement_goes_to_max_at_an_edge(void) {
    Config.vibration_mode = Enhancement;
    Config.max_pleasure = 200;
    start_endless();
    pressure_peak(0, 1500);
    TEST_ASSERT_EQUAL_MESSAGE(200, orgasm_control_get_pleasure(), "pleasure after the edge");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials");
}

static void test_no_edge_before_minimum_on_time(void) {
    Config.minimum_on_time = 5;
    orgasm_control_set_output_mode(OC_AUTOMATIC);
    run_s(2);
    pressure_peak(0, 1500);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.denied, "denials");
}

// ---- Cooldown

static void test_stimulation_stays_off_for_the_cooldown_then_resumes(void) {
    Config.edge_delay = 6;
    start_endless();
    pressure_peak(0, 1100);
    TEST_ASSERT_INT_WITHIN_MESSAGE(1, 6, fake_snapshot.cooldown, "cooldown reported after the edge");

    run_s(5);
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure 5 s into a 6 s cooldown");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, fake_snapshot.cooldown, "cooldown 5 s in");

    run_s(2);
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.cooldown, "cooldown after it ran out");
    TEST_ASSERT_INT_WITHIN_MESSAGE(5, Config.initial_pleasure, orgasm_control_get_pleasure(),
                                   "pleasure just after the cooldown");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials");
}

// Arousal still over the edge threshold during the cooldown starts it again, without another denial.
static void test_arousal_during_the_cooldown_extends_it(void) {
    Config.edge_delay = 6;
    start_endless();
    pressure_peak(0, 1500);
    for (int i = 0; i < 5; i++) {  // 10 s of contractions
        run_s(2);
        pressure_peak(0, 1500);
    }
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure 10 s after the edge");
    TEST_ASSERT_INT_WITHIN_MESSAGE(1, 6, fake_snapshot.cooldown, "cooldown after the last contraction");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials");

    run_s(8);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure once arousal has faded");
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_endless_from_a_fresh_start_ramps);
    RUN_TEST(test_endless_after_a_finished_session_ramps_again);
    RUN_TEST(test_endless_from_manual_with_the_slider_up_ramps);
    RUN_TEST(test_arousal_over_the_edge_threshold_is_denied);
    RUN_TEST(test_arousal_under_the_edge_threshold_is_not_denied);
    RUN_TEST(test_each_edge_is_one_more_denial);
    RUN_TEST(test_ramp_stop_stops_at_an_edge);
    RUN_TEST(test_enhancement_goes_to_max_at_an_edge);
    RUN_TEST(test_no_edge_before_minimum_on_time);
    RUN_TEST(test_stimulation_stays_off_for_the_cooldown_then_resumes);
    RUN_TEST(test_arousal_during_the_cooldown_extends_it);
    return UNITY_END();
}
