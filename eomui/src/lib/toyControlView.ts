// What the Toys drawer shows for a Buttplug toy control: its help text, live level and range.

import { DEFAULT_LEVELS, DEFAULT_MAX, DEFAULT_MIN, levelFor, type ToyControl } from "./toyOutput.ts";

// What a toy control can follow, in the order the drawer offers them.
export const FOLLOWS = [
  { mode: "manual", label: "Manual" },
  { mode: "pleasure", label: "Pleasure" },
  { mode: "arousal", label: "Arousal" },
  { mode: "pressure", label: "Pressure" },
  { mode: "denied", label: "Denials" },
] as const;

// A 0-255 value as a whole percent.
export const percent255 = (value: number) => Math.round((value / 255) * 100);

// The toy level the slider (0-255) puts the toy at, in %, for the control's value pill.
export function toyLevelPercent(control: ToyControl, sliderValue: number, levels?: number): number {
  const n = levels && levels > 0 ? levels : DEFAULT_LEVELS;
  return Math.round((levelFor(control, sliderValue / 255, n) / n) * 100);
}

// Moves one end of the control's range (0-255), stopping at the other end so they can't cross.
// Returns where it ended up, for the slider thumb.
export function setRangeEnd(control: Pick<ToyControl, "min" | "max">, end: "min" | "max", value: number): number {
  const min = control.min ?? DEFAULT_MIN;
  const max = control.max ?? DEFAULT_MAX;
  const v = end === "min" ? Math.min(value, max) : Math.max(value, min);
  control[end] = v;
  return v;
}

// e.g. "Follows pleasure between 20% and 80%." Inverted, it gives the levels the toy really gets.
export function toyControlHelp(control: ToyControl): string {
  const mode = control.mode ?? "manual";
  const label = FOLLOWS.find((f) => f.mode === mode)?.label.toLowerCase() ?? mode;
  const what = mode === "manual" ? "Set by hand" : `Follows ${label}`;
  const min = control.min ?? DEFAULT_MIN;
  const max = control.max ?? DEFAULT_MAX;
  if (control.invert) return `${what} inverted, from ${percent255(255 - min)}% down to ${percent255(255 - max)}%.`;
  return `${what} between ${percent255(min)}% and ${percent255(max)}%.`;
}
