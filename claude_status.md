# Claude status

Read this at the start of a new session to pick up where work stopped. Update it whenever a task
finishes or the plan changes: move items from **Backlog** to **Done** and keep **Snapshot** current.

_Last updated: 2026-10-17_

## Snapshot

- **Version:** `PROJECT_VER` in [CMakeLists.txt](CMakeLists.txt) is **3.4.0**. `main` is pushed and
  tags `v2.0.1` to `v3.4.0` are on GitHub. Release with
  `git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z` (tag must match `PROJECT_VER`).
- **Branches:** only `main`. Merged feature branches were deleted locally and on GitHub
  2026-10-17. An unmerged dependabot branch (`dependabot/npm_and_yarn/eomui/handlebars-4.7.10`) is
  still on GitHub.
- **Build pins:** espressif32@6.13.0 / ESP-IDF 5.5.2 (see "Dependencies" under Key facts).
- **Test hardware:** M5Stack Atom Echo. Russ has no pressure sensor yet, so tests use the pressure
  simulator build.
- `gh` CLI is not installed, so CI runs, releases and PRs can't be checked from here. Look on GitHub.

---

# Backlog (to do)

## 1. Testing still owed on the Echo

| What | How to test |
|---|---|
| **`post_orgasm_menu_lock`** | Turn it on, get an orgasm detected in Orgasm mode -> settings lock; lock clears when ramp-down ends. |

## 2. Release / infrastructure checks

- GitHub reports 130 Dependabot alerts on `main` (6 critical, 83 high), most likely from `eomui`
  npm packages. Review them with the UI dependency updates (Backlog 5).
- All envs except `esp32dev` and `m5stack_atom_echo` are commented out in `platformio.ini`, so CI and
  releases only build those two. **Uncomment them before a full release.**

## 3. Open questions for Russ

- **Phase 2 scope** (feature 1 below): probably OTA over Wi-Fi from `manifest.json`. Confirm before
  building.

## 4. Features (agreed with Russ 2026-10-16, original numbering)

1. **Wi-Fi OTA (Phase 2)** + "Check for updates" in the UI: compare the `manifest.json` version for
   this board and offer the update over BLE or Wi-Fi. Needs scope confirmed (see above).
4. **Atom Echo button (G39):** short = stop/start, long = cycle modes, double = unlock settings.
5. **Atom Echo speaker (I2S):** sounds for edge, denial, orgasm allowed, connected.
8. **Presets:** save/load the current settings under a name (JSON of the `settings.ts` keys).
9. **Timed programs:** e.g. 20 min edging then random orgasm chance, N edges before release, denial
   lottery.
10. **Keyholder / partner mode:** PIN for settings/mode changes (extends `edge_menu_lock`), view-only
    second WS client.
11. **MQTT / Home Assistant** state + commands.
12. **Housekeeping:** host unit tests for `orgasm_control` edge detection, the post-orgasm refactor
    TODO, deps step B (below).

Done: 2, 3, 6, 7, 13 (see Done).

## 5. Dependency updates still to do

- **UI (`eomui`):** in-range updates first (Capacitor 8.5.3, svelte 5.57, vite 7.3, etc.), then the
  majors one by one: vite 8 + vite-plugin-svelte 7 + vite-plugin-pwa 2 together, TypeScript 7,
  `@types/node` 26. Leave `buttplug` at 0.13.2 (patched with patch-package; 5.x is a rewrite).
- **CI:** bump GitHub actions to current majors (`checkout@v4` etc. today) and Python 3.11 -> 3.13
  in `.github/workflows/release.yml`.
- **Firmware step B (optional, separate branch):** platform `7.1.3` / ESP-IDF 6.1. Needs the
  `espressif/cjson` component (IDF 6 drops cJSON), a check of `ota.c` signature verify against
  mbedTLS 4 / PSA (`mbedtls/pk.h`), GCC 15 warnings, and IRAM again.
- **Recheck later ESP-IDF 5.5.x** for the BLE OTA link drop before moving past 5.5.2.

## 6. Small TODOs in the code (low priority)

