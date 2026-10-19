# Firmware notes

Gotchas that the code and config don't show. The Bluetooth/WebSocket protocol, flashing and releases are in the README; decisions are in `docs/adr/`.

## The test device

- **M5Stack Atom Echo**: env `m5stack_atom_echo`, board `m5stack-atom`, 4 MB flash, SK6812 LED on G27, pressure on Grove G32 (`ADC_CHANNEL_4`).
- It has no pressure sensor, so test with the pressure simulator build (README, "Testing without a pressure sensor"). A normal upload puts the real sensor code back, and switching the flag rebuilds everything.
- Serial is `/dev/cu.usbserial-*`. Read boot logs with pyserial from `~/.platformio/penv/bin/python`, toggling RTS to reset the board.
- `gatt_svc.c` logs every control write at error level, so the app's 1 Hz heart rate fills the serial log. Known and left as is.

## Build

- Only `esp32dev` and `m5stack_atom_echo` are enabled in `platformio.ini`, so CI builds only those two (issue #15).
- `sdkconfig.<env>` files are git-ignored and regenerated on each build. Put sdkconfig changes in `sdkconfig.defaults` or `sdkconfig.defaults.esp32`.
- Classic ESP32 IRAM is tight: about 690 B free on ESP-IDF 5.5.2. Check IRAM usage after adding code that runs from interrupts.
- RMT DMA exists only on S3/P4, so `configure_led_2812` enables it only `#if SOC_RMT_SUPPORT_DMA`. Without that guard, other WS2812 boards boot-loop.
- The first build with a new ESP-IDF can fail creating its venv (`~/.platformio/penv/.espidf-<ver>`). Rerun the build or delete that folder.
- After deleting `dependencies.lock`, build the envs one at a time (`pio run -e X`, twice).
- Version pins: ADR 0004. `mdns` 1.14.0 and `led_strip` 3.1.0~1 were the newest on 2026-10-20.

## Control loop

- In automatic modes the firmware doesn't drive the motor DAC: the app and toys follow the pleasure it reports. Setting pleasure to 0 therefore stops every output, which is how safety stops work.
- The host tests in `test/test_orgasm_control` run the real `orgasm_control.c` on a fake clock. Start the fake clock well after boot (the tests use an hour), or the edge delay holds pleasure at 0.

## OTA

- Signing: ADR 0003. Before switching the boot partition, `ota.c` checks the chip, project, board (`EOM_BOARD`), version (no downgrades) and signature.
- A new image is confirmed after it has run the control loop for 30 s; otherwise it rolls back.
- The BLE OTA protocol is documented in `src/include/system/ble_ota.h`. The BLE address is derived from the MAC plus a hash of the GATT layout, so changing the GATT table changes the address, and unbonded clients re-read the table.
- `8mb_spiffs.csv` app slots are 3.9 MB each. 8 MB boards needed a full erase once after OTA phase 0.
- Wi-Fi OTA (phase 2) isn't built yet: issue #16.
