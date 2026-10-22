#ifndef __system__ota_rx_h
#define __system__ota_rx_h

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Decides what to do with each chunk of image data that arrives during an update. Chunks carry
// the offset they belong at; only the one the device expects next is written. Used by both
// transports (see system/ota_session.h).

typedef enum {
    OTA_RX_ACCEPT, // write it: next_offset has moved past it
    OTA_RX_RESEND, // ask the client to resend from next_offset
    OTA_RX_DROP,   // ignore it quietly: a resend is already on its way
} ota_rx_action_t;

typedef struct {
    size_t next_offset;  // where the next chunk must start
    bool resend_pending; // a resend was asked for and hasn't been answered yet
} ota_rx_t;

void ota_rx_reset(ota_rx_t* rx);

// space is how many bytes the receive buffer can take right now.
ota_rx_action_t ota_rx_chunk(ota_rx_t* rx, size_t offset, size_t len, size_t space);

#ifdef __cplusplus
}
#endif

#endif
