#ifndef __system__ble_ota_h
#define __system__ble_ota_h

#include "host/ble_gatt.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Firmware updates over BLE: a transport for system/ota.h, using two characteristics in the EOM
// service. Multi-byte values are little-endian.
//
// OTA control (GATTS_CHAR_OTA_CONTROL_UUID): read, write, notify
//   read   JSON {"version", "board", "mtu", "maxSize", "confirmed"}, so the client can check the board
//          and size its chunks. confirmed is false while new firmware is still on probation, during
//          which updates are refused.
//   write  0x01 BEGIN  u32 image size, u8 flags (bit 0: allow downgrade)
//          0x02 ABORT
//   notify u8 event, i32 esp_err_t, u32 value
//          0x01 READY     partition erased; send the image from offset 0
//          0x02 PROGRESS  value = bytes written to flash
//          0x03 RESEND    value = the offset the device expects next; resume sending from there.
//                         Sent after a gap in the data, and every second while no data arrives.
//          0x04 RESULT    error 0: installed, the device restarts into it in a second.
//                         Otherwise the update failed (or was refused) and the session is over.
//
// OTA data (GATTS_CHAR_OTA_DATA_UUID): write without response
//   u32 offset, then image bytes (up to MTU - 7 of them)
//
// Flow control: the client keeps no more than BLE_OTA_WINDOW bytes beyond the last PROGRESS value
// in flight. Data that arrives out of order (or that doesn't fit) is dropped and answered with
// RESEND, and a stalled transfer is restarted with RESEND too, so lost packets are recovered. The
// session ends if the client disconnects or stops sending for a while.

#define BLE_OTA_WINDOW (16 * 1024)

#define BLE_OTA_CMD_BEGIN 0x01
#define BLE_OTA_CMD_ABORT 0x02

#define BLE_OTA_EVT_READY 0x01
#define BLE_OTA_EVT_PROGRESS 0x02
#define BLE_OTA_EVT_RESEND 0x03
#define BLE_OTA_EVT_RESULT 0x04

// ATT error returned to a BEGIN while another update is running.
#define BLE_OTA_ATT_ERR_BUSY 0x80

// Call before the GATT services are registered.
void ble_ota_init(void);

extern uint16_t ble_ota_control_val_handle;
extern uint16_t ble_ota_data_val_handle;

int ble_ota_control_access(
    uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt* ctxt, void* arg
);
int ble_ota_data_access(
    uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt* ctxt, void* arg
);

// Ends the update if it was started over this connection.
void ble_ota_on_disconnect(uint16_t conn_handle);

#ifdef __cplusplus
}
#endif

#endif
