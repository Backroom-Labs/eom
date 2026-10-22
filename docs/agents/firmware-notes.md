# Firmware notes

Gotchas that the code and config don't show. The Bluetooth/WebSocket protocol, flashing and releases are in the README; decisions are in `docs/adr/`.

## The test device

- **M5Stack Atom Echo**: env `m5stack_atom_echo`, board `m5stack-atom`, 4 MB flash, SK6812 LED on G27, pressure on Grove G32 (`ADC_CHANNEL_4`).
- It has no pressure sensor, so test with the pressure simulator (README, "Testing without a pressure sensor"). Every build has it, betas included, unless `EOM_STABLE_RELEASE=1` is set (`tools/pressure_sim.py`); CI sets that on stable release tags only. Switching between the two rebuilds every file in `src/`.
- Serial is `/dev/cu.usbserial-*`. Read boot logs with pyserial from `~/.platformio/penv/bin/python`, toggling RTS to reset the board.
- Hardware test scripts: `tools/serial_log.py` (reset and read serial), `eomui/scripts/wifi_ota.ts` (drive Wi-Fi OTA in modes `update`, `interrupt`, `busy`, `stray`) and `eomui/scripts/confirmed.ts` (wait until the new firmware is confirmed); usage at the top of each.
- `gatt_svc.c` logs every control write at error level, so the app's 1 Hz heart rate fills the serial log. Known and left as is.

## Build

- `pio` isn't on the PATH: run `~/.platformio/penv/bin/pio`.
- `esp32dev`, `m5stack_atom_echo` and `esp32-s3-devkitm-1` are enabled in `platformio.ini`, so CI builds those three (issues #15, #35).
- `sdkconfig.<env>` files are git-ignored and regenerated on each build. Put sdkconfig changes in `sdkconfig.defaults` or `sdkconfig.defaults.esp32`.
- Classic ESP32 IRAM is tight: 688 B free on `m5stack_atom_echo` with Wi-Fi OTA (ESP-IDF 5.5.2, 2026-10-22), and still 688 B in a dev build with the pressure simulator (2026-10-23). The last `heap_init` line in the boot log (`At 4009FD50 len 000002B0 ... IRAM`) shows it. Check after adding code that runs from interrupts.
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
- A change to how chunks are accepted or resent goes in `ota_rx.c` (host-tested), not in `ble_ota.c` or `ws_ota.c`: both transports feed `ota_transfer.c` (ADR 0012).
- Each update allocates a 20 KB receive buffer and an 8 KB task stack. The log line "Heap after the transfer" shows the headroom: on the Echo over `ws://` with BLE on, 49 KB free at the end of a transfer and 24 KB the lowest since boot (2026-10-22). `wss://` adds the TLS session on top, so check this again once it works.
- Wi-Fi OTA over `ws://` sends a 1.27 MB image in 20 to 25 s. Binary frames over `WS_OTA_MAX_FRAME` close the connection.
- With `use_ssl` on, the EOM serves only `wss://` on port 443. If TLS fails you can't reach it over Wi-Fi to turn it back off: use Bluetooth. `mbedtls_x509_crt_parse ... -0x3D00` at handshake means the cert encodes P-256 with explicit EC parameters, which mbedTLS rejects. LibreSSL (macOS's `openssl`) writes those unless asked for a named curve. `tools/gen_cert.py` now asks for one and regenerates an explicit-parameter pair; the new pair reaches the device only with `uploadfs` (issue #38).
