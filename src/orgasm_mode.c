#include "orgasm_mode.h"
#include "config.h"
#include "esp_log.h"
#include "esp_random.h"

static const char* TAG = "orgasm_mode";

// Lock settings this long into Orgasm mode, with Config.edge_menu_lock.
#define EDGE_LOCK_AFTER_MS (2 * 60 * 1000)

static struct {
    orgasm_output_mode_t mode;
    unsigned long edging_start_ms; // when this Orgasm mode run or Milking round started edging
    unsigned long post_orgasm_start_ms; // 0 when not in Post-orgasm
    int post_orgasm_s;
    unsigned long rest_start_ms; // Milking rest between rounds, 0 when not resting
    uint8_t orgasms; // detected since a mode started
    bool orgasm_detected;
    bool ruined;
    bool settings_locked;
} state;

// Orgasm mode rounds (Config.orgasm_chance). A round ends when its edging time or denial target is
// reached, with one roll: won, an orgasm is permitted; lost, it's a denial and a new round starts.
static struct {
    unsigned long start_ms;
    uint8_t denials;        // denials this round, for Config.max_denied
    bool won;
    uint8_t chance_denials; // lost rolls since Orgasm mode started
} round_state;

static void start_round(unsigned long now_ms) {
    round_state.start_ms = now_ms;
    round_state.denials = 0;
    round_state.won = false;
}

static bool is_round_target_reached(unsigned long now_ms) {
    return now_ms > round_state.start_ms + (Config.auto_edging_duration_minutes * 60 * 1000) ||
           (Config.max_denied > 0 && Config.max_denied < 100 && round_state.denials > Config.max_denied);
}

void orgasm_mode_set_mode(orgasm_output_mode_t mode, unsigned long now_ms) {
    state.mode = mode;
    state.edging_start_ms = now_ms;
    state.post_orgasm_start_ms = 0;
    state.rest_start_ms = 0;
    if (mode != OC_MANUAL) {
        state.orgasms = 0;
        state.ruined = false;
        state.orgasm_detected = false;
    }
    start_round(now_ms);
    if (mode == OC_ORGASM) round_state.chance_denials = 0;
}

void orgasm_mode_permit(int post_orgasm_s, unsigned long now_ms) {
    state.orgasm_detected = false;
    // As if the edging time had passed: the edge_menu_lock timer counts from edging_start_ms.
    state.edging_start_ms = now_ms - (Config.auto_edging_duration_minutes * 60 * 1000);
    state.post_orgasm_s = post_orgasm_s;
    round_state.won = true;
}

// A lost roll counts as the next round's first denial (orgasm_control denies straight after), so
// that round permits after max_denied more.
bool orgasm_mode_roll(unsigned long now_ms) {
    if (state.mode != OC_ORGASM || round_state.won || !is_round_target_reached(now_ms)) {
        return false;
    }
    if (esp_random() % 100 < Config.orgasm_chance) {
        round_state.won = true;
        return false;
    }
    ESP_LOGI(TAG, "Denied by chance (%d%%)", Config.orgasm_chance);
    if (round_state.chance_denials < UINT8_MAX) round_state.chance_denials++;
    start_round(now_ms);
    return true;
}

void orgasm_mode_denied(void) {
    if (round_state.denials < UINT8_MAX) round_state.denials += 1;
}

void orgasm_mode_reset_denied(void) {
    round_state.denials = 0;
}

bool orgasm_mode_is_permitted(void) {
    return state.mode == OC_ORGASM && round_state.won;
}

void orgasm_mode_orgasm_detected(void) {
    if (orgasm_mode_is_permitted()) state.orgasm_detected = true;
}

void orgasm_mode_pleasure_set(void) {
    state.ruined = false;
}

void orgasm_mode_lock_settings(bool locked) {
    state.settings_locked = locked;
}

static void start_milking_round(unsigned long now_ms) {
    ESP_LOGI(TAG, "Milking: starting round %d", state.orgasms + 1);
    state.rest_start_ms = 0;
    state.post_orgasm_start_ms = 0;
    state.orgasm_detected = false;
    state.edging_start_ms = now_ms;
    start_round(now_ms);
}

