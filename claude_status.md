# Claude status

Read this at the start of a new session to pick up where work stopped. Update it whenever a task
finishes or the plan changes.

_Last updated: 2026-10-16_

## Current focus: OTA (over-the-air) firmware updates

Work is split into phases, each one a commit (or branch). Version is `PROJECT_VER` in
[CMakeLists.txt](CMakeLists.txt), currently **2.0.1**.

| Phase | What | State |
|---|---|---|
| 0 | Rollback, firmware signing, shared OTA module ([src/system/ota.c](src/system/ota.c)) | Done, merged to `main` (02ec11b) |
| 1 | Firmware updates over Bluetooth ([src/system/ble_ota.c](src/system/ble_ota.c), UI `eomui/src/FirmwareUpdate.svelte`) | Done, merged to `main` (c21494d) |
| 2 | Not found in git history. Phase 0's commit says "groundwork for OTA updates over BLE and WiFi", so this is probably **OTA over WiFi**: the device downloads `manifest.json` and its image from the GitHub release. | **Not started.** Confirm the scope with Russ before building it. |
| 3 | Release pipeline: CI builds every env; a `v*` tag publishes a signed GitHub release + `manifest.json` | Done, merged to `main` (PR #4, 123e7ba) |

## Branch state

- Phase 3 is merged to `main` (PR #4, 123e7ba). `feature/release-pipeline` and `feature/ota` are
  both merged and can be deleted.
- `gh` CLI is not installed, so CI run status and PRs can't be checked from here. Look on GitHub.

## Test hardware / active envs

- Russ tests on an **M5Stack Atom Echo** (`[env:m5stack_atom_echo]`, board `m5stack-atom`, 4 MB,
  SK6812 LED on G27, pressure on Grove G32 = `ADC_CHANNEL_4`). Added 2026-10-16; builds, not yet
  tested on the device.
- Classic ESP32 IRAM is tight: the Atom Echo overflowed `iram0` by ~1.5 KB. Fixed by
  `sdkconfig.defaults.esp32` (RMT/SPI-slave handlers out of IRAM). ESP-IDF loads it automatically
  for esp32 targets. `sdkconfig.<env>` files are git-ignored and regenerated, so put sdkconfig
  changes in a defaults file, not there.
- RMT DMA (`with_dma`) only exists on S3/P4. `configure_led_2812` in `src/eom-hal-esp32.c` now
  enables it only `#if SOC_RMT_SUPPORT_DMA`; before that, any non-S3 WS2812 board boot-looped.
- WS2812 refreshes all run in one `LED` task pinned to core 0, which also creates the RMT channel.
  `eom_hal_set_rgb()` only queues the color and notifies it. Refreshing from the other core raced the
  RMT TX-done ISR (ESP-IDF 5.5), `rmt_disable` failed and the channel stayed stuck
  ("channel not in init state" forever). Fix built, not yet confirmed on the Atom Echo.
- All envs except `esp32dev` and `m5stack_atom_echo` are commented out in `platformio.ini`, so CI
  and releases only build those two (CI lists envs by matching uncommented `[env:...]` lines).
  Uncomment them before a full release.

## Next steps

1. Make sure the `OTA_SIGNING_KEY` repo secret holds the contents of `keys/ota_signing_key.pem`.
   Without it, a tag release fails on purpose.
2. Do a first test release from `main`: `git tag v2.0.1 && git push origin v2.0.1` (the tag must
   match `PROJECT_VER`). Check that the active envs build and that
   `releases/latest/download/manifest.json` resolves and lists every board.
3. Phase 2 (probably WiFi OTA using the manifest), after confirming the scope.

## Key facts (so the code doesn't need re-reading)

- **Signing:** an ECDSA P-256 trailer is appended to `firmware.bin` by `tools/sign_firmware.py`.
  Keys come from `tools/gen_signing_keys.py` into `keys/`, which is git-ignored. Devices only accept
  images signed with the key their firmware was built with. ESP-IDF's built-in signed-app support
  isn't used because PlatformIO doesn't pass the key to the bootloader build.
- **Image checks** in `ota.c`: chip, project, board (`EOM_BOARD` from `tools/board_name.py`, stored in
  `eom_app_desc`), no downgrades, and the signature, all checked before switching the boot partition.
- **Rollback:** a new image is confirmed after 30 s with the control loop ticking. Otherwise it
  rolls back.
- **BLE OTA:** control characteristic 0x696D, data characteristic 0x696E, a 16 KB window acknowledged
  by PROGRESS, and RESEND for lost chunks. The protocol is in `src/include/system/ble_ota.h`. The BLE
  address is derived from the MAC plus a GATT-layout hash, so unbonded clients (macOS, Chrome) re-read
  the table when it changes.
- **Manifest:** `tools/make_manifest.py` writes `{env, version, url, sha256, size}` per board and
  refuses unsigned images, the wrong board, or a version mismatch.
- **Build pins:** espressif32@6.12.0 / ESP-IDF 5.5, because ESP-IDF 6 drops cJSON.
- **Partitions:** `8mb_spiffs.csv` app slots are 3.9 MB each. 8 MB boards needed an erase after
  phase 0.

## Unrelated open TODOs in the code (low priority)

- [src/wifi_manager.c:167](src/wifi_manager.c#L167): function not implemented.
- [src/api/broadcast.c:47](src/api/broadcast.c#L47): value should come from the active connection.
- [src/include/orgasm_control.h:73](src/include/orgasm_control.h#L73): refactor post-orgasm modes.
