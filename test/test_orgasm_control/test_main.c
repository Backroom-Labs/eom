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
    Config.orgasm_chance = 100;

    fake_pressure = 0;
    fake_random = 0;
    fake_random_calls = 0;
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

// ---- After an orgasm

#define RESTING_PRESSURE 1000
#define POST_ORGASM_S 5

// Orgasm mode with an orgasm permitted, the clench detector settled on the resting pressure.
static void permit_orgasm(void) {
    Config.clench_pressure_sensitivity = 200;
    Config.clench_time_to_orgasm_ms = 1000;
    Config.max_clench_duration_ms = 5000;
    fake_pressure = RESTING_PRESSURE;
    orgasm_control_permit_orgasm(POST_ORGASM_S);
    run_s(8);
    TEST_ASSERT_EQUAL_MESSAGE(OC_ORGASM, orgasm_control_get_output_mode(), "mode once permitted");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase before the orgasm");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure before the orgasm");
}

// A clench held past clench_time_to_orgasm_ms: an orgasm, once one is permitted.
static void clench(void) {
    fake_pressure = RESTING_PRESSURE + 1000;
    run_ms(1500);
    fake_pressure = RESTING_PRESSURE;
    run_ms(100);
}

// A clench before the edging time is up isn't an orgasm, then or once one is permitted.
static void test_no_orgasm_is_detected_before_one_is_permitted(void) {
    Config.clench_pressure_sensitivity = 200;
    Config.clench_time_to_orgasm_ms = 1000;
    Config.auto_edging_duration_minutes = 1;
    Config.after_orgasm = AfterOrgasmPost;
    fake_pressure = RESTING_PRESSURE;
    orgasm_control_set_output_mode(OC_ORGASM);
    run_s(8);
    clench();
    run_s(1);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase after the clench");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.session_orgasms, "session orgasms after the clench");

    run_s(60);  // the edging time is up: an orgasm is permitted
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.permit_s, "seconds until permitted");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase once permitted");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.session_orgasms, "session orgasms once permitted");

    clench();
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase after a permitted clench");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.session_orgasms, "session orgasms");
}

static void test_post_orgasm_holds_full_pleasure_then_ramps_down_to_manual(void) {
    Config.after_orgasm = AfterOrgasmPost;
    Config.post_orgasm_menu_lock = true;
    permit_orgasm();
    clench();
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.session_orgasms, "session orgasms");
    TEST_ASSERT_TRUE_MESSAGE(fake_snapshot.menu_locked, "settings locked after the orgasm");

    run_s(POST_ORGASM_S - 1);
    TEST_ASSERT_EQUAL_MESSAGE(255, orgasm_control_get_pleasure(), "pleasure during post-orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase during post-orgasm");

    run_s(4);  // past the post-orgasm time, ramping down
    TEST_ASSERT_LESS_THAN_MESSAGE(255, orgasm_control_get_pleasure(), "pleasure ramping down");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure ramping down");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase ramping down");

    run_s(10);
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure at the end");
    TEST_ASSERT_EQUAL_MESSAGE(OC_MANUAL, orgasm_control_get_output_mode(), "mode at the end");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase at the end");
    TEST_ASSERT_FALSE_MESSAGE(fake_snapshot.menu_locked, "settings locked at the end");
}

static void test_ruin_stops_at_the_orgasm(void) {
    Config.after_orgasm = AfterOrgasmRuin;
    permit_orgasm();
    clench();
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_motor1, "motor after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_MANUAL, orgasm_control_get_output_mode(), "mode after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RUINED, fake_snapshot.phase, "phase after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.session_orgasms, "session orgasms");

    run_s(10);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RUINED, fake_snapshot.phase, "phase 10 s later");

    orgasm_control_set_pleasure(50);
    run_ms(100);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase once pleasure is set");
}

