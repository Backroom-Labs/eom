# Claude status

Read this at the start of a new session to pick up where work stopped. Update it whenever a task
finishes or the plan changes: move items from **Backlog** to **Done** and keep **Snapshot** current.

_Last updated: 2026-10-20_

## Snapshot

- **Version:** `PROJECT_VER` in [CMakeLists.txt](CMakeLists.txt) is **3.6.0** (detailed recording +
  arousal fade/memory), committed on `main` as e6d72a0 2026-10-19 and pushed, not tagged. 3.5.0 (heart rate) was committed
  as 9c94e22, tagged `v3.5.0` and pushed 2026-10-17 (heart-rate features not yet tested on the
  Echo). Tags `v2.0.1` to `v3.5.0` are on GitHub; check the v3.5.0 CI release there. Release with
  `git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z` (tag must match `PROJECT_VER`).
- **Branches:** only `main`. `feature/control-command` (architecture refactor) was merged into
  `main` as 7c9f33a 2026-10-19, before testing on the Echo. The toy output + Endless ramp fixes were
  merged as f8416ef 2026-10-20 and `main` is pushed. Merged feature branches were deleted locally and on GitHub 2026-10-17. An unmerged dependabot branch (`dependabot/npm_and_yarn/eomui/handlebars-4.7.10`) is
  still on GitHub.
- **Build pins:** espressif32@6.13.0 / ESP-IDF 5.5.2 (see "Dependencies" under Key facts).
- **Test hardware:** M5Stack Atom Echo. Russ has no pressure sensor yet, so tests use the pressure
  simulator build.
