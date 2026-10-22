// Config redaction tests: what the boot log may print of config.json (issue #42).

#include <stdlib.h>
#include <string.h>
#include <unity.h>

#include "cJSON.h"
#include "config_redact.h"

static cJSON* redacted;

void setUp(void) {
    redacted = NULL;
}

void tearDown(void) {
    cJSON_Delete(redacted);
}

static void redact(const char* json) {
    char* out = config_redact_json(json);
    TEST_ASSERT_NOT_NULL(out);
    redacted = cJSON_Parse(out);
    cJSON_free(out);
    TEST_ASSERT_NOT_NULL(redacted);
}

static const char* str(const char* key) {
    const cJSON* item = cJSON_GetObjectItemCaseSensitive(redacted, key);
    TEST_ASSERT_TRUE(cJSON_IsString(item));
    return item->valuestring;
}

static void test_set_passwords_are_masked(void) {
    redact("{\"wifi_ssid\":\"home\",\"wifi_key\":\"hunter2\",\"ap_password\":\"letmein\"}");
    TEST_ASSERT_EQUAL_STRING("***", str("wifi_key"));
    TEST_ASSERT_EQUAL_STRING("***", str("ap_password"));
}

static void test_empty_passwords_stay_empty(void) {
    redact("{\"wifi_key\":\"\",\"ap_password\":\"\"}");
    TEST_ASSERT_EQUAL_STRING("", str("wifi_key"));
    TEST_ASSERT_EQUAL_STRING("", str("ap_password"));
}

static void test_other_settings_are_kept(void) {
    redact("{\"wifi_ssid\":\"home\",\"wifi_key\":\"hunter2\",\"wifi_on\":true,\"ap_channel\":6}");
    TEST_ASSERT_EQUAL_STRING("home", str("wifi_ssid"));
    TEST_ASSERT_TRUE(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(redacted, "wifi_on")));
    TEST_ASSERT_EQUAL(6, cJSON_GetObjectItemCaseSensitive(redacted, "ap_channel")->valueint);
    TEST_ASSERT_EQUAL(4, cJSON_GetArraySize(redacted));
}

static void test_missing_passwords_are_not_added(void) {
    redact("{\"wifi_ssid\":\"home\"}");
    TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(redacted, "wifi_key"));
    TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(redacted, "ap_password"));
}

static void test_input_is_unchanged(void) {
    char json[] = "{\"wifi_key\":\"hunter2\"}";
    redact(json);
    TEST_ASSERT_EQUAL_STRING("{\"wifi_key\":\"hunter2\"}", json);
}

static void test_output_never_contains_the_password(void) {
    char* out = config_redact_json("{\"wifi_key\":\"hunter2\",\"ap_password\":\"letmein\"}");
    TEST_ASSERT_NOT_NULL(out);
    TEST_ASSERT_NULL(strstr(out, "hunter2"));
    TEST_ASSERT_NULL(strstr(out, "letmein"));
    cJSON_free(out);
}

static void test_invalid_json_gives_null(void) {
    TEST_ASSERT_NULL(config_redact_json("{\"wifi_key\":\"hunter2\""));
    TEST_ASSERT_NULL(config_redact_json(NULL));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_set_passwords_are_masked);
    RUN_TEST(test_empty_passwords_stay_empty);
    RUN_TEST(test_other_settings_are_kept);
    RUN_TEST(test_missing_passwords_are_not_added);
    RUN_TEST(test_input_is_unchanged);
    RUN_TEST(test_output_never_contains_the_password);
    RUN_TEST(test_invalid_json_gives_null);
    return UNITY_END();
}
