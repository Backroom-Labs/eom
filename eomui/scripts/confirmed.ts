// Usage: node scripts/confirmed.ts <ws url> [timeout seconds, default 90]
// Waits until the EOM's otaInfo reports its firmware confirmed (30 s of control loop after an update).
// Exits 0 once it is, 1 on timeout. Reconnects while the EOM restarts.
import { readWsDeviceInfo } from "../src/lib/wsUpload.ts";

const [url, timeoutArg] = process.argv.slice(2);
if (!url) {
  console.error("usage: node scripts/confirmed.ts <ws url> [timeout seconds]");
  process.exit(2);
}
const deadline = Date.now() + Number(timeoutArg ?? 90) * 1000;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function open(): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => (ws.close(), resolve(null)), 4000);
    ws.addEventListener("open", () => (clearTimeout(timer), resolve(ws)));
    ws.addEventListener("error", () => (clearTimeout(timer), resolve(null)));
  });
}

while (Date.now() < deadline) {
  const ws = await open();
  if (ws) {
    const info = await readWsDeviceInfo(ws);
    ws.close();
    log(info ? `${info.version} confirmed: ${info.confirmed}` : "no otaInfo");
    if (info?.confirmed) process.exit(0);
  } else {
    log("couldn't connect");
  }
  await new Promise((r) => setTimeout(r, 2000));
}
log("timed out");
process.exit(1);
