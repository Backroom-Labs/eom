// Status snapshot tests: one fixed snapshot in, the exact WebSocket JSON and BLE bytes the app
// already reads out. The expected values were written from the encoders these replaced, so a
// failure here means the wire format changed.

#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include "cJSON.h"
#include "status_snapshot.h"

static status_snapshot_t fixture(void) {
    status_snapshot_t s = {
        .millis = 0x0102030405ULL,  // over 32 bits: BLE carries the low 32
        .pressure = 0x0ABC,
        .pressure_avg = 1500,
        .arousal = 0x0123,
        .threshold = 0x0FF0,
        .sensitivity = 128,
        .motor = 200,
        .cooldown = 7,
        .denied = 3,
        .chance_denials = 2,
        .mode = 1,
        .mode_name = "ENDLESS",
        .vibration_mode = 2,
        .permit_s = 0x1234,
        .menu_locked = true,
        .safety = 4,
        .phase = 2,
        .session_orgasms = 5,
        .rest_s = 0x0102,
        .baseline = 0x0456,
        .hr = 72,
        .hr_waiting = true,
        .hr_zone = false,
        .led_r = 10,
        .led_g = 20,
        .led_b = 30,
        .raw_seq = 0x00012345,
    };
    for (int i = 0; i < STATUS_SNAPSHOT_RAW_LEN; i++) s.raw[i] = 1000 + i;
    return s;
}

static char* to_json(const status_snapshot_t* s) {
    cJSON* readings = cJSON_CreateObject();
    status_snapshot_to_json(s, readings);
    char* text = cJSON_PrintUnformatted(readings);
    cJSON_Delete(readings);
    return text;
}

void setUp(void) {}
void tearDown(void) {}

static void test_get_before_the_first_tick_is_all_zeros(void) {
    status_snapshot_t s;
    memset(&s, 0xAA, sizeof(s));
    status_snapshot_get(&s);
    TEST_ASSERT_EQUAL_UINT64(0, s.millis);
    TEST_ASSERT_EQUAL_UINT16(0, s.arousal);
    TEST_ASSERT_NULL(s.mode_name);
}

static void test_get_returns_what_was_published(void) {
    status_snapshot_t in = fixture(), out;
    status_snapshot_publish(&in);
    status_snapshot_get(&out);
    TEST_ASSERT_EQUAL_MEMORY(&in, &out, sizeof(in));
}

static void test_settings_locked_follows_the_latest_snapshot(void) {
    status_snapshot_t s = fixture();
    s.menu_locked = true;
    status_snapshot_publish(&s);
    TEST_ASSERT_TRUE(status_snapshot_settings_locked());
    s.menu_locked = false;
    status_snapshot_publish(&s);
    TEST_ASSERT_FALSE(status_snapshot_settings_locked());
}

static void test_json_matches_the_readings_message(void) {
    status_snapshot_t s = fixture();
    char* json = to_json(&s);
    TEST_ASSERT_EQUAL_STRING(
        "{\"arousal\":291,\"cooldown\":7,\"denied\":3,\"millis\":4328719365,\"motor\":200,"
        "\"pavg\":1500,\"permit\":4660,\"pressure\":2748,\"runMode\":\"ENDLESS\","
        "\"sensitivity\":128,\"threshold\":4080,\"lock\":true,\"safety\":4,\"phase\":2,"
        "\"orgasms\":5,\"rest\":258,\"baseline\":1110,\"hr\":72,\"hrWait\":true,\"hrZone\":false,"
        "\"chanceDenials\":2,\"rawSeq\":74565,\"raw\":[1008,1009,1010,1011,1012,1013,1014,1015]}",
        json
    );
    free(json);
}

static void test_json_without_a_mode_name(void) {
    status_snapshot_t s = fixture();
    s.mode_name = NULL;
    char* json = to_json(&s);
    TEST_ASSERT_NOT_NULL(strstr(json, "\"runMode\":\"\""));
    free(json);
}

static void test_ble_matches_the_status_characteristic(void) {
    status_snapshot_t s = fixture();
    uint8_t out[STATUS_SNAPSHOT_BLE_LEN];
    memset(out, 0xEE, sizeof(out));
    status_snapshot_to_ble(&s, out);

    const uint8_t head[30] = {
        0xAB,        // 0 pressure >> 4
        0x12,        // 1 arousal >> 4
        0xFF,        // 2 threshold >> 4
        200,         // 3 motor
        7,           // 4 cooldown
        3,           // 5 denied
        1,           // 6 mode
        2,           // 7 vibration mode
        0x12, 0x34,  // 8-9 permit seconds
        10, 20, 30,  // 10-12 LED colour
        0x02, 0x03, 0x04, 0x05,  // 13-16 millis, low 32 bits
        1,           // 17 menu locked
        4,           // 18 safety stop reason
        5,           // 19 session orgasms
        2,           // 20 after-orgasm phase
        0x01, 0x02,  // 21-22 rest seconds
        0x04, 0x56,  // 23-24 baseline
        72,          // 25 heart rate
        0x01,        // 26 flags: waiting for heart rate
        0x23, 0x45,  // 27-28 raw sequence, low 16 bits
        16,          // 29 raw values that follow
    };
    TEST_ASSERT_EQUAL(63, STATUS_SNAPSHOT_BLE_LEN);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(head, out, 30);
    for (int i = 0; i < STATUS_SNAPSHOT_RAW_LEN; i++) {
        TEST_ASSERT_EQUAL_HEX8(0x03, out[30 + 2 * i]);
        TEST_ASSERT_EQUAL_HEX8(0xE8 + i, out[31 + 2 * i]);
    }
    TEST_ASSERT_EQUAL_MESSAGE(2, out[62], "denials by chance, after the raw values");
}

static void test_ble_heart_rate_flags(void) {
    status_snapshot_t s = fixture();
    uint8_t out[STATUS_SNAPSHOT_BLE_LEN];
    s.hr_waiting = false;
    s.hr_zone = true;
    status_snapshot_to_ble(&s, out);
    TEST_ASSERT_EQUAL_HEX8(0x02, out[26]);
    s.hr_waiting = true;
    status_snapshot_to_ble(&s, out);
    TEST_ASSERT_EQUAL_HEX8(0x03, out[26]);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_get_before_the_first_tick_is_all_zeros);
    RUN_TEST(test_get_returns_what_was_published);
    RUN_TEST(test_settings_locked_follows_the_latest_snapshot);
    RUN_TEST(test_json_matches_the_readings_message);
    RUN_TEST(test_json_without_a_mode_name);
    RUN_TEST(test_ble_matches_the_status_characteristic);
    RUN_TEST(test_ble_heart_rate_flags);
    return UNITY_END();
}
