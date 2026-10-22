#ifndef __system__ota_h
#define __system__ota_h

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Writes and checks a firmware update (system/ota_transfer.h feeds it, for both BLE and Wi-Fi).
//
// Usage: ota_begin() -> ota_write() for every chunk, in order -> ota_end() -> esp_restart().
// Any error aborts the update; the caller just reports it. Only one update can run at a time.
//
// The image is the signed firmware.bin from the build (see tools/sign_firmware.py): ota_end() only
// accepts it if its signature matches the public key compiled into the running firmware.
//
// ota_begin() erases the inactive app partition and every call writes to flash, which blocks for
// a while: call these from a task that's allowed to block, never from the NimBLE host task or an
// httpd handler that must stay responsive.

// Placed right after esp_app_desc_t in every image, so an update can be checked for the right
// board before it's installed.
#define EOM_APP_DESC_MAGIC 0x314D4F45 // "EOM1"
typedef struct {
    uint32_t magic;
    char board[32];
} eom_app_desc_t;

typedef enum {
    OTA_STATE_IDLE,
    OTA_STATE_RECEIVING,
    OTA_STATE_READY_TO_REBOOT,
} ota_state_t;

typedef struct {
    ota_state_t state;
    size_t bytes_written;
    size_t image_size;
} ota_status_t;

// Starts an update of image_size bytes (the whole signed file). Stops the motor for the duration of
// the update. Refuses an older version unless allow_downgrade.
esp_err_t ota_begin(size_t image_size, bool allow_downgrade);

esp_err_t ota_write(const void* data, size_t len);

// Verifies the image (size, signature, app image format) and makes it the boot partition. The new firmware
// runs after the caller restarts the device.
esp_err_t ota_end(void);

void ota_abort(void);

ota_status_t ota_get_status(void);

// Board this firmware was built for (the PlatformIO environment name).
const char* ota_get_board(void);

// False while newly installed firmware is still on probation, during which updates are refused.
bool ota_firmware_confirmed(void);

// The largest image the inactive app partition can take.
size_t ota_max_image_size(void);

#ifdef __cplusplus
}
#endif

#endif
