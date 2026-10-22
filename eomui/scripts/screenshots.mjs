// Takes the README screenshots that show toys: doc/screenshots/gauges.png and toys.png.
//
//   cd eomui && npm run build && npm run screenshots
//
// Serves eomui/public, runs a mock EOM over WebSocket (Orgasm mode, edging, Milking) and gives the
// page a fake Web Bluetooth with one Lovense Lush, so Buttplug finds a toy without hardware.
// Drives the system Chrome (set CHROME to use another) with puppeteer-core: 412x915 at 2x, dark,
// reduced motion, then scales each shot to 560x1243 like the other screenshots with macOS `sips`.
// PRESSURE_SIM=1 makes the mock report the pressure simulator, like firmware that isn't a release.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";
import { WebSocketServer } from "ws";
import { defaultConfig } from "../src/lib/settings.ts";
import { MIN_FIRMWARE_VERSION } from "../src/lib/firmwareRelease.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");
const OUT = join(here, "..", "..", "doc", "screenshots");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const OUT_SIZE = { width: 560, height: 1243 };
const PRESSURE_SIM = process.env.PRESSURE_SIM === "1";

// ---------------------------------------------------------------------------------------------
// The app, served over http so it gets a normal origin for its saved preferences

const web = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(PUBLIC, path));
    const type = path.endsWith(".html") ? "text/html" : path.endsWith(".js") ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => web.listen(0, "127.0.0.1", ok));
const appUrl = `http://127.0.0.1:${web.address().port}/`;

// ---------------------------------------------------------------------------------------------
// Mock EOM: answers the app's requests and streams a steady edging session

// Like real firmware, the mock reports every setting and a supported version, or the app hides the
// missing settings and warns about the firmware.
const CONFIG = {
  ...defaultConfig(),
  vibration_mode: 2, // Depletion
  after_orgasm: 2, // Milking, so the Orgasms gauge reads "0 of 3"
  milking_max_orgasms: 3,
  max_denied: 8,
  auto_edging_duration_minutes: 30,
};
const eom = new WebSocketServer({ host: "127.0.0.1", port: 0 });
eom.on("connection", (socket) => {
  const start = Date.now();
  let timer;
  socket.on("message", (data) => {
    const msg = JSON.parse(String(data));
    if ("configList" in msg) socket.send(JSON.stringify({ configList: CONFIG }));
    if ("info" in msg) socket.send(JSON.stringify({ info: { fwVersion: MIN_FIRMWARE_VERSION, pressureSim: PRESSURE_SIM } }));
    if ("streamReadings" in msg && !timer) {
      timer = setInterval(() => {
        const t = (Date.now() - start) / 1000;
        socket.send(
          JSON.stringify({
            readings: {
              millis: 1 + Math.round(t * 1000),
              runMode: "ORGASM",
              motor: 184, // 72% pleasure
              arousal: 860 + Math.round(40 * Math.sin(t)),
              pressure: 1680 + Math.round(60 * Math.sin(t * 1.7)),
              threshold: 1400,
              cooldown: 0,
              denied: 3,
              permit: 1260, // 21 min
              orgasms: 0,
              phase: 0,
            },
          }),
        );
      }, 100);
    }
  });
  socket.on("close", () => clearInterval(timer));
});
await new Promise((ok) => eom.on("listening", ok));
const eomUrl = `ws://127.0.0.1:${eom.address().port}/`;

// ---------------------------------------------------------------------------------------------
// Fake Web Bluetooth with one Lovense Lush, installed in the page before the app loads.
// Buttplug asks a Lovense toy "DeviceType;" and reads its model from the reply ("S" is a Lush).

