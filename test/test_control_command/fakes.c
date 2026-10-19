// Fakes for everything control_command.c calls. Each call is written to a log the tests compare.

#include "fakes.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

#include "config.h"
#include "eom-hal-esp32.h"
#include "heart_rate.h"
#include "orgasm_control.h"

char fake_log[2048];
orgasm_output_mode_t fake_mode = OC_MANUAL;
bool fake_config_accepts = true;

static void log_call(const char* fmt, ...) {
    size_t used = strlen(fake_log);
    va_list args;
    va_start(args, fmt);
    vsnprintf(fake_log + used, sizeof(fake_log) - used, fmt, args);
    va_end(args);
    strncat(fake_log, " ", sizeof(fake_log) - strlen(fake_log) - 1);
}

void fake_reset(void) {
    fake_log[0] = '\0';
    fake_mode = OC_MANUAL;
    fake_config_accepts = true;
}

orgasm_output_mode_t orgasm_control_get_output_mode(void) {
    return fake_mode;
}

void orgasm_control_set_output_mode(orgasm_output_mode_t mode) {
    fake_mode = mode;
    log_call("mode:%d", mode);
}

void orgasm_control_set_pleasure(uint8_t pleasure) {
    log_call("pleasure:%d", pleasure);
}

void orgasm_control_set_motor2(uint8_t speed) {
    log_call("motor2:%d", speed);
}

void orgasm_control_trigger_arousal(void) {
    log_call("trigger");
}

void orgasm_control_reset_denied(void) {
    log_call("reset");
}

// Same names as orgasm_control.c.
orgasm_output_mode_t orgasm_control_str_to_output_mode(const char* str) {
    static const char* names[] = { "MANUAL", "ENDLESS", "ORGASM" };
    for (int i = 0; i < _OC_MODE_MAX; i++) {
        if (!strcasecmp(str, names[i])) return (orgasm_output_mode_t)i;
    }
    return _OC_MODE_ERROR;
}

void heart_rate_set(uint8_t bpm) {
    log_call("hr:%d", bpm);
}

void eom_hal_set_simulated_pressure(int value) {
    log_call("sim:%d", value);
}

bool set_config_value(const char* option, const char* value, bool* require_reboot) {
    log_call("cfg:%s=%s", option, value);
    return fake_config_accepts;
}

void config_enqueue_save(long save_at_ms) {
    log_call("save");
}
