#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "system/ota_session.h"
#include "system/websocket_handler.h"

// Calls into the OTA session so far, space separated, e.g. "begin:5:1000:1 data:5:0:4 ".
extern char fake_log[];
// The last text sent to a client, and which client.
extern char fake_sent[];
extern int fake_sent_fd;
// The transport the last ota_session_begin() was given, so tests can raise its events.
extern const ota_transport_t* fake_transport;
// What ota_firmware_confirmed() returns.
extern bool fake_confirmed;

void fake_reset(void);
// Runs the command ws_ota registered under name, as client fd, and returns the reply as JSON.
char* fake_run(const char* name, const char* json, int fd);
