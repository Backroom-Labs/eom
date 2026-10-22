// Control command tests: raw transport input in, calls into orgasm_control (faked) out.

#include <string.h>
#include <unity.h>

#include "cJSON.h"
#include "control_command.h"
#include "fakes.h"

#define BLE(...) ble_write((const uint8_t[]){ __VA_ARGS__ }, sizeof((const uint8_t[]){ __VA_ARGS__ }))
#define REMOTE(...) control_command_from_remote((const uint8_t[]){ __VA_ARGS__ }, sizeof((const uint8_t[]){ __VA_ARGS__ }))

static cc_result_t ble_write(const uint8_t* buf, size_t len) {
    return control_command_from_ble(buf, len);
}

static cc_result_t ws(const char* name, const char* json) {
    cJSON* value = json ? cJSON_Parse(json) : NULL;
    cc_result_t result = control_command_from_ws(name, value);
    cJSON_Delete(value);
    return result;
}

static void apply(void) {
    control_command_apply_pending();
}

void setUp(void) {
    apply();  // drop anything a failed test left queued
    fake_reset();
}

void tearDown(void) {}

// --- Motor writes: every transport switches to manual and goes through set_pleasure ----------

static void test_ws_set_motor_waits_for_the_tick(void) {
    TEST_ASSERT_EQUAL(CC_OK, ws("setMotor", "120"));
    TEST_ASSERT_EQUAL_STRING("", fake_log);
    apply();
    TEST_ASSERT_EQUAL_STRING("pleasure:120 ", fake_log);
}

static void test_ws_set_motor_switches_to_manual(void) {
    fake_mode = OC_AUTOMATIC;
    ws("setMotor", "120");
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:120 ", fake_log);
}

static void test_ble_motor_goes_through_set_pleasure(void) {
    // Before: BLE wrote the motor straight to the hardware, skipping max_pleasure.
    fake_mode = OC_AUTOMATIC;
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x01, OC_MANUAL, 0, 0, 200));
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:200 ", fake_log);
}

static void test_ble_motor_means_manual_whatever_the_mode_byte(void) {
    fake_mode = OC_AUTOMATIC;
    BLE(0x01, OC_ORGASM, 0, 0, 90);
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:90 ", fake_log);
}

static void test_ble_motor2_is_capped_through_orgasm_control(void) {
    BLE(0x01, OC_MANUAL, 0, 0, 100, 40);
    apply();
    TEST_ASSERT_EQUAL_STRING("pleasure:100 motor2:40 ", fake_log);
}

static void test_remote_converts_percentages_and_switches_to_manual(void) {
    fake_mode = OC_ORGASM;
    TEST_ASSERT_EQUAL(CC_OK, REMOTE(50, 150));
    apply();
    // 50% -> floor(50 * 2.55) = 127; above 100% counts as 100%, which is 254 (see below).
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:127 motor2:254 ", fake_log);
}

static void test_remote_keeps_the_old_rounding(void) {
    // Same floor(percent * 2.55) as before. The double 2.55 is just below 2.55, so 100% gives 254,
    // not 255, while 20% gives 51.
    REMOTE(100);
    REMOTE(20);
    apply();
    TEST_ASSERT_EQUAL_STRING("pleasure:254 pleasure:51 ", fake_log);
}

static void test_remote_empty_write_is_rejected(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, control_command_from_remote(NULL, 0));
}

// --- BLE control packet ------------------------------------------------------------------------

static void test_ble_control_applies_in_packet_order(void) {
    fake_mode = OC_AUTOMATIC;
    BLE(0x01, OC_ORGASM, 1, 1);
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:2 trigger reset ", fake_log);
}

static void test_ble_control_repeating_the_mode_does_not_restart_it(void) {
    fake_mode = OC_AUTOMATIC;
    BLE(0x01, OC_AUTOMATIC, 1, 0);
    apply();
    TEST_ASSERT_EQUAL_STRING("trigger ", fake_log);
}

static void test_ble_control_rejects_an_unknown_mode(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, BLE(0x01, 7, 0, 0));
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_ble_control_rejects_a_short_packet(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, BLE(0x01, OC_MANUAL, 0));
}

