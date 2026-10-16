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
| 3 | Release pipeline: CI builds every env; a `v*` tag publishes a signed GitHub release + `manifest.json` | Done on branch `feature/release-pipeline` (d935bee, 8befbac). Pushed, **not merged to `main`** |

## Branch state

- Current branch: `feature/release-pipeline`, 2 commits ahead of `main`, in sync with origin.
- `feature/ota` is the old phase 0/1 branch, already merged.
- `gh` CLI is not installed, so CI run status and PRs can't be checked from here. Look on GitHub.

## Next steps

1. Check the GitHub Actions run for `feature/release-pipeline`: all 6 envs should build
   (esp32-s3-devkitm-1, adafruit_qtpy_esp32s3_nopsram, esp32-c6-devkitm-1,
   waveshare_esp32_s3_amoled_1_32, waveshare_esp32_s3_zero, esp32dev).
2. Make sure the `OTA_SIGNING_KEY` repo secret holds the contents of `keys/ota_signing_key.pem`.
   Without it, a tag release fails on purpose.
3. Open a PR and merge `feature/release-pipeline` into `main`.
4. Do a first test release: `git tag v2.0.1 && git push origin v2.0.1` (the tag must match
   `PROJECT_VER`). Check that `releases/latest/download/manifest.json` resolves and lists every board.
5. Phase 2 (probably WiFi OTA using the manifest), after confirming the scope.

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
