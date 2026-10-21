// Every connected toy (Buttplug toys and OSSMs) in one list, which follows EOM readings and can
// stop them all.

import { FOLLOW_MODES, followFraction, levelFor, percentOf, toyLevelPercent, toyLevels, ToyFollower, ToyPacer, type FollowMode, type PacedControl, type ToyControl, type ToyReading } from "./toyOutput.ts";

// What the toy strip on the main screen shows for one toy.
export type ToyStatus = {
  name: string;
  strength: number; // %, of its strongest toy control
  follows: FollowMode[]; // what its toy controls follow, none if all are on Manual
};

export type ToyStripEntry = ToyStatus & { key: unknown };

// One connected toy, whatever kind it is.
export interface Toy {
  key: unknown; // the object the toy was made from, so it can be found again
  status(): ToyStatus;
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
  private onStopped: () => void;
  private listeners = new Set<() => void>();

  // onStopped is told after a stop that switched toys to Manual, so the user can be told.
  constructor(onStopped: () => void = () => {}) {
    this.onStopped = onStopped;
  }

  // listener is told whenever a toy connects or leaves, so the screen can show the strip again.
  // Returns a function that stops telling it.
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  add(toy: Toy) {
    this.list.push(toy);
    this.changed();
  }

  // Lets go of the toy made from this object.
  remove(key: unknown) {
    const leaving = this.list.filter((toy) => toy.key === key);
    if (leaving.length === 0) return;
    for (const toy of leaving) toy.release?.();
    this.list = this.list.filter((toy) => toy.key !== key);
    this.changed();
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

  // One entry per connected toy, for the toy strip.
  strip(): ToyStripEntry[] {
    return this.list.map((toy) => ({ key: toy.key, ...toy.status() }));
  }

  // Stops the toy made from this object, from its stop button on the strip, which shows it's now
  // on Manual, so the user isn't told.
  async stop(key: unknown): Promise<void> {
    await Promise.all(this.list.filter((toy) => toy.key === key).map((toy) => toy.stop()));
  }

  async stopAll(): Promise<void> {
    if (this.list.length === 0) return;
    await Promise.all(this.list.map((toy) => toy.stop()));
    this.onStopped();
  }
}

// What a toy's controls follow, each mode once, in the app's usual order. Manual isn't listed.
function followsOf(modes: (string | undefined)[]): FollowMode[] {
  return FOLLOW_MODES.filter((mode) => mode !== "manual" && modes.includes(mode));
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
  for (const control of controls) control.levels ??= toyLevels(control.feature, control.type!);
  const followers = new Map(controls.map((c) => [c, new ToyFollower(c, c.levels)]));
  // Every toy level goes through here, so each control knows the level its toy was set to.
  const setLevel = (control: C, level: number) => {
    control.toyLevel = level;
    pacer.set(control, level);
  };
  return {
    key: handle,
    status: () => ({
      name: handle.name,
      strength: Math.max(0, ...controls.map(toyLevelPercent)),
      follows: followsOf(controls.map((c) => c.mode)),
    }),
    follow(r, maxDenied) {
      for (const control of controls) {
        const follower = followers.get(control)!;
        const level = follower.onReading(r, maxDenied);
        if (level === null) continue;
        show(control, follower.sliderValue);
        setLevel(control, level);
      }
    },
    setByHand(control, fraction) {
      setLevel(control, levelFor(control, fraction, control.levels));
    },
    async stop() {
      for (const control of controls) {
        control.mode = "manual";
        control.toyLevel = 0;
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

// An OSSM control as OSSM.svelte shows it.
export type OssmControl = OssmToyControl & { default: number; description?: string };

// The controls a newly connected OSSM starts with. Every one is on Manual, so an OSSM never
// starts moving the moment it connects, as Buttplug toys don't.
export function ossmControls(): Record<string, OssmControl> {
  return {
    speed: { value: 0, default: 0, min: 0, max: 100, mode: "manual", limitMin: 0, limitMax: 100, inverted: false, description: "Adjust how fast it goes back and forth" },
    stroke: { value: 50, default: 50, min: 0, max: 100, mode: "manual", limitMin: 0, limitMax: 100, inverted: false, description: "Adjust the length of each stroke" },
    depth: { value: 10, default: 10, min: 0, max: 100, mode: "manual", limitMin: 0, limitMax: 100, inverted: false, description: "Adjust how deep the strokes go" },
    pattern: { value: 0, default: 0, min: 0, max: 6, mode: "manual", limitMin: 0, limitMax: 6, inverted: false, description: "Choose from preset stroke patterns" },
    sensation: { value: 50, default: 50, min: 0, max: 100, mode: "manual", limitMin: 0, limitMax: 100, inverted: false, description: "Adjust features of the current pattern.  50 = no adjustment" },
  };
}

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
    // Its strength is its speed, as stroke and depth are positions, not strengths.
    status() {
      const speed = ossm.controls.speed;
      return {
        name: ossm.name,
        strength: speed && speed.max > speed.min ? percentOf(speed.value, speed.min, speed.max) : 0,
        follows: followsOf(Object.values(ossm.controls).map((c) => c.mode)),
      };
    },
    follow(r, maxDenied) {
      for (const [name, control] of Object.entries(ossm.controls)) {
        if (!control.mode || control.mode === "manual") continue;
        let value = Math.min(1, Math.max(0, followFraction(control.mode as FollowMode, r, maxDenied)));
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
