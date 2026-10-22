#pragma once

#include <stdbool.h>

#include "orgasm_control.h"

// Calls made so far, space separated, e.g. "mode:0 pleasure:200 ".
extern char fake_log[];
// The mode orgasm_control_get_output_mode() and status_snapshot_mode() return; set_output_mode() changes it.
extern orgasm_output_mode_t fake_mode;
// What set_config_value() returns.
extern bool fake_config_accepts;
// What status_snapshot_settings_locked() returns: the Settings lock as the tick last published it.
extern bool fake_settings_locked;

void fake_reset(void);