static void test_ble_sim_pressure(void) {
    BLE(0x05, 0x01, 0x23);
    BLE(0x05, 0xFF, 0xFF);
    apply();
    TEST_ASSERT_EQUAL_STRING("sim:291 sim:-1 ", fake_log);
}

static void test_ble_heart_rate(void) {
    BLE(0x06, 72);
    apply();
    TEST_ASSERT_EQUAL_STRING("hr:72 ", fake_log);
}

static void test_ble_other_requests_are_not_control_commands(void) {
    TEST_ASSERT_EQUAL(CC_UNKNOWN, BLE(0x03));
    TEST_ASSERT_EQUAL(CC_UNKNOWN, BLE(0x04));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ble_write(NULL, 0));
}

// --- Settings: applied at once ----------------------------------------------------------------

static void test_ble_setting_is_applied_immediately(void) {
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x02, 'm', 'a', 'x', ':', '2', '0', '0'));
    TEST_ASSERT_EQUAL_STRING("cfg:max=200 save ", fake_log);
}

static void test_ble_setting_value_may_contain_a_colon(void) {
    BLE(0x02, 'u', 'r', 'l', ':', 'a', ':', 'b');
    TEST_ASSERT_EQUAL_STRING("cfg:url=a:b save ", fake_log);
}

static void test_ble_setting_with_an_empty_value(void) {
    BLE(0x02, 'k', ':');
    TEST_ASSERT_EQUAL_STRING("cfg:k= save ", fake_log);
}

static void test_ble_rejected_setting_is_not_saved(void) {
    fake_config_accepts = false;
    TEST_ASSERT_EQUAL(CC_BAD_ARG, BLE(0x02, 'n', 'o', ':', '1'));
    TEST_ASSERT_EQUAL_STRING("cfg:no=1 ", fake_log);
}

static void test_ble_setting_needs_a_name(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, BLE(0x02, 'n', 'o', 'c', 'o', 'l', 'o', 'n'));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, BLE(0x02, ':', '1'));
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_ws_config_set_converts_each_value_to_text(void) {
    TEST_ASSERT_EQUAL(CC_OK, ws("configSet", "{\"a\":7,\"b\":true,\"c\":false,\"d\":\"EOM\"}"));
    TEST_ASSERT_EQUAL_STRING("cfg:a=7 save cfg:b=1 save cfg:c=0 save cfg:d=EOM save ", fake_log);
}

static void test_ws_config_set_reports_a_bad_entry_but_applies_the_rest(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("configSet", "{\"a\":[1],\"b\":2}"));
    TEST_ASSERT_EQUAL_STRING("cfg:b=2 save ", fake_log);
}

static void test_ws_config_set_needs_an_object(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("configSet", "3"));
}

// --- Other WebSocket commands -----------------------------------------------------------------

static void test_ws_set_mode_always_applies(void) {
    // Over WebSocket, choosing the current mode restarts it (unlike a BLE control packet).
    fake_mode = OC_AUTOMATIC;
    TEST_ASSERT_EQUAL(CC_OK, ws("setMode", "\"endless\""));
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:1 ", fake_log);
}

static void test_ws_set_mode_rejects_bad_input(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMode", "\"turbo\""));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMode", "1"));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMode", NULL));
}

static void test_ws_set_motor_rejects_out_of_range(void) {
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMotor", "256"));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMotor", "-1"));
    TEST_ASSERT_EQUAL(CC_BAD_ARG, ws("setMotor", "\"fast\""));
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_ws_trigger_reset_heart_rate_and_sim_pressure(void) {
    ws("triggerArousal", NULL);
    ws("resetDenied", NULL);
    ws("heartRate", "72");
    ws("heartRate", "300");
    ws("simPressure", "-1");
    apply();
    TEST_ASSERT_EQUAL_STRING("trigger reset hr:72 hr:0 sim:-1 ", fake_log);
}

static void test_ws_unknown_name(void) {
    TEST_ASSERT_EQUAL(CC_UNKNOWN, ws("restart", NULL));
}

// --- Settings lock: settings and mode choices are refused, stopping and data are not ----------

