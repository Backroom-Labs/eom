#include "system/ota_rx.h"

void ota_rx_reset(ota_rx_t* rx) {
    rx->next_offset = 0;
    rx->resend_pending = false;
}

ota_rx_action_t ota_rx_chunk(ota_rx_t* rx, size_t offset, size_t len, size_t space) {
    if (offset == rx->next_offset && len <= space) {
        rx->next_offset += len;
        rx->resend_pending = false;
        return OTA_RX_ACCEPT;
    }
    // Chunks already in flight after a gap are dropped quietly, so a gap costs one resend. A retry
    // of the right offset that still doesn't fit is answered every time, so the client can't stall.
    if (rx->resend_pending && offset != rx->next_offset) return OTA_RX_DROP;
    rx->resend_pending = true;
    return OTA_RX_RESEND;
}
