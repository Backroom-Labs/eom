# Wi-Fi OTA is pushed by the app; the EOM never downloads firmware

Over Wi-Fi, the app downloads and checks the release image itself, then streams it to the EOM over its WebSocket (`wss://` when `use_ssl` is on, otherwise `ws://`), using the same commands and events as the BLE OTA protocol (`ble_ota.h`). The EOM doesn't fetch the image itself because in access point mode it has no internet, and fetching would need an HTTPS client and a CA bundle on a device whose IRAM and flash are already tight. It also keeps one download-and-check path in the app for both transports.

## Consequences

- Both transports feed one transfer on the EOM (`ota_transfer.c`), so only one update runs at a time, and a BLE BEGIN that's refused gets a RESULT event rather than a failed write.
- The image arrives in binary WebSocket frames of at most 4 KB plus a 4-byte offset, so the EOM never holds more than a frame and the 16 KB window in memory.
