# App notes (`eomui`)

Gotchas that the code doesn't show. Decisions are in `docs/adr/`.

## Building and checking

- Run `npm run build` in `eomui` after UI changes, so `eomui/public/index.html` is up to date. Testing against a stale build has hidden fixes twice.
- `npm run check` is clean for the 3.x files. The toy components and `node_modules` still have old type errors; ignore those.
- Toys use the official `buttplug` 5.x, `buttplug-wasm` and `buttplug-wasm-blob` packages, driven only through client calls: ADR 0009.

## Settings

- `src/lib/settings.ts` is the single list of device settings. Keys must match `CONFIG_DEFS` in `src/config.c` (firmware).
- A new settings *group* also needs an entry in `SETTINGS_TABS` in `App.svelte`, or its settings never show.

## Heart rate ring

- The SleepHQ O2 Ring Pro speaks the OxyII protocol, not the legacy O2Ring one, even though it also exposes the legacy service; it ignores legacy commands. `src/lib/o2ring.ts` picks OxyII when service `e8fb0001-...` exists.
- Writes go without response, chunked to 20 bytes. Writes with response fail with "GATT operation failed".
- Rings that ask for AES-128 authentication aren't supported. The console says so when it happens.

## Screenshots

The README screenshots in `doc/screenshots/` came from headless Chrome (puppeteer-core with the system Chrome) against `eomui/public`, a mock WebSocket device (Node `ws`, simulated edging) and seeded IndexedDB sessions. Viewport 412x915 at 2x, dark scheme. The script wasn't kept, so rebuild it the same way when retaking them.