function fakeBluetooth() {
  const SERVICE = "5a300001-0023-4bd4-bbd5-a6920e4c5653";
  const TX = "5a300002-0023-4bd4-bbd5-a6920e4c5653";
  const RX = "5a300003-0023-4bd4-bbd5-a6920e4c5653";
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const notFound = (what) => new DOMException(`${what} not found`, "NotFoundError");

  class Characteristic extends EventTarget {
    constructor(service, uuid) {
      super();
      this.service = service;
      this.uuid = uuid;
      this.value = null;
      this.oncharacteristicvaluechanged = null;
      this.properties = { read: true, write: true, writeWithoutResponse: true, notify: true };
    }
    async startNotifications() { return this; }
    async stopNotifications() { return this; }
    async readValue() { return this.value ?? new DataView(new ArrayBuffer(0)); }
    async writeValue(value) { this.service.received(decoder.decode(value)); }
    async writeValueWithResponse(value) { return this.writeValue(value); }
    async writeValueWithoutResponse(value) { return this.writeValue(value); }
    notify(text) {
      this.value = new DataView(encoder.encode(text).buffer);
      const event = new Event("characteristicvaluechanged");
      this.dispatchEvent(event);
      this.oncharacteristicvaluechanged?.(event);
    }
  }

  class Service {
    constructor(device) {
      this.device = device;
      this.uuid = SERVICE;
      this.isPrimary = true;
      this.tx = new Characteristic(this, TX);
      this.rx = new Characteristic(this, RX);
    }
    async getCharacteristic(uuid) {
      const key = String(uuid).toLowerCase();
      if (key === TX) return this.tx;
      if (key === RX) return this.rx;
      throw notFound(`Characteristic ${key}`);
    }
    async getCharacteristics() { return [this.tx, this.rx]; }
    received(text) {
      for (const command of text.split(";").filter(Boolean)) {
        const reply = command === "DeviceType" ? "S:11:0082059AD3BD;" : command === "Battery" ? "85;" : "OK;";
        setTimeout(() => this.rx.notify(reply), 5);
      }
    }
  }

  class Device extends EventTarget {
    constructor() {
      super();
      this.id = "fake-lush";
      this.name = "LVS-S001";
      this.ongattserverdisconnected = null;
      const service = new Service(this);
      this.gatt = {
        device: this,
        connected: false,
        async connect() { this.connected = true; return this; },
        disconnect() { this.connected = false; },
        async getPrimaryService(uuid) {
          if (String(uuid).toLowerCase() === SERVICE) return service;
          throw notFound(`Service ${uuid}`);
        },
        async getPrimaryServices() { return [service]; },
      };
    }
    async watchAdvertisements() {}
    async forget() {}
  }

  const device = new Device();
  Object.defineProperty(navigator, "bluetooth", {
    configurable: true,
    value: {
      requestDevice: async () => device,
      getAvailability: async () => true,
      getDevices: async () => [device],
      addEventListener() {},
      removeEventListener() {},
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Drive the app

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.setViewport(VIEWPORT);
  // Reduced motion stops the pleasure gauge pulsing, so it isn't caught mid-fade.
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.evaluateOnNewDocument(fakeBluetooth);
  // Not recording, so History has no red dot.
  await page.evaluateOnNewDocument(() => localStorage.setItem("eom.prefs", JSON.stringify({ recordSessions: false })));
  await page.goto(appUrl, { waitUntil: "load" });

  // Connect to the mock EOM over Wi-Fi.
  await page.click('button[title="Connection"]');
  const address = await page.waitForSelector('input[aria-label="WebSocket address"]', { visible: true });
  await address.evaluate((input) => input.select());
  await page.keyboard.press("Backspace");
  await address.type(eomUrl);
  await page.click('.urlRow button[type="submit"]');
  await page.waitForFunction(() => document.querySelector(".statusTitle")?.textContent === "Edging");

  // Connect the Lush and have it follow pleasure.
  await page.click('button[aria-label="Toys"]');
  const connectToy = await page.waitForSelector("::-p-text(Connect a toy)", { visible: true });
  await connectToy.click();
  const pleasure = await page.waitForSelector('[role="radio"]::-p-text(Pleasure)', { visible: true, timeout: 20_000 });
  await pleasure.click();
  await page.waitForFunction(() => /^[1-9]/.test(document.querySelector(".toyStrength")?.textContent ?? ""));
  await waitForToast(page);
  await shoot(page, "toys.png");

  // The main screen with the toy strip in the header.
  await page.click('dialog[open] button[aria-label="Close"]');
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, "gauges.png");
} catch (e) {
  const pages = await browser.pages();
  await pages.at(-1)?.screenshot({ path: join(OUT, "..", "screenshot-failed.png") });
  console.error(`Failed; see doc/screenshot-failed.png`);
  throw e;
} finally {
  await browser.close();
  eom.close();
  web.close();
}

async function waitForToast(page) {
  await page.waitForFunction(() => !document.querySelector(".toast"), { timeout: 10_000 });
}

async function shoot(page, name) {
  await new Promise((ok) => setTimeout(ok, 700)); // let sheets and gauges finish animating
  const file = join(OUT, name);
  await page.screenshot({ path: file });
  execFileSync("sips", ["-z", String(OUT_SIZE.height), String(OUT_SIZE.width), file], { stdio: "ignore" });
  console.log(`saved ${file}`);
}
