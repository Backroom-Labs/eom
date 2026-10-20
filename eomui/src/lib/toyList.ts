// Every connected toy (Buttplug toys and OSSMs) in one list, which follows EOM readings and can
// stop them all.

import { followFraction, setToyPercent, type ToyFeature, type ToyFollower, type ToyReading } from "./toyOutput.ts";

// One connected toy, whatever kind it is.
export interface Toy {
  device: unknown; // the toy's own device object, so it can be found again
  follow(r: ToyReading, maxDenied: number, nowMs: number): void;
  // Sets the toy to 0 and switches all its toy controls to Manual.
  stop(): Promise<void>;
}

// A reading as the EOM reports it, with why its safety checks last stopped the session (0 = never).
export type EomReading = ToyReading & { safety?: number };

// Stop means everything stops: the EOM's Stop button, a safety stop and a lost EOM connection all
// set every toy to 0 and switch its controls to Manual, so the next reading doesn't start it again.
export class ToyList {
  private list: Toy[] = [];
  private safety = 0;
  private connected = false;

  add(toy: Toy) {
    this.list.push(toy);
  }

  // Lets go of the toy for this device.
  remove(device: unknown) {
    this.list = this.list.filter((toy) => toy.device !== device);
  }

  get toys(): readonly Toy[] {
    return this.list;
  }

  // Passes a reading to every toy. A new safety stop stops them all instead. One still being
  // reported doesn't, so toys can be started again by hand.
  follow(r: EomReading, maxDenied: number, nowMs: number): Promise<void> {
    const safety = r.safety ?? 0;
    const newSafetyStop = safety !== 0 && safety !== this.safety;
    this.safety = safety;
    if (newSafetyStop) return this.stopAll();
    for (const toy of this.list) toy.follow(r, maxDenied, nowMs);
    return Promise.resolve();
  }

  // Tells the list whether the app is connected to the EOM. Losing the connection stops every toy.
  eomConnected(connected: boolean): Promise<void> {
    const lost = this.connected && !connected;
    this.connected = connected;
    if (!connected) this.safety = 0;
    return lost ? this.stopAll() : Promise.resolve();
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.list.map((toy) => toy.stop()));
  }
}

// A toy control on a Buttplug toy, as ButtplugConnector sets it up.
export type ButtplugToyControl = {
  type: string;
  mode?: string;
  feature: ToyFeature;
  follower?: ToyFollower;
  sliderElement?: { value: string };
  modeElement?: { value: string };
};

export type ButtplugToyDevice = { name: string; controls?: ButtplugToyControl[]; stop(): Promise<void> };

export function buttplugToy(device: ButtplugToyDevice): Toy {
  const send = (control: ButtplugToyControl, percent: number) =>
    setToyPercent(control.feature, control.type, percent)
      .catch((err) => console.error(`Error sending command to toy ${device.name}:`, err));
  return {
    device,
    follow(r, maxDenied, nowMs) {
      for (const control of device.controls ?? []) {
        const percent = control.follower?.onReading(r, maxDenied, nowMs);
        if (percent === null || percent === undefined) continue;
        if (control.sliderElement) control.sliderElement.value = String(control.follower!.sliderValue);
        send(control, percent);
      }
    },
    async stop() {
      for (const control of device.controls ?? []) {
        control.mode = "manual";
        control.follower?.forget();
        if (control.modeElement) control.modeElement.value = "manual";
        if (control.sliderElement) control.sliderElement.value = "0";
      }
      try {
        await device.stop();
      } catch (err) {
        console.error(`Couldn't stop toy ${device.name}:`, err);
      }
    },
  };
}

// A toy control on an OSSM, as OSSM.svelte sets it up.
export type OssmToyControl = {
  value: number;
  min: number;
  max: number;
  mode: string;
  inverted?: boolean;
  limitMin?: number;
  limitMax?: number;
};

export type OssmToyDevice = {
  name: string;
  controls: Record<string, OssmToyControl>;
  setControl(name: string, value: number): Promise<void>;
};

// OSSM.svelte drops a write sent while another is in flight, so a stop is retried this often
// until the OSSM reports speed 0.
const OSSM_STOP_RETRY_MS = 20;
const OSSM_STOP_TRIES = 100;

export function ossmToy(device: OssmToyDevice): Toy {
  return {
    device,
    follow(r, maxDenied) {
      for (const [name, control] of Object.entries(device.controls)) {
        if (!control.mode || control.mode === "manual") continue;
        let value = Math.min(1, Math.max(0, followFraction(control.mode, r, maxDenied)));
        if (control.inverted) value = 1 - value;
        const min = control.limitMin ?? control.min;
        const max = control.limitMax ?? control.max;
        device.setControl(name, Math.round(value * (max - min) + min))
          .catch((err) => console.error(`Error sending command to OSSM ${device.name}:`, err));
      }
    },
    async stop() {
      for (const control of Object.values(device.controls)) control.mode = "manual";
      for (let i = 0; i < OSSM_STOP_TRIES; i++) {
        try {
          await device.setControl("speed", 0);
        } catch (err) {
          console.error(`Couldn't stop OSSM ${device.name}:`, err);
          return;
        }
        if (device.controls.speed?.value === 0) return;
        await new Promise((resolve) => setTimeout(resolve, OSSM_STOP_RETRY_MS));
      }
      console.error(`Couldn't stop OSSM ${device.name}: speed 0 was never written`);
    },
  };
}
