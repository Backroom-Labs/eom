// Every connected toy (Buttplug toys and OSSMs) in one list, which follows EOM readings and can
// stop them all.

import { followFraction, levelFor, toyLevels, ToyFollower, ToyPacer, type PacedControl, type ToyControl, type ToyReading } from "./toyOutput.ts";

// One connected toy, whatever kind it is.
export interface Toy {
  key: unknown; // the object the toy was made from, so it can be found again
  follow(r: ToyReading, maxDenied: number): void;
  // Sets the toy to 0 and switches all its toy controls to Manual.
  stop(): Promise<void>;
  // The toy is gone: drop anything still waiting to be sent to it.
  release?(): void;
}

// A reading as the EOM reports it, with why its safety checks last stopped the session (0 = never).
export type EomReading = ToyReading & { safety?: number };

// Stop means everything stops: the EOM's Stop button, a safety stop and a lost EOM connection all
// set every toy to 0 and switch its controls to Manual, so the next reading doesn't start it again.
export class ToyList {
  private list: Toy[] = [];
  private safety = 0; // the last safety code seen, kept across a lost connection
  private connected = false;

  add(toy: Toy) {
    this.list.push(toy);
  }

  // Lets go of the toy made from this object.
  remove(key: unknown) {
    for (const toy of this.list) if (toy.key === key) toy.release?.();
    this.list = this.list.filter((toy) => toy.key !== key);
  }

  // Passes a reading to every toy. A new safety stop stops them all instead. One still being
  // reported doesn't, so toys can be started again by hand. That includes one still reported
  // after reconnecting: losing the connection already stopped every toy.
  follow(r: EomReading, maxDenied: number): Promise<void> {
    const safety = r.safety ?? 0;
    const newSafetyStop = safety !== 0 && safety !== this.safety;
    this.safety = safety;
    if (newSafetyStop) return this.stopAll();
    for (const toy of this.list) toy.follow(r, maxDenied);
    return Promise.resolve();
  }

  // Tells the list whether the app is connected to the EOM. Losing the connection stops every toy.
  eomConnected(connected: boolean): Promise<void> {
    const lost = this.connected && !connected;
    this.connected = connected;
    return lost ? this.stopAll() : Promise.resolve();
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.list.map((toy) => toy.stop()));
  }
}

// A toy control on a Buttplug toy, as ButtplugConnector sets it up.
export type ButtplugToyControl = PacedControl & ToyControl;

// A Buttplug toy as the client gives it, with the toy controls ButtplugConnector set up for it.
export type ButtplugToyHandle<C extends ButtplugToyControl> = {
  name: string;
  messageTimingGap?: number;
  controls?: C[];
  stop(): Promise<void>;
};

export type ButtplugToy<C extends ButtplugToyControl> = Toy & {
  // The control's slider was moved by hand to this position, 0-1.
  setByHand(control: C, fraction: number): void;
};

// show is told when a control's mode or slider position changed here, so it can update the screen.
export function buttplugToy<C extends ButtplugToyControl>(
  handle: ButtplugToyHandle<C>,
  show: (control: C, sliderValue: number) => void = () => {},
): ButtplugToy<C> {
  const pacer = new ToyPacer(handle);
  const controls = (handle.controls ?? []).filter((control) => control.type);
  const levels = new Map(controls.map((c) => [c, toyLevels(c.feature, c.type!)]));
  const followers = new Map(controls.map((c) => [c, new ToyFollower(c, levels.get(c))]));
  return {
    key: handle,
    follow(r, maxDenied) {
      for (const control of controls) {
        const follower = followers.get(control)!;
        const level = follower.onReading(r, maxDenied);
        if (level === null) continue;
        show(control, follower.sliderValue);
        pacer.set(control, level);
      }
    },
    setByHand(control, fraction) {
      pacer.set(control, levelFor(control, fraction, levels.get(control)));
    },
    async stop() {
      for (const control of controls) {
        control.mode = "manual";
        show(control, 0);
      }
      try {
        await pacer.stop();
      } catch (err) {
        console.error(`Couldn't stop toy ${handle.name}:`, err);
      }
    },
    release() {
      pacer.cancel();
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

// An OSSM as OSSM.svelte connects it.
export type OssmHandle = {
  name: string;
  controls: Record<string, OssmToyControl>;
  setControl(name: string, value: number): Promise<void>;
};

// OSSM.svelte drops a write sent while another is in flight, so a stop is retried this often
// until the OSSM reports speed 0.
const OSSM_STOP_RETRY_MS = 20;
const OSSM_STOP_TRIES = 100;

export function ossmToy(ossm: OssmHandle): Toy {
  return {
    key: ossm,
    follow(r, maxDenied) {
      for (const [name, control] of Object.entries(ossm.controls)) {
        if (!control.mode || control.mode === "manual") continue;
        let value = Math.min(1, Math.max(0, followFraction(control.mode, r, maxDenied)));
        if (control.inverted) value = 1 - value;
        const min = control.limitMin ?? control.min;
        const max = control.limitMax ?? control.max;
        ossm.setControl(name, Math.round(value * (max - min) + min))
          .catch((err) => console.error(`Error sending command to OSSM ${ossm.name}:`, err));
      }
    },
    async stop() {
      for (const control of Object.values(ossm.controls)) control.mode = "manual";
      // Only speed is set to 0. Stroke and depth are positions, not strengths: changing them
      // could move the rod, so at speed 0 they're left where they are.
      for (let i = 0; i < OSSM_STOP_TRIES; i++) {
        try {
          await ossm.setControl("speed", 0);
        } catch (err) {
          console.error(`Couldn't stop OSSM ${ossm.name}:`, err);
          return;
        }
        if (ossm.controls.speed?.value === 0) return;
        await new Promise((resolve) => setTimeout(resolve, OSSM_STOP_RETRY_MS));
      }
      console.error(`Couldn't stop OSSM ${ossm.name}: speed 0 was never written`);
    },
  };
}