orgasm_mode_output_t orgasm_mode_update(unsigned long now_ms, float* pleasure, float (*increment)(void)) {
    if (state.mode == OC_MANUAL) {
        state.settings_locked = false;
        state.post_orgasm_s = Config.post_orgasm_duration_seconds;
        return ORGASM_MODE_EDGING;
    }

    if (state.mode != OC_ORGASM) {
        state.edging_start_ms = now_ms;
        state.post_orgasm_start_ms = 0;
    }

    if (Config.edge_menu_lock && !state.settings_locked &&
        now_ms > state.edging_start_ms + EDGE_LOCK_AFTER_MS) {
        state.settings_locked = true;
    }

    if (state.rest_start_ms > 0) {
        *pleasure = 0;
        if (now_ms >= state.rest_start_ms + (Config.milking_rest_seconds * 1000UL)) {
            start_milking_round(now_ms);
            return ORGASM_MODE_NEXT_ROUND;
        }
        return ORGASM_MODE_RESTING;
    }

    if (orgasm_mode_is_permitted() && state.post_orgasm_start_ms == 0) {
        if (state.orgasm_detected) {
            state.orgasm_detected = false;
            if (state.orgasms < UINT8_MAX) state.orgasms++;
            ESP_LOGI(TAG, "Orgasm detected: %d this session", state.orgasms);

            if (Config.after_orgasm == AfterOrgasmRuin) {
                ESP_LOGI(TAG, "Orgasm ruined");
                state.settings_locked = false;
                state.ruined = true;
                *pleasure = 0;
                return ORGASM_MODE_STOP;
            }

            state.post_orgasm_start_ms = now_ms;
            if (Config.post_orgasm_menu_lock) state.settings_locked = true;
        }

        if (*pleasure < Config.max_pleasure) {
            *pleasure = increment();
        } else {
            *pleasure = Config.max_pleasure;
        }
    }

    if (state.post_orgasm_start_ms == 0) return ORGASM_MODE_EDGING;

    if (now_ms < state.post_orgasm_start_ms + (state.post_orgasm_s * 1000)) {
        *pleasure = Config.max_pleasure;
        return ORGASM_MODE_POST_ORGASM;
    }
    if (*pleasure > 0) {
        *pleasure = *pleasure - 1;
        return ORGASM_MODE_POST_ORGASM;
    }
    if (Config.after_orgasm == AfterOrgasmMilking &&
        (Config.milking_max_orgasms <= 0 || state.orgasms < Config.milking_max_orgasms)) {
        ESP_LOGI(TAG, "Milking: resting for %ds", Config.milking_rest_seconds);
        state.orgasm_detected = false;
        state.post_orgasm_start_ms = 0;
        state.rest_start_ms = now_ms > 0 ? now_ms : 1;
        *pleasure = 0;
        return ORGASM_MODE_RESTING;
    }
    state.settings_locked = false;
    state.orgasm_detected = false;
    *pleasure = 0;
    return ORGASM_MODE_STOP;
}

static uint16_t permit_seconds(unsigned long now_ms) {
    if (state.mode != OC_ORGASM || orgasm_mode_is_permitted()) return 0;
    long remaining_ms =
        (round_state.start_ms + (Config.auto_edging_duration_minutes * 60 * 1000)) - now_ms;
    // Rounded up and at least 1, so 0 always means permitted: the roll waits for the next update,
    // and a lost roll can follow the last second.
    if (remaining_ms < 1000) return 1;
    return (uint16_t)((remaining_ms + 999) / 1000UL);
}

static uint16_t rest_seconds(unsigned long now_ms) {
    if (state.rest_start_ms == 0) return 0;
    unsigned long end = state.rest_start_ms + (Config.milking_rest_seconds * 1000UL);
    return now_ms >= end ? 0 : (uint16_t)((end - now_ms + 999) / 1000);
}

static oc_after_orgasm_phase_t phase(void) {
    if (state.ruined) return OC_PHASE_RUINED;
    if (state.rest_start_ms > 0) return OC_PHASE_RESTING;
    if (state.mode == OC_ORGASM && state.post_orgasm_start_ms > 0) return OC_PHASE_POST_ORGASM;
    return OC_PHASE_NONE;
}

void orgasm_mode_status(unsigned long now_ms, orgasm_mode_status_t* out) {
    *out = (orgasm_mode_status_t){
        .phase = phase(),
        .permit_s = permit_seconds(now_ms),
        .rest_s = rest_seconds(now_ms),
        .session_orgasms = state.orgasms,
        .chance_denials = round_state.chance_denials,
        .settings_locked = state.settings_locked,
    };
}
