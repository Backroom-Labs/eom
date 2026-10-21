# Wi-Fi OTA is pushed by the app; the EOM never downloads firmware

Over Wi-Fi, the app downloads and checks the release image itself, then streams it to the EOM over the existing secure WebSocket, using the same commands and events as the BLE OTA protocol (`ble_ota.h`). The EOM doesn't fetch the image itself because in access point mode it has no internet, and fetching would need an HTTPS client and a CA bundle on a device whose IRAM and flash are already tight. It also keeps one download-and-check path in the app for both transports.
