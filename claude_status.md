# Claude status

Read this at the start of a new session to pick up where work stopped. Update it whenever a task
finishes or the plan changes.

_Last updated: 2026-10-17_

## Current focus: OTA (over-the-air) firmware updates

Work is split into phases, each one a commit (or branch). Version is `PROJECT_VER` in
[CMakeLists.txt](CMakeLists.txt), currently **3.1.0** (bumped 2026-10-16 for the status LED and `post_orgasm_menu_lock`; not tagged yet).

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

## Modern UI (2026-10-16, branch `feature/modern-ui`, PR #7, tagged `v3.0.0`)

Rewrite of `eomui/src/App.svelte` with every device setting in the UI. Builds, `svelte-check` is
clean for the new files (the toy components and node_modules still have many old type errors).
Tested in headless Chrome with a fake WebSocket device; **not yet tested on hardware or over BLE.**

- `eomui/src/lib/settings.ts` is the single list of device settings (label, range, format, group,
  `restart` flag, `visible` rule). Add a setting there and it shows up in the drawer. A new *group*
  also needs an entry in `SETTINGS_TABS` in `App.svelte`, or it never shows. Keys must match
  `CONFIG_DEFS` in `src/config.c`.
- Newly exposed: all Wi-Fi/AP settings, hostname, `use_ssl`, `websocket_port`, `bt_on`,
  `bt_display_name`, `force_bt_coex`, `classic_serial`, `edge_menu_lock`, `post_orgasm_menu_lock`.
  Left out on purpose: console settings, SSL paths.
- `post_orgasm_menu_lock` (added 2026-10-16 on `feature/status-led`): its firmware code in
  `orgasm_control_update_edging_time()` was commented out and is back on. It locks settings when an
  orgasm is detected in Orgasm mode; the lock clears when post-orgasm ramp-down ends. UI toggle is in
  "Clench & post-orgasm", shown only when `use_post_orgasm` is on. Builds; not tested on the Echo.
- App-only prefs (localStorage `eom.prefs`): WebSocket URL (the Wi-Fi connect UI was commented out
  in the old UI), start view, keep screen on (Wake Lock), "Apply pressure" step.