static void test_milking_rests_then_edges_again_up_to_the_orgasm_limit(void) {
    Config.after_orgasm = AfterOrgasmMilking;
    Config.milking_rest_seconds = 20;
    Config.milking_max_orgasms = 2;
    permit_orgasm();

    clench();
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase after orgasm 1");
    run_s(POST_ORGASM_S + 12);  // post-orgasm, then the ramp down
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RESTING, fake_snapshot.phase, "phase after post-orgasm 1");
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure while resting");
    TEST_ASSERT_EQUAL_MESSAGE(OC_ORGASM, orgasm_control_get_output_mode(), "mode while resting");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, fake_snapshot.rest_s, "rest left");
    TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(20, fake_snapshot.rest_s, "rest left");

    run_s(21);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase in round 2");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure in round 2");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.session_orgasms, "session orgasms in round 2");

    run_s(5);
    clench();
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, fake_snapshot.phase, "phase after orgasm 2");
    TEST_ASSERT_EQUAL_MESSAGE(2, fake_snapshot.session_orgasms, "session orgasms");
    run_s(POST_ORGASM_S + 12);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, fake_snapshot.phase, "phase after the last orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_MANUAL, orgasm_control_get_output_mode(), "mode after the last orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure after the last orgasm");
}

// ---- Orgasm chance

#define ROLL_WINS 0   // esp_random() % 100 under any chance above 0
#define ROLL_LOSES 99 // esp_random() % 100 at or over any chance below 100

// Orgasm mode with a one-minute edging time and no denial target, under way.
static void start_orgasm_mode(uint8_t chance) {
    Config.orgasm_chance = chance;
    Config.auto_edging_duration_minutes = 1;
    Config.max_denied = 0;
    orgasm_control_set_output_mode(OC_ORGASM);
    run_s(5);
}

static void test_a_lost_roll_is_a_denial_and_starts_a_full_round(void) {
    fake_random = ROLL_LOSES;
    start_orgasm_mode(50);
    run_s(56);  // the edging time is up
    TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after a lost roll");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials after a lost roll");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.chance_denials, "denials by chance");
    TEST_ASSERT_EQUAL_MESSAGE(0, orgasm_control_get_pleasure(), "pleasure after a lost roll");
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, fake_snapshot.cooldown, "cooldown after a lost roll");
    TEST_ASSERT_INT_WITHIN_MESSAGE(2, 59, fake_snapshot.permit_s, "seconds until permitted in the new round");

    fake_random = ROLL_WINS;
    run_s(55);
    TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted before the new round's edging time");
    run_s(6);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after a won roll");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.permit_s, "seconds until permitted");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.denied, "denials after a won roll");
}

static void test_at_100_percent_an_orgasm_is_permitted_at_the_edging_time(void) {
    fake_random = ROLL_LOSES;
    start_orgasm_mode(100);
    run_s(54);
    TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted a second early");
    TEST_ASSERT_INT_WITHIN_MESSAGE(1, 1, fake_snapshot.permit_s, "seconds until permitted");
    run_ms(900);
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.permit_s, "seconds until permitted, under a second before");
    run_s(2);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted at the edging time");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.permit_s, "seconds until permitted");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.denied, "denials");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.chance_denials, "denials by chance");
}

// An edge, then long enough for the cooldown (edge_delay 2) and minimum_on_time to pass.
static void edge(void) {
    pressure_peak(0, 1500);
    run_s(8);
}

static void test_a_lost_roll_then_max_denied_more_denials_permits_on_a_won_roll(void) {
    Config.edge_delay = 2;
    fake_random = ROLL_LOSES;
    start_orgasm_mode(50);
    Config.auto_edging_duration_minutes = 60;
    Config.max_denied = 2;
    for (int i = 0; i < 3; i++) edge();  // over max_denied: the round's target
    TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after a lost roll");
    TEST_ASSERT_EQUAL_MESSAGE(4, fake_snapshot.denied, "denials after a lost roll");
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_snapshot.chance_denials, "denials by chance");

    fake_random = ROLL_WINS;
    edge();
    TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after 1 more denial");
    edge();
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after 2 more denials");
    TEST_ASSERT_EQUAL_MESSAGE(6, fake_snapshot.denied, "denials once permitted");
}

