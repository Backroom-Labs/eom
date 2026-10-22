// orgasm_mode tests: Orgasm mode runs driven through the module's interface, as orgasm_control
// drives them each update.

#include <unity.h>

#include "config.h"
#include "fakes.h"
#include "orgasm_mode.h"

#define UPDATE_MS 33 // 30 Hz
#define ROLL_WINS 0
#define ROLL_LOSES 99

static unsigned long now;
static float pleasure;
static orgasm_mode_output_t output;
static int denials;

// One update, in orgasm_control's order: roll, (orgasm detection), then the after-orgasm mode.
static void update(void) {
    now += UPDATE_MS;
    if (orgasm_mode_roll(now)) {
        orgasm_mode_denied();
        denials++;
    }
    output = orgasm_mode_update(now, &pleasure, fake_increment);
}

static void run_ms(long ms) {
    for (long t = 0; t < ms; t += UPDATE_MS) update();
}

static void run_s(long s) {
    run_ms(s * 1000);
}

static orgasm_mode_status_t status(void) {
    orgasm_mode_status_t s;
    orgasm_mode_status(now, &s);
    return s;
}

// What orgasm_control does on a mode change.
static void set_mode(orgasm_output_mode_t mode) {
    orgasm_mode_set_mode(mode, now);
}

void setUp(void) {
    Config = (config_t){0};
    Config.max_pleasure = 255;
    Config.orgasm_chance = 100;
    Config.auto_edging_duration_minutes = 1;
    Config.post_orgasm_duration_seconds = 5;
    fake_random = ROLL_WINS;
    fake_increment_value = 100;
    fake_increment_calls = 0;
    pleasure = 0;
    denials = 0;
    now += 3600UL * 1000;
    set_mode(OC_MANUAL);
    update(); // Manual takes up post_orgasm_duration_seconds
}

void tearDown(void) {}

// Orgasm mode until its edging time is up and the roll is won.
static void edge_until_permitted(void) {
    set_mode(OC_ORGASM);
    update();
    TEST_ASSERT_FALSE_MESSAGE(orgasm_mode_is_permitted(), "permitted at the start");
    TEST_ASSERT_EQUAL_MESSAGE(60, status().permit_s, "seconds until permitted at the start");
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_EDGING, output, "output while edging");
    run_s(61);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_mode_is_permitted(), "permitted after the edging time");
    TEST_ASSERT_EQUAL_MESSAGE(0, status().permit_s, "seconds until permitted");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, status().phase, "phase once permitted");
}

static void test_once_permitted_pleasure_rises_to_the_maximum(void) {
    edge_until_permitted();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_EDGING, output, "output once permitted");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(100, pleasure, "pleasure: the vibration mode's increment");
    pleasure = 255;
    update();
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(255, pleasure, "pleasure at the maximum");
}

static void test_ruin_stops_at_the_orgasm_until_pleasure_is_set(void) {
    Config.after_orgasm = AfterOrgasmRuin;
    edge_until_permitted();
    orgasm_mode_orgasm_detected();
    update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_STOP, output, "output after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RUINED, status().phase, "phase after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(1, status().session_orgasms, "session orgasms");

    set_mode(OC_MANUAL);
    run_s(10);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RUINED, status().phase, "phase 10 s later");
    orgasm_mode_pleasure_set();
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, status().phase, "phase once pleasure is set");
}

static void test_post_orgasm_holds_full_then_ramps_down_and_stops(void) {
    Config.after_orgasm = AfterOrgasmPost;
    edge_until_permitted();
    orgasm_mode_orgasm_detected();
    update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_POST_ORGASM, output, "output after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_POST_ORGASM, status().phase, "phase after the orgasm");
    TEST_ASSERT_EQUAL_MESSAGE(1, status().session_orgasms, "session orgasms");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(255, pleasure, "pleasure after the orgasm");

    run_s(4);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(255, pleasure, "pleasure 4 s into a 5 s Post-orgasm");
    run_s(2);
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_POST_ORGASM, output, "output ramping down");
    TEST_ASSERT_TRUE_MESSAGE(pleasure < 255 && pleasure > 0, "pleasure ramping down by 1 an update");

    while (output == ORGASM_MODE_POST_ORGASM) update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_STOP, output, "output once ramped down");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0, pleasure, "pleasure at the end");
    set_mode(OC_MANUAL);
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, status().phase, "phase at the end");
}