- `gh` CLI is installed and logged in as backroom-labs (2026-10-19).
- **Host tests:** `pio test -e native` (Unity, no hardware). CI runs them before the firmware builds.
  App tests: `node --test test/*.test.ts` in `eomui` (Node's built-in runner; not in CI yet).
- **Agent docs:** `AGENTS.md` (imported by `CLAUDE.md`), `docs/agents/`, `GLOSSARY.md`, `docs/adr/`.

---

# Backlog (to do)

## 1. Testing still owed on the Echo

| What | How to test |
|---|---|
| **`post_orgasm_menu_lock`** | Turn it on, get an orgasm detected in Orgasm mode -> settings lock; lock clears when ramp-down ends. |
| **Control command + status snapshot refactor** (merged 7c9f33a) | Flash `main`. Over both BLE and Wi-Fi: modes, motor slider, trigger arousal, reset denied, settings changes and the pressure simulator behave as before, and the live chart, status and History look the same (wire format is meant to be unchanged). New: set Max pleasure low, then drive the motor from BLE or a Monsterpub remote; it must not go above Max pleasure (before, it did). A remote motor write now switches to Manual. |
| **Detailed recording + arousal fade/memory** (3.6.0) | Flash 3.6.0. (1) Settings > App > Detailed recording on, run a session, History > Export detailed CSV: ~50 rows a second, `reading` numbers mostly consecutive (gaps = lost BLE notifications). Try over BLE and Wi-Fi. (2) Detection > Arousal fade time 1.4 s should feel exactly as before; raise to 5-10 s and watch arousal fall more slowly on the chart. (3) Arousal memory e.g. 60 s: after a burst, arousal holds at the Warning threshold and fades slowly; it must never edge on its own. Starting a mode clears it. |
| **Heart-rate features** (3.5.0, firmware + app) | Flash the firmware and rebuild the app first. With the ring connected: (1) Settings > Heart rate tab shows "Heart rate now"; WS `readings.hr` / BLE status byte 25 should match the ring, which proves the EOM receives it. (2) Wait for heart rate to settle = e.g. 5 bpm: after an edge the status says "Waiting for your heart rate to settle (at most Ns)" until it drops, never longer than the max. (3) Edge zone heart rate set just below your current HR: a second pink marker appears on the arousal gauge and edges trigger earlier. (4) Orgasm heart rate set above your HR: in Orgasm mode, once permitted, a clench is ignored (serial log "Clench ignored"). (5) Heart rate limit set below your HR: stops after 10 s with the heart-rate banner. (6) HR drop orgasm detection: hardest to test; try last. (7) Removing the ring / closing the app: everything falls back within 5 s. Also check the live chart's new time axis. |
| **O2Ring heart rate in History** (3.5.0) | Live heart rate works with Russ's O2 Ring Pro (OxyII, no encryption needed). Still to check: record a session with the EOM and ring connected, then confirm the History graph line, avg/peak stats and CSV `heart_rate` column. |

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
12. **Housekeeping:** host unit tests for `orgasm_control` edge detection (the suite
    `test/test_orgasm_control` exists now and covers starting Endless; add edge, cooldown and
    post-orgasm cases there), the post-orgasm refactor TODO, deps step B (below).

Done: 2, 3, 6, 7, 13 (see Done).

**Algorithm ideas** (from the restim wiki, agreed 2026-10-17): detailed recording and arousal
fade/memory are done (3.6.0). Next candidates: an orgasm detector from the pressure drop at orgasm
plus rhythmic contractions (tune from detailed CSVs), checking whether heart rate actually helps
using History, and an optional girth sensor input.

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

- `duration()` in `eomui/src/lib/SessionHistory.svelte` floors minutes then rounds seconds, so
  17:59.8 shows as "17m 60s".
- Docs behind the README: `doc/Config.json.md` and `doc/WebSocket.md` don't list the 3.x settings
  and reading fields (the README has tables of both). `eomui/README.md` still shows the old
  `doc/Screenshot3.png`; `doc/Screenshot2.png`/`Screenshot3.png` are now unused by the main README.

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
| README rewrite for 3.x + new screenshots (`doc/screenshots/`) | 2026-10-17 | n/a |
| O2Ring heart rate in the app (live + history) | 3.5.0, 9c94e22 | Live: yes (O2 Ring Pro). History: not yet |
| Heart rate used by the firmware (cooldown, edge zone, orgasm, safety) + suggestions + live chart time axis | 3.5.0, 9c94e22 | No. Builds for Echo + esp32dev; history stats tested offline |
| Buttplug toy output fixes (full range, fewer commands, Invert) + Endless ramp fixes | 2efac2a, merged f8416ef | Yes, Lovense Domi, 2026-10-20 |

Details of each, for reference when changing that code:

### Toy output + Endless ramp fixes (2efac2a, 2026-10-20)

- Reported with a Lovense Domi: never reached full power, its light flashed constantly, steps felt
  jumpy, and later Endless jumped straight to 100%. Russ tested the fixes: all fine.
- **App** (`eomui/src/lib/toyOutput.ts`, tests in `eomui/test/toyOutput.test.ts`): toy-following
  logic moved out of `App.svelte`/`ButtplugConnector.svelte`. (1) Controls defaulted to max 100/255,
  capping toys at 39%; now 255. (2) A command went out on every 1/255 change; the Domi has 20 levels,
  so ~95% of commands changed nothing and each flashed the light. `ToyFollower` now sends only when
  the toy's level changes, at most every 100 ms (`MIN_COMMAND_GAP_MS`); step count comes from the
  feature's `Output[type].Value`, else 100. (3) Invert was applied twice (App and
  `handleDeviceChange`); now once in `scalarFor()`.
- Level jumps (5% each on the Domi) are the toy's 20-level limit; nothing more to do in the app.
- **Firmware** (`src/orgasm_control.c`): (1) `set_output_mode()` kept the old pleasure, and Depletion
  keeps its ramp position between sessions, so Manual -> Endless could start at the old level or 100%.
  Now Manual -> any automatic mode zeroes pleasure and `motor_start_time`, so the next update calls
  `controller->start()`. Endless -> Orgasm (permit) does not reset. (2) `update_check()` evaluated its
  value twice, so `controller->increment()` ran twice per update and ramps took half of
  `motor_ramp_time_s`. It now evaluates once; ramps feel twice as slow at the same setting.
