#ifndef __control_command_h
#define __control_command_h

#ifdef __cplusplus
extern "C" {
#endif

#include "cJSON.h"
#include <stddef.h>
#include <stdint.h>

// Control commands (see GLOSSARY.md): instructions from the app or a remote to change what the EOM
// is doing. Each transport hands its raw input here. The input is checked and answered at once, then
// queued for the tick to apply, so only the tick task changes edging state (docs/adr/0001).
// Setting changes are the exception: they are applied immediately.
//
// Every motor write switches to manual and goes through orgasm_control's pleasure caps.
//
// The Settings lock refuses settings, Endless/Orgasm and resetDenied (CC_LOCKED) but never Stop.
// It's checked on arrival, so a command queued just before the lock turned on may still apply.

typedef enum {
    CC_OK,
    CC_BAD_ARG,     // malformed or out of range; nothing was queued or changed
    CC_QUEUE_FULL,  // the queue is full; nothing was queued
    CC_UNKNOWN,     // not a control command (for example a BLE restart request); the caller handles it
    CC_LOCKED,      // refused because the Settings lock is on; nothing was queued or changed
} cc_result_t;

// A write to the BLE control characteristic: 0x01 control, 0x02 setting ("name:value"),
// 0x05 simulated pressure, 0x06 heart rate. Other first bytes return CC_UNKNOWN.
cc_result_t control_command_from_ble(const uint8_t* buf, size_t len);

// A write from a BLE remote (Monsterpub): motor 1 and, optionally, motor 2 as percentages.
cc_result_t control_command_from_remote(const uint8_t* buf, size_t len);

// A WebSocket command and its JSON value: setMode, setMotor, triggerArousal, resetDenied,
// heartRate, simPressure or configSet. Other names return CC_UNKNOWN.
cc_result_t control_command_from_ws(const char* name, const cJSON* value);

// Apply the queued commands in order. Only the task that runs orgasm_control_tick() calls this,
// just before the tick.
void control_command_apply_pending(void);

#ifdef __cplusplus
}
#endif

#endif
