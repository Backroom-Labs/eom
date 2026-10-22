// Wi-Fi OTA commands: JSON commands and binary frames from a WebSocket client in, calls into the
// OTA session (faked) and JSON events back out.

#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include "fakes.h"
#include "system/ws_ota.h"

static char reply[256];

static const char* run(const char* name, const char* json, int fd) {
    char* out = fake_run(name, json, fd);
    strncpy(reply, out, sizeof(reply) - 1);
    free(out);
    return reply;
}

void setUp(void) {
    fake_reset();
}

void tearDown(void) {}

static void test_begin_starts_a_session_for_the_client(void) {
    run("otaBegin", "{\"size\":1000,\"allowDowngrade\":true}", 5);
    TEST_ASSERT_EQUAL_STRING("begin:5:1000:1 ", fake_log);
}

static void test_begin_without_a_valid_size_is_refused(void) {
    const char* bad[] = { "null", "{}", "{\"size\":\"1000\"}", "{\"size\":0}", "{\"size\":-5}", "{\"size\":1.5}" };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        TEST_ASSERT_EQUAL_STRING_MESSAGE("{\"errno\":1}", run("otaBegin", bad[i], 5), bad[i]);
    }
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_session_events_go_to_the_client_as_json(void) {
    run("otaBegin", "{\"size\":1000}", 5);
    fake_transport->notify(5, OTA_EVT_READY, ESP_OK, 0);
    TEST_ASSERT_EQUAL(5, fake_sent_fd);
    TEST_ASSERT_EQUAL_STRING("{\"ota\":{\"event\":\"ready\",\"error\":0,\"value\":0}}", fake_sent);
    fake_transport->notify(5, OTA_EVT_PROGRESS, ESP_OK, 4096);
    TEST_ASSERT_EQUAL_STRING("{\"ota\":{\"event\":\"progress\",\"error\":0,\"value\":4096}}", fake_sent);
    fake_transport->notify(5, OTA_EVT_RESEND, ESP_OK, 8192);
    TEST_ASSERT_EQUAL_STRING("{\"ota\":{\"event\":\"resend\",\"error\":0,\"value\":8192}}", fake_sent);
    fake_transport->notify(5, OTA_EVT_RESULT, 0x1503, 0);
    TEST_ASSERT_EQUAL_STRING("{\"ota\":{\"event\":\"result\",\"error\":5379,\"value\":0}}", fake_sent);
}

static void test_binary_frames_carry_their_offset_to_the_session(void) {
    const uint8_t frame[] = { 0x00, 0x10, 0x00, 0x00, 0xe9, 0x01, 0x02 }; // offset 4096, 3 bytes
    ws_ota_on_binary(5, frame, sizeof(frame));
    TEST_ASSERT_EQUAL_STRING("data:5:4096:3 ", fake_log);
}

static void test_a_frame_too_short_for_an_offset_and_data_is_ignored(void) {
    const uint8_t frame[] = { 0x00, 0x10, 0x00, 0x00 };
    ws_ota_on_binary(5, frame, sizeof(frame));
    ws_ota_on_binary(5, frame, 2);
    TEST_ASSERT_EQUAL_STRING("", fake_log);
}

static void test_abort_or_a_closed_socket_ends_the_clients_update(void) {
    run("otaAbort", "null", 5);
    ws_ota_on_close(7);
    TEST_ASSERT_EQUAL_STRING("abort:5 abort:7 ", fake_log);
}

static void test_info_reports_what_the_app_checks_before_an_update(void) {
    TEST_ASSERT_EQUAL_STRING(
        "{\"version\":\"3.8.0-beta.1\",\"board\":\"m5stack_atom_echo\",\"maxSize\":1966080,\"confirmed\":true}",
        run("otaInfo", "null", 5)
    );
    fake_confirmed = false;
    TEST_ASSERT_NOT_NULL(strstr(run("otaInfo", "null", 5), "\"confirmed\":false"));
}

int main(void) {
    ws_ota_register();
    UNITY_BEGIN();
    RUN_TEST(test_begin_starts_a_session_for_the_client);
    RUN_TEST(test_begin_without_a_valid_size_is_refused);
    RUN_TEST(test_session_events_go_to_the_client_as_json);
    RUN_TEST(test_binary_frames_carry_their_offset_to_the_session);
    RUN_TEST(test_a_frame_too_short_for_an_offset_and_data_is_ignored);
    RUN_TEST(test_abort_or_a_closed_socket_ends_the_clients_update);
    RUN_TEST(test_info_reports_what_the_app_checks_before_an_update);
    return UNITY_END();
}
