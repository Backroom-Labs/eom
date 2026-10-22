#ifndef __system__ws_ota_h
#define __system__ws_ota_h

#include "system/ota_session.h"
#include "system/websocket_handler.h"
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Firmware updates over Wi-Fi: a transport for system/ota_session.h on the WebSocket, mirroring
// the BLE protocol (system/ble_ota.h) with the same events and result codes. The app downloads
// and checks the image; the EOM never fetches firmware itself (ADR 0012).
//
// Commands (JSON text, like every other command):
//   {"otaInfo": null}  -> {"otaInfo": {"version", "board", "maxSize", "confirmed"}}
//   {"otaBegin": {"size": <image bytes>, "allowDowngrade": <bool, optional>}}
//   {"otaAbort": null}
// Events (JSON text, to the client that sent otaBegin):
//   {"ota": {"event": "ready" | "progress" | "resend" | "result", "error": <esp_err_t>, "value": n}}
// Image data (binary frames):
//   u32 offset (little-endian), then up to OTA_MAX_CHUNK image bytes.

#define WS_OTA_OFFSET_LEN 4
#define WS_OTA_MAX_FRAME (WS_OTA_OFFSET_LEN + OTA_MAX_CHUNK)

void ws_ota_register(void);

// A binary frame from client fd. Ignored unless that client is running an update.
void ws_ota_on_binary(int fd, const uint8_t* frame, size_t len);

// Ends the update if client fd started it.
void ws_ota_on_close(int fd);

#ifdef __cplusplus
}
#endif

#endif
