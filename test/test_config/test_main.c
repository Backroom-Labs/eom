// Config tests: loading a config.json into config_t through CONFIG_DEFS, as json_to_config() does.

#include <unity.h>

#include "cJSON.h"
#include "config_defs.h"

extern CONFIG_DEFS;

void setUp(void) {}
void tearDown(void) {}

static config_t load(const char* json) {
    config_t cfg = { 0 };
    cJSON* root = cJSON_Parse(json);
    TEST_ASSERT_NOT_NULL(root);
    _config_defs(CFG_SET, root, &cfg, NULL, NULL, NULL, 0, NULL);
    cJSON_Delete(root);
    return cfg;
}

// A config.json saved before Orgasm chance existed keeps today's behaviour.
static void test_a_config_without_orgasm_chance_loads_it_as_100(void) {
    config_t cfg = load("{\"max_denied\": 5, \"auto_edging_duration_minutes\": 20}");
    TEST_ASSERT_EQUAL(100, cfg.orgasm_chance);
    TEST_ASSERT_EQUAL(5, cfg.max_denied);
}

static void test_orgasm_chance_loads_from_the_config(void) {
    config_t cfg = load("{\"orgasm_chance\": 25}");
    TEST_ASSERT_EQUAL(25, cfg.orgasm_chance);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_a_config_without_orgasm_chance_loads_it_as_100);
    RUN_TEST(test_orgasm_chance_loads_from_the_config);
    return UNITY_END();
}
