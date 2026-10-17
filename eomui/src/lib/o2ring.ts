// Heart rate from a Wellue/Viatom O2Ring and its rebadges (SleepHQ O2 Ring Pro, Checkme O2, SleepU,
// WearO2...). None of them has the standard heart-rate service; they speak one of two private
// protocols, both CRC-8 (poly 0x07, seed 0) over every byte before the CRC:
//
// - OxyII (O2Ring S, SleepHQ O2 Ring Pro "SHQO2Pro", ...): service e8fb0001-..., frames
//   A5 cmd ~cmd flag seq len(u16 LE) payload crc. Flag 0 to the ring, 1 = OK back; the ring echoes
//   seq. Command 0x04 returns the live values. From github.com/khromov/wellue-o2ring-web-ui
//   (src/lib/protocol/oxyii.ts, oxyiiMessages.ts).
// - Legacy (original O2Ring): service 14839ac4-..., frames AA cmd ~cmd block(u16) len(u16) data crc,
//   replies start 55. Command 0x17 returns the live values. From github.com/MackeyStingray/o2r.
//
// OxyII rings also expose the legacy service but ignore it, so OxyII is used whenever it's there.
// Both are polled once a second; replies can span several notifications.

import { BleClient } from "@capacitor-community/bluetooth-le";

const OXYII = {
  service: "e8fb0001-a14b-98f9-831b-4e2941d01248",
  write: "e8fb0002-a14b-98f9-831b-4e2941d01248",
  notify: "e8fb0003-a14b-98f9-831b-4e2941d01248",
};
const LEGACY = {
  service: "14839ac4-7d7e-415c-9a42-167340cf2339",
  write: "8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3",
  notify: "0734594a-a8e7-4b1a-a6b1-cd5243059a57",
};
type Gatt = typeof OXYII;

const OXYII_RT_DATA = 0x04;
const OXYII_AUTO_RT_SWITCH = 0x10;
const OXYII_AUTH = 0xff;
const LEGACY_READ_SENSORS = 0x17;

const POLL_MS = 1000;
const REPLY_TIMEOUT_MS = 2500;
const CHUNK = 20; // bytes per GATT write; always fits the default MTU

export type RingReading = {
  hr: number | null; // bpm; null when the ring has no reading (finger out, settling)
  spo2: number | null; // %
  motion: number | null;
  pi: number | null; // perfusion index
  battery: number; // %
  finger: boolean;
  localTime: number;
};

function crc8(bytes: Uint8Array, length = bytes.length): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function oxyiiFrame(cmd: number, seq: number, payload: number[] = []): Uint8Array {
  const f = new Uint8Array(8 + payload.length);
  f.set([0xa5, cmd, cmd ^ 0xff, 0, seq, payload.length & 0xff, payload.length >> 8]);
  f.set(payload, 7);
  f[f.length - 1] = crc8(f, f.length - 1);
  return f;
}

function legacyFrame(cmd: number): Uint8Array {
  const f = new Uint8Array([0xaa, cmd, cmd ^ 0xff, 0, 0, 0, 0, 0]);
  f[7] = crc8(f, 7);
  return f;
}

