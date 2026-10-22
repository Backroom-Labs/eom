// Usage: node scripts/wifi_ota.ts <ws url> <firmware.bin> <update|interrupt|busy|stray>
// Drives Wi-Fi OTA on a real EOM with the app's own wsUploader:
//   update     sends the image and prints the result and how long it took
//   interrupt  closes the connection 30% of the way through
//   busy       a second client sends BEGIN while the first is sending (expect 0x103)
//   stray      a binary frame with no update running, then one bigger than WS_OTA_MAX_FRAME
import { readFileSync } from "node:fs";
import type { UploadOptions } from "../src/lib/otaProtocol.ts";
import { readWsDeviceInfo, wsUploader } from "../src/lib/wsUpload.ts";

const [url, file, mode] = process.argv.slice(2);
if (!url || !file || !["update", "interrupt", "busy", "stray"].includes(mode)) {
  console.error("usage: node scripts/wifi_ota.ts <ws url> <firmware.bin> <update|interrupt|busy|stray>");
  process.exit(2);
}
const image = new Uint8Array(readFileSync(file));

const open = () =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("couldn't connect")));
  });
const alive = async (ws: WebSocket) => JSON.stringify(await readWsDeviceInfo(ws));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const hex = (r: number) => `0x${r.toString(16)}`;

let lastPct = -10;
const options: UploadOptions = {
  allowDowngrade: false,
  onProgress: (f, stage) => {
    const pct = Math.floor(f * 100);
    if (pct >= lastPct + 10 || stage !== "sending") {
      log(stage, pct + "%");
      lastPct = pct;
    }
  },
};

if (mode === "update") {
  const ws = await open();
  log("info", await alive(ws));
  const t = Date.now();
  const result = await wsUploader(ws).upload(image, options);
  log(`result ${hex(result)} after ${((Date.now() - t) / 1000).toFixed(1)} s for ${image.length} bytes`);
  ws.close();
} else if (mode === "interrupt") {
  const ws = await open();
  await wsUploader(ws)
    .upload(image, {
      ...options,
      onProgress: (f, stage) => {
        if (f > 0.3) ws.close();
        options.onProgress(f, stage);
      },
    })
    .then(
      (r) => log("result", hex(r)),
      (e: Error) => log("upload ended:", e.message),
    );
} else if (mode === "busy") {
  const a = await open();
  const b = await open();
  let triedB = false;
  await wsUploader(a)
    .upload(image, {
      ...options,
      onProgress: async (_f, stage) => {
        if (stage !== "sending" || triedB) return;
        triedB = true;
        const r = await wsUploader(b).upload(image, { allowDowngrade: false, onProgress: () => {} });
        log(`second client's BEGIN: result ${hex(r)}`);
        a.close(); // stop the first one too
      },
    })
    .then(
      (r) => log("first result", hex(r)),
      (e: Error) => log("first ended:", e.message),
    );
  b.close();
} else if (mode === "stray") {
  const ws = await open();
  ws.send(new Uint8Array(100).fill(7)); // a binary frame with no update running
  log("after a stray binary frame:", await alive(ws));
  ws.send(new Uint8Array(5000)); // bigger than WS_OTA_MAX_FRAME
  await new Promise((r) => setTimeout(r, 1000));
  log("after an oversized frame, readyState:", ws.readyState, "(3 = closed)");
  const again = await open();
  log("new connection:", await alive(again));
  again.close();
}
process.exit(0);