- New host suite `test/test_orgasm_control` runs the real `orgasm_control.c` and all vibration modes
  on a fake clock and pressure sensor (`fakes.c`). Adds stubs `esp_timer.h`, `esp_err.h`,
  `esp_http_server.h`, `freertos/FreeRTOS.h` in `test/stubs`. Start the fake clock well after boot
  (it uses an hour), or the edge delay holds pleasure at 0.
- A stale `eomui/public/index.html` (built 2026-10-17) hid the app fix at first; see the rebuild note
  at the end.

### Detailed recording + arousal fade/memory (3.6.0, uncommitted)

- Prompted by the restim wiki (github.com/diglet48/restim/wiki/edging-sensor-data): involuntary
  contractions run ~1-2 min on / ~1 min off and orgasm is still possible in the off part; the old
  arousal halved in ~1.4 s, so it read ~0 in the quiet part. Other wiki points not done yet (backlog
  4, "Algorithm ideas"): orgasm signature = pressure drop + rhythmic contractions; HR "not well
  correlated" per the author; girth sensor.
- Firmware: `orgasm_control_update_arousal()` decays with `arousal_fade_ms` (half-life, default
  1400 = old `* 0.99` at 50 Hz, truncating like before) and, if `arousal_memory_s` > 0, keeps arousal
  >= a peak follower that halves every arousal_memory_s, capped at `mid_threshold` (or 90 % of the
  edge threshold if mid >= edge). Memory cleared in `set_output_mode()`.
- Raw pressure: ring buffer of the last 32 `pressure_value`s with a reading counter (portMUX),
  `orgasm_control_get_raw_pressure()`. WS readings `rawSeq` + `raw` (last 8); **BLE status is 62
  bytes**: 27-28 counter low 16 bits, 29 count (16), then 16 u16 MSB first. Notify is every 100 ms
  (`ble_task`, vTaskDelay(10) at 100 Hz tick), so 16 samples cover a missed notification.
- App: pref `detailedRecording` (off). `Recorder.addRaw()` de-duplicates by reading number into
  `RawSegment`s (new segment on a gap) saved inside chunks (`raw` field, no DB version bump);
  summary `rawSamples/rawHz/rawSeq0/rawT0` map reading numbers to session time. `toDetailedCsv()`;
  "Export detailed CSV" in SessionHistory. BLE counter is unwrapped to 32 bits in App.svelte.
- README: 3.6.0 row, detailed CSV, "Arousal fade and memory" section, tables. Also fixed the
  suggested-threshold bullet, which had raise/lower backwards.

### Heart rate in the firmware (3.5.0)

- Russ asked for all of it at once, to test later. Every feature is a setting, 0 = off (default),
  and each falls back to pressure-only when `heart_rate_get()` is 0 (no reading for 5 s).
- `src/heart_rate.c/.h`: `heart_rate_set()` from WS `{"heartRate": n}` (api/edging.c) or BLE control
  `0x06 bpm` (gatt_svc.c). The app sends it on every ring reading (~1 Hz), and 0 when the ring goes.
- Settings (config.h/config.c, "Heart rate" group/tab in settings.ts): `hr_recovery_bpm`,
  `hr_recovery_max_s` (90), `hr_edge_bpm`, `hr_edge_sensitivity` (20 %), `hr_orgasm_min_bpm`,
  `hr_orgasm_drop_bpm`, and `hr_max_bpm` in the Safety group.
- orgasm_control.c: `orgasm_control_edge_threshold()` replaces `Config.sensitivity_threshold` in the
  edge check and `twitch_detect()` (reported `threshold` stays the configured one; the app draws the
  lowered one from `hrZone`). `orgasm_control_hr_recovery_hold()` extends the cooldown after
  edge_delay+random until HR <= peak since edge - hr_recovery_bpm, capped at hr_recovery_max_s after
  the edge (cooldown then counts down to that cap). Peak is reset at each denial and
  `trigger_arousal`. `hr_orgasm_min_bpm` gates the clench in `clench_detect()`;
  `orgasm_control_hr_orgasm_detect()` (drop within 30 s of the peak, still stimulated) runs in the
  permitted loop. `set_output_mode()` clears the HR state.
