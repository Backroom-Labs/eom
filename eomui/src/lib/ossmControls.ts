// An OSSM's controls: speed, stroke, depth, pattern and sensation, each with the range it's
// limited to, what it follows and whether that's inverted.

import type { OSSMPattern } from "./ossmPatterns.ts";
import type { FollowMode } from "./toyOutput.ts";

// A toy control on an OSSM: what ossmToy and the OSSM's memory need of it.
export type OssmToyControl = {
  value: number;
  min: number;
  max: number;
  mode: FollowMode;
  inverted?: boolean;
  limitMin?: number; // the range it's limited to, within min-max
  limitMax?: number;
};

// An OSSM control as OSSM.svelte shows it.
export type OssmControl = OssmToyControl & { default: number; description?: string };

// An OSSM as OSSM.svelte connects it. Its writes go through its OssmWriter.
export type OssmHandle = {
  name: string;
  controls: Record<string, OssmToyControl>;
  // Queues a value for a control, sent when the OSSM can take it.
  setControl(name: string, value: number): void;
  // Sets speed 0 at once, ahead of anything queued, which is dropped.
  stop(): Promise<void>;
  // Drops anything queued.
  cancel(): void;
};

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

// The OSSM controls that can follow the EOM. Pattern and sensation are set by hand only, so the
// EOM can never pick a pattern that's dangerous with speed, or change the sensation by itself.
export const OSSM_FOLLOWING_CONTROLS: readonly string[] = ["speed", "stroke", "depth"];

const STATE_CONTROLS = ["speed", "stroke", "depth", "sensation", "pattern"];

// Each control's value in the state the OSSM reports (its state characteristic, as JSON). The
// OSSM gives the pattern by its idx; the pattern control counts patterns in the list, so it's
// found there, and left out if it isn't.
export function ossmStateValues(state: unknown, patterns: readonly OSSMPattern[]): Record<string, number> {
  const values: Record<string, number> = {};
  if (!state || typeof state !== "object") return values;
  const reported = state as Record<string, unknown>;
  for (const name of STATE_CONTROLS) {
    const value = reported[name];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (name !== "pattern") values[name] = value;
    else {
      const index = patterns.findIndex((pattern) => pattern.idx === value);
      if (index >= 0) values[name] = index;
    }
  }
  return values;
}

// The bottom and top of the range the control is limited to.
export const lowest = (control: OssmToyControl) => control.limitMin ?? control.min;
export const highest = (control: OssmToyControl) => control.limitMax ?? control.max;

// The value, moved inside the range the control is limited to.
export const intoRange = (control: OssmToyControl, value: number) =>
  Math.min(highest(control), Math.max(lowest(control), value));

// Where a value sits along a slider from min to max, in %. 0 for a slider with one value, which
// has no length to place it along.
export const sliderPercent = (value: number, min: number, max: number) =>
  max > min ? ((value - min) / (max - min)) * 100 : 0;

// In stroker mode depth and stroke move together, keeping the stroke centred for a piston:
// setting one sets the other. The other control and its value, kept inside its range, or
// undefined for a control that doesn't move another.
export function strokerPartner(name: string, value: number, controls: Record<string, OssmToyControl>): [string, number] | undefined {
  const derived =
    name === "depth" ? ["stroke", Math.round((value - 50) * 2)] as const :
    name === "stroke" ? ["depth", Math.round(value / 2 + 50)] as const :
    undefined;
  if (!derived) return undefined;
  const [other, otherValue] = derived;
  const control = controls[other];
  return [other, control ? intoRange(control, otherValue) : otherValue];
}
