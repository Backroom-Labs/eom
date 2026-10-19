# Stay on ESP-IDF 5.5.2

The firmware is pinned to `espressif32@6.13.0` with `framework-espidf@3.50502` (ESP-IDF 5.5.2). ESP-IDF 5.5.3 breaks BLE OTA on classic ESP32: the link drops (reason 520 = HCI 0x08) on the first flash writes. This was bisected on the Atom Echo and is not a config issue. Later 5.5.x releases need platform 7.x, so before moving on, recheck BLE OTA; look for `ble_ota: Stalled at ... bytes` followed by `reason=520`.
