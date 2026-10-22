#ifndef __api_index_h
#define __api_index_h

#ifdef __cplusplus
extern "C" {
#endif

#include "config.h"
#include "control_command.h"

// A control command result as a WebSocket command result.
static inline command_err_t api_cc_result(cc_result_t result) {
    switch (result) {
    case CC_OK: return CMD_OK;
    case CC_BAD_ARG: return CMD_ARG_ERR;
    case CC_LOCKED: return CMD_LOCKED;
    default: return CMD_FAIL;
    }
}

void api_register_config(void);
void api_register_system(void);
void api_register_edging(void);

static inline void api_register_all(void) {
    api_register_config();
    api_register_system();
    api_register_edging();
}

#ifdef __cplusplus
}
#endif

#endif