// AUTH payload: MD5("lepucloud") bytes 0,2..14, "0000", unix time (u32 LE), XORed with MD5("lepucloud").
const LEPU_KEY = [0xc2, 0xa7, 0xcf, 0x50, 0xda, 0xfe, 0xd8, 0x85, 0xa8, 0xf8, 0xf7, 0xea, 0xc4, 0x43, 0x35, 0xf3];
function authPayload(unixSeconds: number): number[] {
  const t: number[] = [];
  for (let i = 0; i < 8; i++) t.push(LEPU_KEY[i * 2]);
  for (let i = 0; i < 4; i++) t.push(0x30);
  for (let i = 0; i < 4; i++) t.push(Math.floor(unixSeconds / 2 ** (8 * i)) & 0xff);
  return t.map((b, i) => b ^ LEPU_KEY[i]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Frame = { cmd: number; flag: number; seq: number; payload: Uint8Array };

export class O2Ring {
  deviceId: string | null = null;
  name = "";
  protocol: "oxyii" | "legacy" = "oxyii";
  onReading?: (r: RingReading) => void;
  onDisconnect?: () => void;

  private gatt: Gatt = OXYII;
  private rx: number[] = [];
  private seq = 0;
  private pending: { cmd: number; seq: number; resolve: (f: Frame) => void; reject: (e: Error) => void } | null = null;
  private withResponse = false;
  private running = false;

  async connect(): Promise<string> {
    await BleClient.initialize();
    // Ring names vary by brand (O2Ring, SHQO2Pro, Checkme_O2...) and they don't advertise their
    // services, so the picker lists every nearby device.
    const device = await BleClient.requestDevice({ optionalServices: [OXYII.service, LEGACY.service] });
    await BleClient.connect(device.deviceId, () => this.disconnected());
    this.deviceId = device.deviceId;
    this.name = device.name ?? "O2Ring";
    try {
      const services = (await BleClient.getServices(device.deviceId)).map((s) => s.uuid.toLowerCase());
      if (services.includes(OXYII.service)) [this.protocol, this.gatt] = ["oxyii", OXYII];
      else if (services.includes(LEGACY.service)) [this.protocol, this.gatt] = ["legacy", LEGACY];
      else throw new Error(`${this.name} isn't an O2Ring (no oximeter service)`);
      this.rx = [];
      // Notifications must be on before the first write.
      await BleClient.startNotifications(device.deviceId, this.gatt.service, this.gatt.notify, (v) => this.receive(v));
    } catch (err) {
      await this.disconnect();
      throw err;
    }
    console.log(`O2Ring: ${this.name} uses the ${this.protocol} protocol`);
    this.running = true;
    void this.pollLoop(device.deviceId);
    return this.name;
  }

  async disconnect() {
    const id = this.deviceId;
    if (id) await BleClient.disconnect(id).catch((err) => console.error(err));
    this.disconnected();
  }

  private disconnected() {
    this.running = false;
    this.pending?.reject(new Error("disconnected"));
    this.pending = null;
    if (this.deviceId === null) return;
    this.deviceId = null;
    this.onDisconnect?.();
  }

  private async pollLoop(id: string) {
    await sleep(300);
    let failures = 0;
    let triedAuth = false;
    if (this.protocol === "oxyii") {
      // Turn off pushed live data; we poll instead. Not every model answers.
      await this.request(OXYII_AUTO_RT_SWITCH, [0]).catch((err) => console.warn("O2Ring: auto-RT switch:", err.message));
    }
    while (this.running && this.deviceId === id) {
      const t0 = Date.now();
      try {
        if (this.protocol === "oxyii") {
          const f = await this.request(OXYII_RT_DATA);
          this.parseOxyII(f.payload);
        } else {
          // Legacy replies are handled in receive(); no seq to wait on.
          await this.write(legacyFrame(LEGACY_READ_SENSORS));
        }
        failures = 0;
      } catch (err: any) {
        console.warn("O2Ring: live poll failed:", err?.message ?? err);
        // Some OxyII models only answer after AUTH. The O2Ring S doesn't reply to it and stays
        // unencrypted; a ring that replies with a key wants AES, which isn't supported here.
        if (++failures >= 3 && this.protocol === "oxyii" && !triedAuth) {
          triedAuth = true;
          try {
            const f = await this.request(OXYII_AUTH, authPayload(Math.floor(Date.now() / 1000)), 1000);
            if (f.payload.length >= 20) console.error("O2Ring: the ring asked for encryption, which isn't supported yet");
          } catch {
            // No reply to AUTH: unencrypted, keep polling.
          }
        }
      }
      await sleep(Math.max(0, POLL_MS - (Date.now() - t0)));
    }
  }

  // One OxyII request at a time; resolves with the reply that echoes our seq.
  private request(cmd: number, payload: number[] = [], timeoutMs = REPLY_TIMEOUT_MS): Promise<Frame> {
    this.seq = (this.seq % 254) + 1;
    const seq = this.seq;
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`no reply to command 0x${cmd.toString(16)}`));
      }, timeoutMs);
      this.pending = {
        cmd,
        seq,
        resolve: (f) => {
          clearTimeout(timer);
          this.pending = null;
          if (f.flag === 1) resolve(f);
          else reject(new Error(`command 0x${cmd.toString(16)} refused (0x${f.flag.toString(16)})`));
        },
        reject: (e) => {
          clearTimeout(timer);
          this.pending = null;
          reject(e);
        },
      };
      this.write(oxyiiFrame(cmd, seq, payload)).catch((e) => this.pending?.reject(e));
    });
  }

  private async write(bytes: Uint8Array) {
    const id = this.deviceId;
    if (!id) throw new Error("not connected");
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const data = new DataView(bytes.slice(i, i + CHUNK).buffer);
      // Some rings fail writes with response ("GATT operation failed"), others may need them:
      // try without first and stick with whichever works.
      const kinds = this.withResponse ? [true, false] : [false, true];
      for (const withResponse of kinds) {
        try {
          if (withResponse) await BleClient.write(id, this.gatt.service, this.gatt.write, data);
          else await BleClient.writeWithoutResponse(id, this.gatt.service, this.gatt.write, data);
          this.withResponse = withResponse;
          break;
        } catch (err) {
          if (withResponse === kinds[1]) throw err;
        }
      }
    }
  }

  private receive(value: DataView) {
    for (let i = 0; i < value.byteLength; i++) this.rx.push(value.getUint8(i));
    const head = this.protocol === "oxyii" ? 0xa5 : 0x55;
    for (;;) {
      // Drop bytes until a frame header (head cmd ~cmd) lines up.
      while (this.rx.length >= 3 && !(this.rx[0] === head && this.rx[2] === (this.rx[1] ^ 0xff))) this.rx.shift();
      if (this.rx.length < 7) return;
      const size = 8 + (this.rx[5] | (this.rx[6] << 8));
      if (this.rx.length < size) return;
      const pkt = Uint8Array.from(this.rx.slice(0, size));
      if (crc8(pkt, size - 1) !== pkt[size - 1]) {
        this.rx.shift(); // a false header; resync from the next byte
        continue;
      }
      this.rx.splice(0, size);
      const payload = pkt.subarray(7, size - 1);
      if (this.protocol === "legacy") {
        // Read sensors is the only legacy command we send, so every reply is its answer.
        this.parseLegacy(payload);
      } else if (this.pending && pkt[1] === this.pending.cmd && pkt[4] === this.pending.seq) {
        this.pending.resolve({ cmd: pkt[1], flag: pkt[3], seq: pkt[4], payload });
      }
    }
  }

  // OxyII RtParam: [4] run status, [5] sensor (0 no finger, 1 ok, 2 probe off, 3 fault), [6] SpO2,
  // [7] PI x10, [8-9] pulse rate (u16 LE), [11] motion, [12] battery state, [13] battery %.
  private parseOxyII(d: Uint8Array) {
    if (d.length < 14) return;
    const spo2 = d[6];
    const pr = d[8] | (d[9] << 8);
    const valid = ![0, 127, 255].includes(spo2) && ![0, 255, 511, 65535].includes(pr);
    this.onReading?.({
      hr: valid ? pr : null,
      spo2: valid ? spo2 : null,
      motion: d[11] !== 255 ? d[11] : null,
      pi: valid && d[7] !== 0 && d[7] !== 255 ? d[7] / 10 : null,
      battery: d[13],
      finger: d[5] === 1,
      localTime: Date.now(),
    });
  }

  // Legacy: [0] SpO2, [1] HR, [7] battery, [9] motion, [10] PI, [11] finger.
  private parseLegacy(d: Uint8Array) {
    if (d.length < 12) return;
    const finger = d[11] !== 0;
    const spo2 = d[0];
    const hr = d[1];
    const valid = finger && spo2 >= 10 && spo2 <= 100 && hr > 0 && hr < 255;
    this.onReading?.({
      hr: valid ? hr : null,
      spo2: valid ? spo2 : null,
      motion: d[9],
      pi: d[10],
      battery: d[7],
      finger,
      localTime: Date.now(),
    });
  }
}