static void test_permit_starts_post_orgasm_with_its_own_time(void) {
    Config.after_orgasm = AfterOrgasmPost;
    Config.orgasm_chance = 0;
    set_mode(OC_ORGASM);
    orgasm_mode_permit(2, now);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_mode_is_permitted(), "permitted at once");
    orgasm_mode_orgasm_detected();
    update();
    run_s(1);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(255, pleasure, "pleasure 1 s into a 2 s Post-orgasm");
    run_s(2);
    TEST_ASSERT_LESS_THAN_MESSAGE(255, (int)pleasure, "pleasure 3 s in");
}

static void test_milking_rests_then_edges_again_up_to_the_orgasm_limit(void) {
    Config.after_orgasm = AfterOrgasmMilking;
    Config.milking_rest_seconds = 20;
    Config.milking_max_orgasms = 2;
    edge_until_permitted();
    orgasm_mode_orgasm_detected();
    update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_POST_ORGASM, output, "output after orgasm 1");
    while (output == ORGASM_MODE_POST_ORGASM) update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_RESTING, output, "output after Post-orgasm 1");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_RESTING, status().phase, "phase after Post-orgasm 1");
    TEST_ASSERT_EQUAL_MESSAGE(20, status().rest_s, "rest left");

    run_s(10);
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_RESTING, output, "output 10 s into the rest");
    TEST_ASSERT_INT_WITHIN_MESSAGE(1, 10, status().rest_s, "rest left 10 s in");
    while (output == ORGASM_MODE_RESTING) update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_NEXT_ROUND, output, "output once rested");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, status().phase, "phase in round 2");
    TEST_ASSERT_FALSE_MESSAGE(orgasm_mode_is_permitted(), "permitted at the start of round 2");
    TEST_ASSERT_EQUAL_MESSAGE(60, status().permit_s, "seconds until permitted in round 2");
    TEST_ASSERT_EQUAL_MESSAGE(1, status().session_orgasms, "session orgasms in round 2");

    run_s(61);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_mode_is_permitted(), "permitted in round 2");
    orgasm_mode_orgasm_detected();
    update();
    TEST_ASSERT_EQUAL_MESSAGE(2, status().session_orgasms, "session orgasms");
    while (output == ORGASM_MODE_POST_ORGASM) update();
    TEST_ASSERT_EQUAL_MESSAGE(ORGASM_MODE_STOP, output, "output after the last orgasm");
}

static void test_an_orgasm_before_one_is_permitted_is_ignored(void) {
    Config.after_orgasm = AfterOrgasmPost;
    set_mode(OC_ORGASM);
    run_s(10);
    orgasm_mode_orgasm_detected();
    run_s(51);
    TEST_ASSERT_TRUE_MESSAGE(orgasm_mode_is_permitted(), "permitted");
    TEST_ASSERT_EQUAL_MESSAGE(OC_PHASE_NONE, status().phase, "phase once permitted");
    TEST_ASSERT_EQUAL_MESSAGE(0, status().session_orgasms, "session orgasms");
}

static void test_a_lost_roll_denies_and_starts_a_full_round(void) {
    Config.orgasm_chance = 50;
    fake_random = ROLL_LOSES;
    set_mode(OC_ORGASM);
    run_s(61);
    TEST_ASSERT_EQUAL_MESSAGE(1, denials, "denials");
    TEST_ASSERT_EQUAL_MESSAGE(1, status().chance_denials, "denials by chance");
    TEST_ASSERT_FALSE_MESSAGE(orgasm_mode_is_permitted(), "permitted after a lost roll");
    TEST_ASSERT_INT_WITHIN_MESSAGE(1, 59, status().permit_s, "seconds until permitted in round 2");
}