- safety.c: `SAFETY_HEART_RATE = 4` when HR > hr_max_bpm for 10 s.
- Readings: WS `hr`, `hrWait`, `hrZone`; **BLE status is 27 bytes**: 25 = HR the EOM uses, 26 =
  flags (bit 0 waiting, bit 1 edge zone).
- History (history.ts): summary `edgeHrs`, `edgeHrDrops`, `orgasmHrPeaks`, `orgasmHrDrops` (drop =
  peak to low within 60 s after). `suggestHeartRate()`: edge zone = median edge HR - 5; recovery =
  60 % of median drop; orgasm min = 90 % of median pre-orgasm peak; orgasm drop = 60 % of median
  drop. Shown with Apply buttons in the Heart rate tab; stats in SessionHistory.
- Live chart: time axis (seconds before now) with vertical grid lines.
- README: Heart rate section, safety row, readings/BLE/WS/settings tables, What's new 3.5.0.
  `PROJECT_VER` bumped to 3.5.0.
- Known nit: gatt_svc.c logs every control write at ESP_LOGE ("Received data ..."), so the 1 Hz
  heart rate fills the serial log. Left as is.

### O2Ring heart rate (3.5.0, app side)

- Russ has a SleepHQ O2 Ring Pro (rebadged Wellue/Viatom O2Ring). nRF Connect showed service
  `14839ac4-7d7e-415c-9a42-167340cf2339`, same as the original O2Ring.
- **The Pro is OxyII, not the legacy O2Ring protocol.** It also exposes the legacy 14839ac4 service
  but ignores 0xAA commands (that's why tries 1-2 got nothing). khromov/wellue-o2ring-web-ui lists it
  as "SHQO2Pro" (OxyII). `eomui/src/lib/o2ring.ts` picks OxyII when service `e8fb0001-...` exists,
  else legacy (MackeyStingray/o2r). Writes go without response first (with response failed with
  "GATT operation failed"), chunked to 20 bytes.
- OxyII: `A5 cmd ~cmd flag seq len16 payload crc8`; sends `10 [00]` (auto-RT off), then polls `04`
  every 1 s, one request at a time, matched by seq. RtParam [5] sensor, [6] SpO2, [7] PI x10, [8-9]
  PR. After 3 failed polls it tries AUTH (0xFF) once; if the ring returns a key it wants AES-128-ECB,
  which isn't implemented (console error says so).
- The picker lists all devices (ring names vary and the service may not be advertised).
- App: Connection dialog "Heart rate" section, "Heart rate" gauge and chart line (40-200 bpm on the
  0-100% axis) while connected. `pushReading()` adds `hr` to each EOM reading if the ring's last
  reading is < 5 s old, so it's only recorded alongside an EOM session.
- History: `Sample[10]` = hr (0 = none; absent in older sessions), summary `avgHr`/`peakHr`, CSV
  `heart_rate` column, solid `--heart` line in the session graph.
- Not done: firmware doesn't see HR (could later feed edge detection); SpO2 is shown but not stored.
- Decided against adding SpO2 or a MAX30102 to the device. EMG (MyoWare on Grove G32) noted as a
  possible external alternative to the pressure sensor; not started.

### README + screenshots (2026-10-17)

- README covers 3.0-3.4: what's-new table, app, modes, after-orgasm, history/calibration, safety,
  status LED, board table, BLE OTA, simulator, new reading fields and settings, roadmap.
- Screenshots in `doc/screenshots/` were taken with headless Chrome against `eomui/public` and a
  mock WebSocket device (Node `ws`, simulated edging) plus seeded IndexedDB sessions, so no real
  hardware data. The script was in the session scratchpad and not kept; to retake, use the same
  approach (puppeteer-core + system Chrome, phone viewport 412x915 @2x, dark scheme).

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

- BLE status is 27 bytes: 17 settings lock, 18 safety stop, 19 orgasms, 20 phase, 21-22 rest,
  23-24 baseline, 25 heart rate, 26 heart-rate flags (multi-byte values MSB first).
- BLE control: `0x02` set setting (saved), `0x04` save and restart, `0x05` simulated pressure,
  `0x06` heart rate (bpm).

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
