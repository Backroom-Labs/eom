#include "api/index.h"
#include "control_command.h"
#include "orgasm_control.h"
#include "status_snapshot.h"
#include "system/websocket_handler.h"

// Edging commands over WebSocket. Each one is a control command; see control_command.h.

static command_err_t
cmd_edging_set_mode(cJSON* command, cJSON* response, websocket_client_t* client) {
    //cJSON_AddStringToObject(response, "mode", orgasm_control_get_output_mode_str()); //immediate response seemse to be crashing websocket server
    return api_cc_result(control_command_from_ws("setMode", command));
}

static const websocket_command_t cmd_edging_set_mode_s = {
    .command = "setMode",
    .func = &cmd_edging_set_mode,
};

static command_err_t
cmd_edging_set_motor(cJSON* command, cJSON* response, websocket_client_t* client) {
    // The switch to manual happens on the next tick; report it now, as before.
    bool switching = status_snapshot_mode() != OC_MANUAL;
    cc_result_t result = control_command_from_ws("setMotor", command);
    if (result == CC_OK && switching) cJSON_AddStringToObject(response, "mode", "MANUAL");
    //cJSON_AddNumberToObject(response, "speed", speed);  //immediate response seemse to be crashing websocket server
    return api_cc_result(result);
}

static const websocket_command_t cmd_edging_set_motor_s = {
    .command = "setMotor",
    .func = &cmd_edging_set_motor,
};

static command_err_t
cmd_edging_reset_denied(cJSON* command, cJSON* response, websocket_client_t* client) {
    return api_cc_result(control_command_from_ws("resetDenied", command));
}

static const websocket_command_t cmd_edging_reset_denied_s = {
    .command = "resetDenied",
    .func = &cmd_edging_reset_denied,
};

static command_err_t cmd_edging_trigger_arousal(cJSON* command, cJSON* response, websocket_client_t* client) {
    return api_cc_result(control_command_from_ws("triggerArousal", command));
}

static const websocket_command_t cmd_edging_trigger_arousal_s = {
    .command = "triggerArousal",
    .func = &cmd_edging_trigger_arousal,
};

// Not in stable releases (-DEOM_PRESSURE_SIM), which ignore it: value replaces the sensor, -1 for the real one.
static command_err_t cmd_edging_sim_pressure(cJSON* command, cJSON* response, websocket_client_t* client) {
    return api_cc_result(control_command_from_ws("simPressure", command));
}

static const websocket_command_t cmd_edging_sim_pressure_s = {
    .command = "simPressure",
    .func = &cmd_edging_sim_pressure,
};

// Heart rate in bpm from a sensor the app is connected to; 0 for no reading.
static command_err_t cmd_edging_heart_rate(cJSON* command, cJSON* response, websocket_client_t* client) {
    return api_cc_result(control_command_from_ws("heartRate", command));
}

static const websocket_command_t cmd_edging_heart_rate_s = {
    .command = "heartRate",
    .func = &cmd_edging_heart_rate,
};

void api_register_edging(void) {
    websocket_register_command(&cmd_edging_heart_rate_s);
    websocket_register_command(&cmd_edging_sim_pressure_s);
    websocket_register_command(&cmd_edging_set_mode_s);
    websocket_register_command(&cmd_edging_set_motor_s);
    websocket_register_command(&cmd_edging_reset_denied_s);
    websocket_register_command(&cmd_edging_trigger_arousal_s);
}