static void test_locked_ws_config_set_changes_nothing(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, ws("configSet", "{\"max_pleasure\":255}"));
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_locked_ws_set_mode_refuses_endless_and_orgasm(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, ws("setMode", "\"endless\""));
    TEST_ASSERT_EQUAL(CC_LOCKED, ws("setMode", "\"orgasm\""));  // would restart it
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_locked_ws_stop_is_accepted(void) {
    // The app's Stop: Manual, then motor 0. Switching to Manual is what ends the lock.
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_OK, ws("setMode", "\"manual\""));
    TEST_ASSERT_EQUAL(CC_OK, ws("setMotor", "0"));
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:0 ", fake_log);
}

static void test_locked_ws_reset_denied_is_refused(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, ws("resetDenied", NULL));
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_locked_ws_trigger_heart_rate_and_sim_pressure_are_accepted(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_OK, ws("triggerArousal", NULL));
    TEST_ASSERT_EQUAL(CC_OK, ws("heartRate", "72"));
    TEST_ASSERT_EQUAL(CC_OK, ws("simPressure", "1200"));
    apply();
    TEST_ASSERT_EQUAL_STRING("trigger hr:72 sim:1200 ", fake_log);
}

static void test_locked_ble_setting_is_refused(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, BLE(0x02, 'a', ':', '1'));
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_locked_ble_control_refuses_endless_and_reset(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, BLE(0x01, OC_AUTOMATIC, 0, 0));
    TEST_ASSERT_EQUAL(CC_LOCKED, BLE(0x01, OC_ORGASM, 0, 1));
    // The whole packet is refused, including the trigger next to the reset.
    TEST_ASSERT_EQUAL(CC_LOCKED, BLE(0x01, OC_ORGASM, 1, 1));
    apply();
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_locked_ble_control_refuses_orgasm_from_another_mode(void) {
    // The lock only ends in Manual, but don't rely on that: choosing a mode is refused.
    fake_mode = OC_AUTOMATIC;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_LOCKED, BLE(0x01, OC_ORGASM, 0, 0));
}

static void test_locked_ble_trigger_repeating_the_mode_is_accepted(void) {
    // The app's Bluetooth "trigger edge" repeats the current mode, which changes nothing.
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x01, OC_ORGASM, 1, 0));
    apply();
    TEST_ASSERT_EQUAL_STRING("trigger ", fake_log);
}

static void test_locked_ble_stop_heart_rate_and_sim_pressure_are_accepted(void) {
    fake_mode = OC_ORGASM;
    fake_settings_locked = true;
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x01, OC_MANUAL, 0, 0));
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x01, OC_MANUAL, 0, 0, 0));
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x06, 72));
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x05, 0x04, 0xB0));
    apply();
    TEST_ASSERT_EQUAL_STRING("mode:0 pleasure:0 hr:72 sim:1200 ", fake_log);
}

static void test_unlocked_everything_is_accepted(void) {
    fake_mode = OC_ORGASM;
    TEST_ASSERT_EQUAL(CC_OK, ws("configSet", "{\"a\":1}"));
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x02, 'b', ':', '2'));
    TEST_ASSERT_EQUAL(CC_OK, ws("resetDenied", NULL));
    TEST_ASSERT_EQUAL(CC_OK, BLE(0x01, OC_AUTOMATIC, 0, 1));
    TEST_ASSERT_EQUAL(CC_OK, ws("setMode", "\"orgasm\""));
    apply();
    TEST_ASSERT_EQUAL_STRING("cfg:a=1 save cfg:b=2 save reset mode:1 reset mode:2 ", fake_log);
}

// --- Queue ------------------------------------------------------------------------------------

static void test_full_queue_drops_new_commands(void) {
    for (int i = 0; i < 16; i++) TEST_ASSERT_EQUAL(CC_OK, BLE(0x06, i));
    TEST_ASSERT_EQUAL(CC_QUEUE_FULL, BLE(0x06, 99));
    apply();
    TEST_ASSERT_EQUAL_STRING(
        "hr:0 hr:1 hr:2 hr:3 hr:4 hr:5 hr:6 hr:7 hr:8 hr:9 hr:10 hr:11 hr:12 hr:13 hr:14 hr:15 ", fake_log
    );
}