- [src/wifi_manager.c:167](src/wifi_manager.c#L167): function not implemented.
- [src/api/broadcast.c:47](src/api/broadcast.c#L47): value should come from the active connection.
- [src/include/orgasm_control.h:73](src/include/orgasm_control.h#L73): refactor post-orgasm modes.
- `EVT_ORGASM_START` dispatch is still commented out (no event manager in use).

---

# Done

| Item | Version / commit | Tested on the Echo? |
|---|---|---|
| OTA phase 0: rollback, signing, shared OTA module | 02ec11b | Yes |
| OTA phase 1: firmware updates over BLE | c21494d | Yes |
| OTA phase 3: release pipeline (CI + signed GitHub release + manifest) | PR #4, 123e7ba | Yes |
| `OTA_SIGNING_KEY` repo secret set, signed releases working | — | Yes |
| Modern UI | 3.0.0, PR #7 | Yes |
| Device boots stopped instead of Endless | 4687b18 | Yes |
| Status LED (blue flash until connected, then green) | 3.1.0, PR #8 | Yes |
| `post_orgasm_menu_lock` | 3.1.0, c1416e5 | No |
| Dependency update step A (ESP-IDF 5.5.2) | `feature/deps-update` | Yes, BLE OTA |
| Safety stops (backlog 2, 3) + BLE settings fix | 3.2.0, d56e37c | Yes, all stops |
| After-orgasm modes (backlog 13) + Orgasms counter | 3.3.0, 95357c2 | Yes, with simulator |
| Pressure simulator | 3.3.0, 95357c2 | Yes |
| Session history + auto-calibration (backlog 6, 7) | 3.4.0, 5ef8b5a | Yes |

Details of each, for reference when changing that code:

### OTA (phases 0, 1, 3)

- Phase 0: [src/system/ota.c](src/system/ota.c). Phase 1: [src/system/ble_ota.c](src/system/ble_ota.c),
  UI `eomui/src/FirmwareUpdate.svelte`. Phase 3: CI builds every active env; a `v*` tag publishes a
  signed GitHub release + `manifest.json`.
- Phase 2 isn't in git history. Phase 0's commit says "groundwork for OTA updates over BLE and WiFi",
  hence the guess that it is Wi-Fi OTA.

### Modern UI (3.0.0)

Rewrite of `eomui/src/App.svelte` with every device setting. `svelte-check` is clean for the new
files (the toy components and node_modules still have many old type errors).

- `eomui/src/lib/settings.ts` is the single list of device settings (label, range, format, group,
  `restart` flag, `visible` rule). Add a setting there and it shows up in the drawer. A new *group*
  also needs an entry in `SETTINGS_TABS` in `App.svelte`, or it never shows. Keys must match
  `CONFIG_DEFS` in `src/config.c`.
- Exposed: all Wi-Fi/AP settings, hostname, `use_ssl`, `websocket_port`, `bt_on`, `bt_display_name`,
  `force_bt_coex`, `classic_serial`, `edge_menu_lock`, `post_orgasm_menu_lock`. Left out on purpose:
  console settings, SSL paths.
- App-only prefs (localStorage `eom.prefs`): WebSocket URL, start view, keep screen on (Wake Lock),
  "Apply pressure" step, `pressureSim`, "Record sessions".
- Firmware changes for it: BLE setting writes (0x02) are saved to flash; BLE `0x04` = save and
  restart (old firmware ignores it, so restart there only works over Wi-Fi); WS `readings.lock` =
  settings lock.
- Fixed in passing: BLE `permit` decoded as `*255` (now `<<8`); WS readings were never trimmed;
  the stale-data timer was re-created on every WS connect.
- The device boots stopped (Manual, pleasure 0): `orgasm_control_init()` and `main_task()` in
  `src/main.c`. The UI shows "Stopped" for Manual at 0%.
- `post_orgasm_menu_lock`: code in `orgasm_control_update_edging_time()` was commented out and is
  back on. Locks settings when an orgasm is detected in Orgasm mode; clears when post-orgasm
  ramp-down ends.

### Status LED (3.1.0)

- `orgasm_control_update_idle_led()` in `src/orgasm_control.c` (WS2812 only) runs while no automatic
  mode is active: flashing blue (500 ms) until a BLE client (`isConnected`) or WS client
  (`websocket_client_count()`) connects, then solid green. Automatic modes keep their colours.
- `eom-hal-esp32.c`: `led_show_current()` pushes colour-or-off to the LED task and skips unchanged
  refreshes. The off half of a flash is fully off.
- Real cause on the Echo: the strip was `LED_MODEL_WS2811`, which the SK6812 ignores. Now
  `LED_STRIP_MODEL` (config.h, default `LED_MODEL_WS2811`) and the Echo env sets `LED_MODEL_SK6812`.

### Safety stops (3.2.0)

- `src/safety.c` / `src/include/safety.h`: `safety_tick(pressure)` runs from `orgasm_control_tick()`.
  A stop = `orgasm_control_set_output_mode(OC_MANUAL)` + `orgasm_control_set_pleasure(0)`. In
  automatic modes the firmware doesn't drive the DAC (clients follow the reported pleasure), so
  zeroing pleasure stops every output.
- Sensor fault (automatic modes only, `sensor_fault_stop`, default on): 25 failed reads in a row
  (`eom_hal_get_pressure_read_failures()`), pinned at `EOM_HAL_PRESSURE_MAX` for 10 s, or the exact
  same value for 30 s. LED flashes red fast until a mode is started again.
- `disconnect_stop_s` (default 10, 0 = off): stop when no BLE and no WS client for that long. A BLE
  toy reading output1 counts as a client.
- `max_session_minutes` (default 0 = off): any session, Manual with pleasure > 0 included.
- `max_motor_output` (default 255): clamps HAL motor writes, `set_pleasure_ex` and `get_pleasure`,
  so it also covers BLE direct motor writes, which skip `max_pleasure`.
- Stop reason (`safety_stop_t`): WS `readings.safety`, BLE status byte 18. Cleared when a mode
  starts or pleasure > 0 is set. UI shows a banner; "Safety" settings group.
- **Config bug fixed (pre-existing):** `CFG_*` macros in `config_defs.h` reset every setting declared
  before the key on a single-key `set_config_value()` (BLE `0x02` writes). The reset branch now only
  runs when `key == NULL`.

### After-orgasm modes + Orgasms counter (3.3.0)

- Setting `after_orgasm` (`after_orgasm_t` in `config.h`: 0 Ruin, 1 Post-orgasm (default), 2 Milking)
  replaces the unused `use_post_orgasm`. In the Session group and Orgasm-mode quick settings. Also
  `milking_rest_seconds` (60) and `milking_max_orgasms` (3, 0 = no limit).
- Logic is in `orgasm_control_update_edging_time()`. Detection is `orgasm_control_clench_detect()`
  (clench held `clench_time_to_orgasm_ms`, only once orgasm is permitted in Orgasm mode).
  Ruin: `orgasm_control_ruin()` sets Manual, pleasure 0. Milking: post-orgasm max for
  `post_orgasm_duration_seconds`, ramp down, rest at 0 for `milking_rest_seconds`, then
  `orgasm_control_start_milking_round()` restarts edging (session orgasm count and menu lock carry
  over). After `milking_max_orgasms` the last one ends like Post-orgasm.
- **Behaviour change:** during post-orgasm and rest, `orgasm_control_update_pleasure()` returns before
  the edging algorithm. Before, `controller->increment()` overwrote the max every tick.
- Starting any mode resets the session orgasm count, the ruined flag, a stale `detected_orgasm` and
  `clench_pressure_threshold` (to 4096).
- UI signal: WS readings `phase` (`oc_after_orgasm_phase_t`: 1 post-orgasm, 2 resting, 3 ruined),
  `orgasms`, `rest`. BLE status byte 19 orgasms, 20 phase, 21-22 rest (MSB first). "Orgasms" gauge
  and stat, colour `--orgasm`; no reset button (resets when a mode starts).
- Quick test: edging time 1 min, Clench time to orgasm low, hold a clench once permitted.

### Pressure simulator (3.3.0)

- Only with `-DEOM_PRESSURE_SIM`, never in a normal or CI build. Flash with
  `PLATFORMIO_BUILD_FLAGS=-DEOM_PRESSURE_SIM pio run -e m5stack_atom_echo -t upload`; a normal
  upload puts the real sensor back. Changing the flag makes PlatformIO rebuild everything.
- `eom_hal_set_simulated_pressure(value)` (no-op in normal builds): returns that value ±8 noise (so
  the stuck-sensor check doesn't fire). Starts at 0; -1 = real sensor. Set by WS
  `{"simPressure": n}` or BLE control `0x05 MSB LSB` (0xFFFF = real sensor).
- UI: Settings > This app > "Pressure simulator" shows a slider and "Hold to clench" (+1000) in the
  Controls card. The UI can't tell whether the firmware is a sim build.

### Session history + auto-calibration (3.4.0)

- **History is recorded by the app, not the device:** readings go into IndexedDB (`eom-history`) in
  that browser. No flash wear, works on the 4 MB Echo, but only records while the app is open and
  connected. SPIFFS logging was not done.
- `eomui/src/lib/history.ts`: `Recorder` (5 Hz; arousal is the peak per 200 ms bucket). A session
  starts when a mode runs or pleasure > 0, ends 30 s after it stops or 60 s without readings; < 15 s
  is dropped; saved in 10 s chunks; keeps the last 200. Also CSV export and `suggestThreshold()`.
- Stats: duration, edges, denials, orgasms, ruined, safety stop, peak arousal, average pleasure,
  threshold, resting-pressure drift, arousal peak in the minute before each orgasm.
- UI: History button in the top bar (red dot while recording) opens `lib/SessionHistory.svelte`.
- **Auto-calibration:** `orgasm_control_update_baseline()` follows resting pressure (falls fast, tau
  2 s; within half the clench sensitivity tau 20 s; above that tau 300 s, unless up longer than
  `max_clench_duration_ms`, then tau 5 s). Setting `auto_baseline` (default on, "Follow resting
  pressure") keeps the clench threshold at least baseline + `clench_pressure_sensitivity`/2.
  Arousal is peak-to-peak, so drift never affected it.
- Baseline reported as WS `baseline` and BLE status bytes 23-24 (status is 25 bytes now).
- **Threshold suggestion** (Settings > Detection > Calibration): last 10 sessions with > 1 min in
  Endless/Orgasm. With orgasms: 80% of the median arousal peak before them. Otherwise from the latest
  session: > 2 edges a minute -> +15%; no edges in 10+ min -> -15%.

---

# Key facts (so the code doesn't need re-reading)

## Hardware / envs

- **M5Stack Atom Echo** (`[env:m5stack_atom_echo]`, board `m5stack-atom`, 4 MB, SK6812 LED on G27,
  pressure on Grove G32 = `ADC_CHANNEL_4`). Serial on `/dev/cu.usbserial-*`; read boot logs with
  pyserial from `~/.platformio/penv/bin/python` (toggle RTS to reset).
- Classic ESP32 IRAM is tight. `sdkconfig.defaults.esp32` moves RMT/SPI-slave handlers and ringbuf
  functions out of IRAM (~690 B free on 5.5.2). `sdkconfig.<env>` files are git-ignored and
  regenerated, so put sdkconfig changes in a defaults file. **Don't turn off
  `CONFIG_ESP_WIFI_RX_IRAM_OPT`:** with BT coexistence it breaks BLE OTA.
- RMT DMA (`with_dma`) only exists on S3/P4; `configure_led_2812` enables it only
  `#if SOC_RMT_SUPPORT_DMA` (otherwise non-S3 WS2812 boards boot-loop).
- WS2812 refreshes all run in one `LED` task pinned to core 0, which also creates the RMT channel.
  `eom_hal_set_rgb()` only queues the colour. Refreshing from the other core raced the RMT TX-done
  ISR and left the channel stuck.

## Pressure sensor ambient (parked)

- **`pressure_ambient` is a `uint8_t`** in `eom-hal-esp32.c`. Russ decided 2026-10-17 to **leave it
  alone**. Fix MPR only when an MPR board is built:
  - Today the boot ambient is the mean raw ADC value mod 256 (e.g. 1800 -> 8), so analog readings are
    effectively raw ADC. Everything downstream is relative (arousal is peak-to-peak, the clench
    threshold adapts, `auto_baseline` follows resting pressure), so `sensitivity_threshold` etc. don't
    depend on it.
  - Changing only the type would break things: `eom_hal_setup_pressure_ambient()` averages
    `eom_hal_get_pressure_reading()`, which already subtracts the ambient, and any reading below
    ambient re-runs setup. Resting readings would sit around 0, half the samples would trigger setup,
    and the ambient would oscillate.
  - Even done properly, resting pressure clamped at 0 trips the safety "same value for 30 s" check, and
    readings can no longer reach `EOM_HAL_PRESSURE_MAX`, so the "pinned at max" check stops working.
  - MPR: no env builds it (`PRESSURE_SENSOR` defaults to analog). Its ambient is effectively 0, so it
    reports absolute pressure and probably sits at the max. It needs an `int32_t` ambient taken from
    raw 24-bit data. Needs a real sensor to test; the simulator skips this code.

## Protocol

- BLE status is 25 bytes: 17 settings lock, 18 safety stop, 19 orgasms, 20 phase, 21-22 rest,
  23-24 baseline (multi-byte values MSB first).
- BLE control: `0x02` set setting (saved), `0x04` save and restart, `0x05` simulated pressure.

## OTA

- **Signing:** an ECDSA P-256 trailer is appended to `firmware.bin` by `tools/sign_firmware.py`.
  Keys come from `tools/gen_signing_keys.py` into `keys/` (git-ignored). Devices only accept images
  signed with the key their firmware was built with. ESP-IDF's signed-app support isn't used because
  PlatformIO doesn't pass the key to the bootloader build.
- **Image checks** in `ota.c`: chip, project, board (`EOM_BOARD` from `tools/board_name.py`, in
  `eom_app_desc`), no downgrades, and the signature, all before switching the boot partition.
- **Rollback:** a new image is confirmed after 30 s with the control loop ticking, else it rolls back.
- **BLE OTA:** control characteristic 0x696D, data 0x696E, 16 KB window acknowledged by PROGRESS,
  RESEND for lost chunks. Protocol in `src/include/system/ble_ota.h`. The BLE address is derived
  from the MAC plus a GATT-layout hash, so unbonded clients re-read the table when it changes.
- **Manifest:** `tools/make_manifest.py` writes `{env, version, url, sha256, size}` per board and
  refuses unsigned images, the wrong board, or a version mismatch.
- **Partitions:** `8mb_spiffs.csv` app slots are 3.9 MB each. 8 MB boards needed an erase after
  phase 0.

## Dependencies

- Pinned: `espressif32@6.13.0` + `framework-espidf@3.50502` (ESP-IDF 5.5.2). `mdns` 1.14.0 and
  `led_strip` 3.1.0~1 are the newest.
- **Not 5.5.3:** breaks BLE OTA on classic ESP32 (link drops, reason 520 = HCI 0x08, on the first
  flash writes). Bisected on the Echo; not a config issue. When retesting, look for
  `ble_ota: Stalled at ... bytes` followed by `reason=520`.
- 5.5.5 (`framework-espidf@4.50505`) needs platform 7.x. 5.5.2 needs 6.13.0's toolchain.
- Build quirks: the first build with a new ESP-IDF can fail creating its venv
  (`~/.platformio/penv/.espidf-<ver>`); rerun, or delete that folder. After deleting
  `dependencies.lock`, build envs one at a time (`pio run -e X` twice).
- **Rebuild the UI (`npm run build` in `eomui`) after UI changes**, so `eomui/public/index.html` is
  up to date. Testing with a stale build hid the safety banner once.
