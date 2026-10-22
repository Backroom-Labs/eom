# App notes (`eomui`)

Gotchas that the code doesn't show. Decisions are in `docs/adr/`.

## Building and checking

- Run `npm run build` in `eomui` after UI changes, so `eomui/public/index.html` is up to date. Testing against a stale build has hidden fixes twice.
- `npm run check` type-checks the app, `vite.config.ts` and the tests in `test/` (`tsconfig.test.json`); `node --test` alone doesn't check types. CI runs both.
- `package.json` overrides `buttplug-wasm`'s own `buttplug` 4.x dependency with our 5.x, so the connector and client share one set of types. Both speak message spec 4.0.
- `tsconfig.app.json` sets `allowImportingTsExtensions` because `node --test` runs the `.ts` files directly and needs the `.ts` on imports between `src/lib` modules (`./toyOutput.ts`). Svelte components import them without it.
- Toys use the official `buttplug` 5.x, `buttplug-wasm` and `buttplug-wasm-blob` packages, driven only through client calls: ADR 0009.

## Android APK

- CI builds it in the `android` job of `.github/workflows/release.yml`. Locally: `npm run build`, `npx cap sync android`, then `./gradlew assembleRelease` in `eomui/android` (JDK 21, Android platform 36).
- Release builds sign with `ANDROID_KEYSTORE_FILE` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` from the environment, else `.local/keystore.properties`, else the debug key. Keep the key (alias `eom`) the same, or releases stop installing over each other.
- `versionName` / `versionCode` come from the tag through `scripts/android-version.mjs` (`-PversionName`, `-PversionCode`). Untagged builds are `0.0.0-dev`, code 7. A tag the script refuses fails the whole release, firmware included. Number prereleases upwards across labels (beta.1, beta.2, rc.3): the code uses only the trailing number.

## Settings

- `src/lib/settings.ts` is the single list of device settings. Keys must match `CONFIG_DEFS` in `src/config.c` (firmware).
- A new settings *group* also needs an entry in `SETTINGS_TABS` in `App.svelte`, or its settings never show.

## Heart rate ring

- The SleepHQ O2 Ring Pro speaks the OxyII protocol, not the legacy O2Ring one, even though it also exposes the legacy service; it ignores legacy commands. `src/lib/o2ring.ts` picks OxyII when service `e8fb0001-...` exists.
- Writes go without response, chunked to 20 bytes. Writes with response fail with "GATT operation failed".
- Rings that ask for AES-128 authentication aren't supported. The console says so when it happens.

## Screenshots

README screenshots in `doc/screenshots/` are 412x915 at 2x in the dark scheme, scaled to 560x1243 (`desktop.png` is 1280x860).

- `gauges.png` and `toys.png` come from `eomui/scripts/screenshots.mjs`. Run `npm run build`, then `npm run screenshots` in `eomui`. It serves `eomui/public`, runs a mock EOM over WebSocket, and gives the page a fake Web Bluetooth with a Lovense Lush (Buttplug identifies it from its `DeviceType;` reply). It drives the system Chrome through puppeteer-core with reduced motion on, so the pleasure gauge isn't caught mid-pulse, and scales the shots with macOS `sips`. Add new shots there.
- The other shots came from an earlier script that wasn't kept. It worked the same way, and the history shots also used seeded IndexedDB sessions. Move them into the script when you retake them.
