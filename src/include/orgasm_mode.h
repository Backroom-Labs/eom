#ifndef __orgasm_mode_h
#define __orgasm_mode_h

#ifdef __cplusplus
extern "C" {
#endif

#include "orgasm_control.h"
#include <stdbool.h>
#include <stdint.h>

// Orgasm mode's rounds, Orgasm chance, detected orgasms, after-orgasm mode and Settings lock.
// Only the control loop calls it; other tasks read the status snapshot (status_snapshot.h).

// What orgasm_control should do next, as orgasm_mode_update() says.
typedef enum {
    ORGASM_MODE_EDGING,      // the vibration mode drives pleasure, edging and denying as usual
    ORGASM_MODE_POST_ORGASM, // pleasure set here (full, then ramping down): don't edge
    ORGASM_MODE_RESTING,     // Milking rest: pleasure 0 and no cooldown
    ORGASM_MODE_NEXT_ROUND,  // the rest is over: edge again from 0 pleasure and 0 denials
    ORGASM_MODE_STOP,        // Ruin, or the after-orgasm mode is over: stop and switch to Manual
} orgasm_mode_action_t;

typedef struct {
    oc_after_orgasm_phase_t phase;
    uint16_t permit_s;       // seconds until an orgasm is permitted; 0 once one is, or not in Orgasm mode
    uint16_t rest_s;         // seconds left of a Milking rest
    uint8_t orgasms;         // detected since a mode started
    uint8_t chance_denials;  // lost Orgasm chance rolls since Orgasm mode started
    bool settings_locked;
} orgasm_mode_status_t;

// A mode was set: anything but Manual forgets the last run's orgasms and Ruin, and Orgasm mode
// starts its first round.
void orgasm_mode_set_mode(orgasm_output_mode_t mode, unsigned long now_ms);

// After orgasm_mode_set_mode(OC_ORGASM): permit an orgasm at once, without a roll, followed by
// post_orgasm_s of Post-orgasm.
void orgasm_mode_permit(int post_orgasm_s, unsigned long now_ms);

// At the start of each update. Rolls once a round reaches its edging time or denial target; true
// means the roll was lost: a new round has started and orgasm_control must deny now.
bool orgasm_mode_roll(unsigned long now_ms);

// An edge was denied (including after a lost roll).
void orgasm_mode_denied(void);
void orgasm_mode_reset_denied(void);

// A clench or the heart rate showed an orgasm. Counts only while one is permitted.
void orgasm_mode_orgasm_detected(void);

// Pleasure was set above 0 by hand: the Ruin is over.
void orgasm_mode_pleasure_set(void);

void orgasm_mode_lock_settings(bool locked);

// Once per update, after orgasm detection. Once an orgasm is permitted, raises *pleasure with
// increment() (the vibration mode's), then holds, ramps down and rests as Config.after_orgasm says.
orgasm_mode_action_t orgasm_mode_update(unsigned long now_ms, float* pleasure, float (*increment)(void));

bool orgasm_mode_is_permitted(void);
oc_after_orgasm_phase_t orgasm_mode_phase(void);
void orgasm_mode_status(unsigned long now_ms, orgasm_mode_status_t* out);

#ifdef __cplusplus
}
#endif

#endif