static void test_at_0_percent_no_orgasm_is_ever_permitted(void) {
    fake_random = ROLL_WINS;
    start_orgasm_mode(0);
    for (int round = 1; round <= 3; round++) {
        for (int s = 0; s < 60; s++) {
            run_s(1);
            TEST_ASSERT_FALSE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted");
        }
        TEST_ASSERT_EQUAL_MESSAGE(round, fake_snapshot.denied, "denials");
        TEST_ASSERT_EQUAL_MESSAGE(round, fake_snapshot.chance_denials, "denials by chance");
    }
}

static void test_the_roll_happens_once_per_round(void) {
    fake_random = ROLL_LOSES;
    start_orgasm_mode(50);
    run_s(56);
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_random_calls, "rolls after round 1");
    run_s(50);
    TEST_ASSERT_EQUAL_MESSAGE(1, fake_random_calls, "rolls during round 2");

    fake_random = ROLL_WINS;
    run_s(15);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted after round 2");
    run_s(30);
    TEST_ASSERT_EQUAL_MESSAGE(2, fake_random_calls, "rolls once permitted");
}

// The roll waits for the next update, but the snapshot is published every tick: until a roll is
// won it never reports 0 seconds, which the app reads as permitted.
static void test_seconds_until_permitted_stay_above_0_until_a_roll_is_won(void) {
    fake_random = ROLL_LOSES;
    start_orgasm_mode(50);
    run_s(54);
    for (int t = 0; t < 2000; t += TICK_MS) {
        run_ms(TICK_MS);
        TEST_ASSERT_GREATER_THAN_MESSAGE(0, fake_snapshot.permit_s, "seconds until permitted");
        TEST_ASSERT_LESS_OR_EQUAL_MESSAGE(60, fake_snapshot.permit_s, "seconds until permitted");
    }
}

static void test_permit_orgasm_permits_at_once_without_a_roll(void) {
    Config.orgasm_chance = 0;
    Config.auto_edging_duration_minutes = 30;
    orgasm_control_permit_orgasm(POST_ORGASM_S);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted");
    run_s(5);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_control_is_permit_orgasm_reached(), "permitted 5 s later");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_random_calls, "rolls");
    TEST_ASSERT_EQUAL_MESSAGE(0, fake_snapshot.denied, "denials");
}

// With no edging time every update is a new round and a lost roll: the counts stop at 255.
static void test_denial_counts_stop_at_255(void) {
    fake_random = ROLL_LOSES;
    start_orgasm_mode(50);
    Config.auto_edging_duration_minutes = 0;
    run_s(15);
    TEST_ASSERT_EQUAL_MESSAGE(255, fake_snapshot.denied, "denials");
    TEST_ASSERT_EQUAL_MESSAGE(255, fake_snapshot.chance_denials, "denials by chance");
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
    RUN_TEST(test_no_orgasm_is_detected_before_one_is_permitted);
    RUN_TEST(test_post_orgasm_holds_full_pleasure_then_ramps_down_to_manual);
    RUN_TEST(test_ruin_stops_at_the_orgasm);
    RUN_TEST(test_milking_rests_then_edges_again_up_to_the_orgasm_limit);
    RUN_TEST(test_a_lost_roll_is_a_denial_and_starts_a_full_round);
    RUN_TEST(test_at_100_percent_an_orgasm_is_permitted_at_the_edging_time);
    RUN_TEST(test_a_lost_roll_then_max_denied_more_denials_permits_on_a_won_roll);
    RUN_TEST(test_at_0_percent_no_orgasm_is_ever_permitted);
    RUN_TEST(test_the_roll_happens_once_per_round);
    RUN_TEST(test_seconds_until_permitted_stay_above_0_until_a_roll_is_won);
    RUN_TEST(test_permit_orgasm_permits_at_once_without_a_roll);
    RUN_TEST(test_denial_counts_stop_at_255);
    return UNITY_END();
}
