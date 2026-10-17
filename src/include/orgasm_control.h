#ifndef __orgasm_control_h
#define __orgasm_control_h

#ifdef __cplusplus
extern "C" {
#endif

#include "config.h"
#include "vibration_mode_controller.h"
#include <stddef.h>
#include <stdint.h>

// This enum has an associated strings array in orgasm_control.c
typedef enum orgasm_output_mode {
    OC_MANUAL,
    OC_AUTOMATIC,
    OC_ORGASM,
    _OC_MODE_MAX,
    _OC_MODE_ERROR = -1
} orgasm_output_mode_t;

typedef enum oc_bool {
    ocFALSE,
    ocTRUE,
} oc_bool_t;

void orgasm_control_init(void);
void orgasm_control_tick(void);

// Fetch Data
uint16_t orgasm_control_get_arousal(void);
float orgasm_control_get_arousal_percent(void);
uint8_t orgasm_control_get_pleasure(void);
uint8_t orgasm_control_get_pleasure_percent(void);
uint16_t orgasm_control_get_last_pressure(void);
uint16_t orgasm_control_get_average_pressure(void);
oc_bool_t orgasm_control_updated(void);
void orgasm_control_clear_update_flag(void);
void orgasm_control_increment_arousal_threshold(int threshold);
void orgasm_control_set_pleasure(uint8_t speed); // Defaults control_motor to true
void orgasm_control_set_pleasure_ex(uint8_t speed, bool control_motor); // Extended version with explicit control
void orgasm_control_set_arousal_threshold(int threshold);
uint16_t orgasm_control_get_arousal_threshold(void);
uint8_t orgasm_control_get_orgasm_count(void);
uint8_t orgasm_control_get_arousal_sensitivity(void);
uint8_t orgasm_control_get_cooldown(void);
void orgasm_control_reset_denied(void);
void orgasm_control_trigger_arousal(void);
uint16_t orgasm_control_get_permit_orgasm_remaining_seconds(void);
void orgasm_control_set_permit_orgasm_remaining_seconds(uint16_t seconds);
void orgasm_control_set_permit_orgasm_remaining_minutes(uint8_t minutes);
// Set Controls
void orgasm_control_control_motor(orgasm_output_mode_t control);

void orgasm_control_pause_control(void);
void orgasm_control_resume_control(void);

orgasm_output_mode_t orgasm_control_get_output_mode(void);
void orgasm_control_set_output_mode(orgasm_output_mode_t mode);
const char* orgasm_control_get_output_mode_str(void);
orgasm_output_mode_t orgasm_control_str_to_output_mode(const char* str);

// Recording Control
void orgasm_control_start_recording(void);
void orgasm_control_stop_recording(void);
oc_bool_t orgasm_control_is_recording(void);

// Twitch Detect (In wrong place for 60hz)
// Note 03-27-24 M. Abata - Clarify the above?
void orgasm_control_twitch_detect(void);

// Post orgasm
// TODO - Refactor post-orgasm and similar modes into post_orgasm_control.h, which I so
//        generously provided a template for! Truly my generosity is boundless.
oc_bool_t orgasm_control_is_menu_locked(void);
oc_bool_t orgasm_control_is_permit_orgasm_reached(void);
oc_bool_t orgasm_control_is_post_orgasm_reached(void);
void orgasm_control_permit_orgasm(int seconds);
void orgasm_control_lock_menu(oc_bool_t value);
long orgasm_control_clench_detect(long p_check);

// Where the session is after an orgasm (Config.after_orgasm). Sent to the UI (WS readings.phase,
// BLE status byte 20), so keep the values stable.
typedef enum oc_after_orgasm_phase {
    OC_PHASE_NONE = 0,
    OC_PHASE_POST_ORGASM = 1, // full intensity, then ramping down
    OC_PHASE_RESTING = 2,     // Milking: off until the next round of edging
    OC_PHASE_RUINED = 3,      // Ruin: stopped; cleared when a mode starts or pleasure is set
} oc_after_orgasm_phase_t;

oc_after_orgasm_phase_t orgasm_control_get_after_orgasm_phase(void);
// Orgasms detected since the session started.
uint8_t orgasm_control_get_session_orgasms(void);
// Seconds left of a Milking rest, 0 otherwise.
uint16_t orgasm_control_get_rest_remaining_seconds(void);
// Resting pressure (same scale as the pressure reading), followed over time.
uint16_t orgasm_control_get_baseline(void);
// Heart rate (Config.hr_*): the cooldown is waiting for the heart rate to settle.
bool orgasm_control_is_hr_waiting(void);
// Heart rate is in the edge zone, so the edge threshold is lowered.
bool orgasm_control_is_hr_edge_zone(void);

#ifdef __cplusplus
}
#endif

#endif
