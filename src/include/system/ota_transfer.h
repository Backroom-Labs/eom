#ifndef __system__ota_transfer_h
#define __system__ota_transfer_h

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// A firmware update streamed to the EOM by a client, over either transport (system/ble_ota.h,
// system/ws_ota.h). Only one runs at a time, whichever transport started it.
//
// The client sends BEGIN, waits for READY (the partition is erased), then sends the image in
// chunks tagged with their offset, keeping no more than OTA_WINDOW bytes beyond the last PROGRESS
// value in flight. A chunk that arrives out of order, or doesn't fit, is answered with RESEND
// (see system/ota_rx.h), and so is a stalled transfer. The transfer ends with RESULT, or when the
// client goes away or stops sending for a while.

#define OTA_WINDOW (16 * 1024)
// The largest chunk any transport delivers.
#define OTA_MAX_CHUNK 4096
// Every chunk on the wire starts with its offset in the image, u32 little-endian.
#define OTA_OFFSET_LEN 4

// Events, with an esp_err_t and a value:
#define OTA_EVT_READY 0x01    // partition erased; send the image from offset 0
#define OTA_EVT_PROGRESS 0x02 // value = bytes written to flash
#define OTA_EVT_RESEND 0x03   // value = the offset the device expects next; resume from there
#define OTA_EVT_RESULT 0x04   // error 0: installed, restarting in a second. Otherwise it failed.

// How a transport reaches its clients. client is the transport's own id (a BLE connection
// handle, a socket fd). notify may be called from the update task.
typedef struct {
    const char* name;
    void (*notify)(uint32_t client, uint8_t event, esp_err_t err, uint32_t value);
} ota_transport_t;

void ota_transfer_init(void);

// Starts an update of image_size bytes for client. Erasing happens on the update task, which
// sends READY when done. Whatever the outcome the client hears a RESULT, including straight away
// if an update is already running (ESP_ERR_INVALID_STATE, the busy result) or this one couldn't
// start; the return value is the same error, or ESP_OK if the update started.
esp_err_t ota_transfer_begin(
    const ota_transport_t* transport, uint32_t client, size_t image_size, bool allow_downgrade
);

// A chunk of image data from client. Never blocks; anything unwanted is dropped or answered with
// RESEND.
void ota_transfer_data(
    const ota_transport_t* transport, uint32_t client, size_t offset, const uint8_t* data, size_t len
);

// Ends the update if client started it: an ABORT, or the client went away.
void ota_transfer_abort(const ota_transport_t* transport, uint32_t client);

#ifdef __cplusplus
}
#endif

#endif