- Firmware changes for it: BLE setting writes (0x02) are now saved to flash (they weren't before);
  BLE `0x04` = save and restart; status byte 17 and WS `readings.lock` = settings lock. Old firmware
  ignores 0x04, so restart there only works over Wi-Fi.
- Fixed in passing: BLE `permit` decoded as `*255` (now `<<8`); WS readings were never trimmed
  (memory grew forever); the stale-data timer was re-created on every WS connect.
- The device now boots stopped (Manual, pleasure 0) instead of Endless: `orgasm_control_init()` and
  `main_task()` in `src/main.c`. The UI shows "Stopped" for Manual at 0%.
- To test on the Echo: power-cycle and check nothing runs until a mode is picked; connect over BLE, change a slider, reboot, and check it stuck; toggle
  `edge_menu_lock` and run Orgasm mode >2 min to see the lock; change `bt_display_name` + Restart.

## Status LED (2026-10-16, branch `feature/status-led`, merged to `main` via PR #8)

The LED stayed one colour on the Echo. Two causes: nothing set a colour while the device sits
stopped in Manual (the colour code only runs in automatic modes), and `eom_hal_set_rgb()` dropped
any colour set during the off half of a flash. Tested and working on the Echo.

- `orgasm_control_update_idle_led()` in `src/orgasm_control.c` (WS2812 only), runs while no
  automatic mode is active: flashing blue (500 ms) until a BLE client (`isConnected`) or a WebSocket
  client (`websocket_client_count()`, new in `websocket_handler.c`) connects, then solid green.
  Automatic modes keep their existing colours.
- `eom-hal-esp32.c`: `led_show_current()` pushes colour-or-off to the LED task and skips unchanged
  refreshes. The off half of a flash is now fully off (it was dim red).
- **Real cause on the Echo:** the strip was created as `LED_MODEL_WS2811` (slow timing), which the
  Echo's SK6812 ignores. Serial log showed the firmware sending blue/off every 500 ms with no
  errors. Now `LED_STRIP_MODEL` (config.h, default `LED_MODEL_WS2811` so other boards are
  unchanged) and the Echo env sets `LED_MODEL_SK6812`. Confirmed on the Echo.
- The Echo is on `/dev/cu.usbserial-*`; boot logs can be read with pyserial from
  `~/.platformio/penv/bin/python` (toggle RTS to reset).

## Dependency update (started 2026-10-16, branch `feature/deps-update`)

Goal: latest versions that still build and run on the Atom Echo (classic ESP32, 4 MB, tight IRAM).
Versions checked 2026-10-16.

- **Firmware, step A: done, BLE OTA tested on the Echo.** `espressif32@6.13.0` +
  `framework-espidf@3.50502` (ESP-IDF 5.5.0 -> **5.5.2**). `mdns` 1.14.0 and `led_strip` 3.1.0~1 were
  already the newest. Both active envs build and sign.
  - **ESP-IDF 5.5.3 breaks BLE OTA on classic ESP32:** the link drops (reason 520 = HCI 0x08
    Connection Timeout) on the first flash writes while OTA data arrives. Not caused by config:
    bisected on the Echo (OTA conn params, data length, the new NimBLE memory options and the IRAM
    settings were each ruled out; 5.5.0 and 5.5.2 work with the same settings). Recheck on a later
    5.5.x before moving past 5.5.2.
  - 5.5.2 overflows the Echo's iram0 by ~100 B. Fixed with `CONFIG_RINGBUF_PLACE_FUNCTIONS_INTO_FLASH`
    in `sdkconfig.defaults.esp32` (~690 B free now). Moving the GPTimer/MCPWM/I2C ISRs saves nothing
    (those drivers aren't linked).
  - **Don't turn off `CONFIG_ESP_WIFI_RX_IRAM_OPT`** to save IRAM: with BT coexistence that breaks
    BLE OTA the same way (tested on 5.5.0).
  - ESP-IDF 5.5.5 (`framework-espidf@4.50505`) needs platform 7.x; on 6.13.0 the builder fails
    ("No closing quotation") even with its toolchain pinned. 5.5.2 needs 6.13.0's toolchain (6.12.0
    fails the tool version check).
  - BLE OTA test: when testing, look for `ble_ota: Stalled at ... bytes` followed by `reason=520`.
- **Firmware, step B (separate branch, optional):** platform `7.1.3` / ESP-IDF 6.1. Needs the
  `espressif/cjson` component (IDF 6 drops cJSON), a check of `ota.c` signature verify against
  mbedTLS 4 / PSA (`mbedtls/pk.h`), GCC 15 warnings, and IRAM again. Only if step A is done.
- **UI (`eomui`):** in-range updates first (Capacitor 8.5.3, svelte 5.57, vite 7.3, etc.), then the
  majors one by one: vite 8 + vite-plugin-svelte 7 + vite-plugin-pwa 2 together, TypeScript 7,
  `@types/node` 26. Leave `buttplug` at 0.13.2 (patched with patch-package; 5.x is a rewrite).
- **CI:** bump GitHub actions to current majors and Python 3.11 -> 3.13.
- Build quirks: the first build with a new ESP-IDF version can fail creating its Python venv
  (`~/.platformio/penv/.espidf-<ver>`). Rerun, or delete that folder if PlatformIO says it can't.
  After deleting `dependencies.lock`, build envs one at a time (`pio run -e X` twice); building two in
  one run failed the second.

## Next steps

0. PRs #7 and #8 and the 3.1.0 bump are merged to `main` (fd57fb3); `v3.1.0` tag pushed 2026-10-16 (check the release run on GitHub). Was:
   `git tag v3.1.0 && git push origin v3.1.0`. Still to test on the Echo: the modern UI (see
   "Modern UI" above) and `post_orgasm_menu_lock`.
1. Make sure the `OTA_SIGNING_KEY` repo secret holds the contents of `keys/ota_signing_key.pem`.
   Without it, a tag release fails on purpose.
2. Do a first test release from `main`: `git tag v2.0.1 && git push origin v2.0.1` (the tag must
   match `PROJECT_VER`). Check that the active envs build and that
   `releases/latest/download/manifest.json` resolves and lists every board.
3. Phase 2 (probably WiFi OTA using the manifest), after confirming the scope.

## Safety stops (2026-10-16, merged to `main` locally 2026-10-17, d56e37c)

Backlog items 2 and 3. Both envs build, `svelte-check` clean. **Tested on the Echo 2026-10-17: all
stops, the banners, the Safety tab and the BLE settings fix work.**

- `src/safety.c` / `src/include/safety.h`: `safety_tick(pressure)` runs from `orgasm_control_tick()`.
  A stop = `orgasm_control_set_output_mode(OC_MANUAL)` + `orgasm_control_set_pleasure(0)`. In
  automatic modes the firmware doesn't drive the DAC (clients follow the reported pleasure), so
  zeroing pleasure is what stops every output.
- Sensor fault (automatic modes only, `sensor_fault_stop`, default on): 25 failed reads in a row
  (`eom_hal_get_pressure_read_failures()`), pinned at `EOM_HAL_PRESSURE_MAX` for 10 s, or the exact
  same value for 30 s. LED flashes red fast until a mode is started again.
- `disconnect_stop_s` (default 10, 0 = off): stop when no BLE (`isConnected`) and no WS client for
  that long. A BLE toy reading output1 counts as a client too.
- `max_session_minutes` (default 0 = off): any session, Manual with pleasure > 0 included.
- `max_motor_output` (default 255): clamps the HAL motor writes, `set_pleasure_ex` and
  `get_pleasure`, so it also covers BLE direct motor writes, which skip `max_pleasure`.
- Stop reason (`safety_stop_t`): WS `readings.safety`, BLE status byte 18 (status is 19 bytes now).
  Cleared when a mode starts or pleasure > 0 is set. UI shows a banner; new "Safety" settings group.
- Spotted, not fixed: `pressure_ambient` in `eom-hal-esp32.c` is a `uint8_t`, so an ambient above
  255 is truncated (and the MPR 24-bit ambient is meaningless). Fixing it changes readings, so
  thresholds people have tuned would shift. Ask Russ.
- Echo test 2026-10-16: sensor-fault stop + red flash work. No banner showed because the UI used was
  an old build; `eomui/public/index.html` was rebuilt (`npm run build`) and now has the banner
  and Safety settings. Banners confirmed working. The Safety tab was missing
  (`SETTINGS_TABS` in `App.svelte`), added and rebuilt. Other stops still to retest.
- **Config bug fixed (pre-existing):** `CFG_*` macros in `config_defs.h` reset every setting declared
  *before* the key on a single-key `set_config_value()` (BLE `0x02` writes; WS uses merge and was
  fine). So each BLE setting change reset earlier settings to defaults, and they were then saved.
  That's why turning off sensor fault stop and the time limit "didn't work". The reset branch now
  only runs when `key == NULL`. Builds; retest on the Echo, and recheck settings, since earlier BLE
  writes may already have saved defaults. **Rebuild the UI after UI changes.**
- To test on the Echo: start Endless and unplug the sensor/tube -> stop within ~30 s, red flash, UI
  banner. Start a session, disconnect the app -> stop after 10 s, banner on reconnect. Set the time
  limit to 1 min. Set Output limit low and check Manual and Endless never exceed it.

## Feature backlog (agreed with Russ 2026-10-16)

Numbering matches the original list. 2 and 3 are done on `feature/safety` (see above).

1. **Wi-Fi OTA (Phase 2)** + "Check for updates" in the UI (compare `manifest.json` version for
   this board; offer the update over BLE or Wi-Fi).
2. **Sensor fault detection** — in progress. Pressure stuck at a rail or not changing at all -> stop the motor, red LED.
3. **Disconnect stop + session limits** — in progress. Ramp down when the last BLE/WS client drops (setting);
   maximum session length; hard motor output cap separate from mode settings.
4. **Atom Echo button (G39):** short = stop/start, long = cycle modes, double = unlock settings.
5. **Atom Echo speaker (I2S):** sounds for edge, denial, orgasm allowed, connected.
6. **Session history:** log pressure/arousal/motor (SPIFFS or stream), UI graph, stats (edges,
   duration, denials), CSV export.
7. **Auto-calibration:** follow the resting pressure baseline and its drift; suggest a sensitivity threshold from history.
8. **Presets:** save/load the current settings under a name (JSON of the `settings.ts` keys).
9. **Timed programs:** e.g. 20 min edging then random orgasm chance, N edges before release, denial lottery.
10. **Keyholder / partner mode:** PIN for settings/mode changes (extends `edge_menu_lock`),
    view-only second WS client.
11. **MQTT / Home Assistant** state + commands.
12. **Housekeeping:** host unit tests for `orgasm_control` edge detection, post-orgasm refactor
    TODO, deps step B (ESP-IDF 6).
13. **After-orgasm modes** (asked 2026-10-17), chosen per session, replacing the unused
    `use_post_orgasm` toggle (defined and in the UI, but the firmware never reads it):
    - **Ruin:** turn everything off as soon as an orgasm is detected.
    - **Post-orgasm:** today's behaviour (max for `post_orgasm_duration_seconds`, ramp down, Manual).
    - **Milking:** keep going after an orgasm and run the cycle again to try for another one.
      Russ said "starts manual, endless and orgasm modes again"; confirm exactly what sequence
      that means before building it.
    Detection is `orgasm_control_clench_detect()` (clench held `clench_time_to_orgasm_ms`, only
    counts once orgasm is permitted in Orgasm mode); the reaction is in
    `orgasm_control_update_edging_time()`. Related: send an "orgasm detected" signal to the UI (the
    `EVT_ORGASM_START` dispatch is commented out), and reset `clench_pressure_threshold` per session.

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
- **Build pins:** espressif32@6.13.0 / ESP-IDF 5.5.2. Not 5.5.3 (breaks BLE OTA on classic ESP32) and not 6.x (drops cJSON).
- **Partitions:** `8mb_spiffs.csv` app slots are 3.9 MB each. 8 MB boards needed an erase after
  phase 0.

## Unrelated open TODOs in the code (low priority)

- [src/wifi_manager.c:167](src/wifi_manager.c#L167): function not implemented.
- [src/api/broadcast.c:47](src/api/broadcast.c#L47): value should come from the active connection.
- [src/include/orgasm_control.h:73](src/include/orgasm_control.h#L73): refactor post-orgasm modes.