static void test_a_packet_is_queued_whole_or_not_at_all(void) {
    for (int i = 0; i < 14; i++) BLE(0x06, 1);
    // Mode, trigger, reset and motor need 4 places; only 2 are free.
    TEST_ASSERT_EQUAL(CC_QUEUE_FULL, BLE(0x01, OC_MANUAL, 1, 1, 50));
    apply();
    TEST_ASSERT_NULL(strstr(fake_log, "trigger"));
}

static void test_the_queue_works_after_wrapping_around(void) {
    for (int round = 0; round < 3; round++) {
        for (int i = 0; i < 10; i++) BLE(0x06, 1);
        apply();
    }
    fake_reset();
    BLE(0x06, 5);
    apply();
    TEST_ASSERT_EQUAL_STRING("hr:5 ", fake_log);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_ws_set_motor_waits_for_the_tick);
    RUN_TEST(test_ws_set_motor_switches_to_manual);
    RUN_TEST(test_ble_motor_goes_through_set_pleasure);
    RUN_TEST(test_ble_motor_means_manual_whatever_the_mode_byte);
    RUN_TEST(test_ble_motor2_is_capped_through_orgasm_control);
    RUN_TEST(test_remote_converts_percentages_and_switches_to_manual);
    RUN_TEST(test_remote_keeps_the_old_rounding);
    RUN_TEST(test_remote_empty_write_is_rejected);
    RUN_TEST(test_ble_control_applies_in_packet_order);
    RUN_TEST(test_ble_control_repeating_the_mode_does_not_restart_it);
    RUN_TEST(test_ble_control_rejects_an_unknown_mode);
    RUN_TEST(test_ble_control_rejects_a_short_packet);
    RUN_TEST(test_ble_sim_pressure);
    RUN_TEST(test_ble_heart_rate);
    RUN_TEST(test_ble_other_requests_are_not_control_commands);
    RUN_TEST(test_ble_setting_is_applied_immediately);
    RUN_TEST(test_ble_setting_value_may_contain_a_colon);
    RUN_TEST(test_ble_setting_with_an_empty_value);
    RUN_TEST(test_ble_rejected_setting_is_not_saved);
    RUN_TEST(test_ble_setting_needs_a_name);
    RUN_TEST(test_ws_config_set_converts_each_value_to_text);
    RUN_TEST(test_ws_config_set_reports_a_bad_entry_but_applies_the_rest);
    RUN_TEST(test_ws_config_set_needs_an_object);
    RUN_TEST(test_ws_set_mode_always_applies);
    RUN_TEST(test_ws_set_mode_rejects_bad_input);
    RUN_TEST(test_ws_set_motor_rejects_out_of_range);
    RUN_TEST(test_ws_trigger_reset_heart_rate_and_sim_pressure);
    RUN_TEST(test_ws_unknown_name);
    RUN_TEST(test_locked_ws_config_set_changes_nothing);
    RUN_TEST(test_locked_ws_set_mode_refuses_endless_and_orgasm);
    RUN_TEST(test_locked_ws_stop_is_accepted);
    RUN_TEST(test_locked_ws_reset_denied_is_refused);
    RUN_TEST(test_locked_ws_trigger_heart_rate_and_sim_pressure_are_accepted);
    RUN_TEST(test_locked_ble_setting_is_refused);
    RUN_TEST(test_locked_ble_control_refuses_endless_and_reset);
    RUN_TEST(test_locked_ble_control_refuses_orgasm_from_another_mode);
    RUN_TEST(test_locked_ble_trigger_repeating_the_mode_is_accepted);
    RUN_TEST(test_locked_ble_stop_heart_rate_and_sim_pressure_are_accepted);
    RUN_TEST(test_unlocked_everything_is_accepted);
    RUN_TEST(test_full_queue_drops_new_commands);
    RUN_TEST(test_a_packet_is_queued_whole_or_not_at_all);
    RUN_TEST(test_the_queue_works_after_wrapping_around);
    return UNITY_END();
}