static void test_the_denial_target_ends_a_round(void) {
    Config.auto_edging_duration_minutes = 60;
    Config.max_denied = 2;
    set_mode(OC_ORGASM);
    for (int i = 0; i < 2; i++) orgasm_mode_denied();
    update();
    TEST_ASSERT_FALSE_MESSAGE(orgasm_mode_is_permitted(), "permitted at max_denied");
    orgasm_mode_denied();
    update();
    TEST_ASSERT_TRUE_MESSAGE(orgasm_mode_is_permitted(), "permitted past max_denied");
}

static void test_the_edging_lock_engages_after_2_minutes_and_clears_in_manual(void) {
    Config.edge_menu_lock = true;
    Config.auto_edging_duration_minutes = 30;
    set_mode(OC_ORGASM);
    run_s(119);
    TEST_ASSERT_FALSE_MESSAGE(status().settings_locked, "locked before 2 minutes");
    run_s(2);
    TEST_ASSERT_TRUE_MESSAGE(status().settings_locked, "locked after 2 minutes");

    set_mode(OC_MANUAL);
    TEST_ASSERT_TRUE_MESSAGE(status().settings_locked, "locked until the next update");
    update();
    TEST_ASSERT_FALSE_MESSAGE(status().settings_locked, "locked in Manual");
}

static void test_the_edging_lock_stays_off_in_endless(void) {
    Config.edge_menu_lock = true;
    set_mode(OC_AUTOMATIC);
    run_s(150);
    TEST_ASSERT_FALSE_MESSAGE(status().settings_locked, "locked in Endless");
    TEST_ASSERT_EQUAL_MESSAGE(0, status().permit_s, "seconds until permitted in Endless");
}

static void test_the_post_orgasm_lock_engages_at_the_orgasm_and_clears_at_the_end(void) {
    Config.after_orgasm = AfterOrgasmPost;
    Config.post_orgasm_menu_lock = true;
    edge_until_permitted();
    TEST_ASSERT_FALSE_MESSAGE(status().settings_locked, "locked before the orgasm");
    orgasm_mode_orgasm_detected();
    update();
    TEST_ASSERT_TRUE_MESSAGE(status().settings_locked, "locked after the orgasm");
    while (output == ORGASM_MODE_POST_ORGASM) update();
    TEST_ASSERT_FALSE_MESSAGE(status().settings_locked, "locked at the end");
}

static void test_lock_settings_sets_the_lock(void) {
    orgasm_mode_lock_settings(true);
    TEST_ASSERT_TRUE(status().settings_locked);
    orgasm_mode_lock_settings(false);
    TEST_ASSERT_FALSE(status().settings_locked);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_once_permitted_pleasure_rises_to_the_maximum);
    RUN_TEST(test_ruin_stops_at_the_orgasm_until_pleasure_is_set);
    RUN_TEST(test_post_orgasm_holds_full_then_ramps_down_and_stops);
    RUN_TEST(test_permit_starts_post_orgasm_with_its_own_time);
    RUN_TEST(test_milking_rests_then_edges_again_up_to_the_orgasm_limit);
    RUN_TEST(test_an_orgasm_before_one_is_permitted_is_ignored);
    RUN_TEST(test_a_lost_roll_denies_and_starts_a_full_round);
    RUN_TEST(test_the_denial_target_ends_a_round);
    RUN_TEST(test_the_edging_lock_engages_after_2_minutes_and_clears_in_manual);
    RUN_TEST(test_the_edging_lock_stays_off_in_endless);
    RUN_TEST(test_the_post_orgasm_lock_engages_at_the_orgasm_and_clears_at_the_end);
    RUN_TEST(test_lock_settings_sets_the_lock);
    return UNITY_END();
}
