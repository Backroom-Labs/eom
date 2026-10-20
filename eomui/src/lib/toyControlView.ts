// What the Toys drawer shows for a Buttplug toy control: its help text, live level and range.

import { InputType } from "buttplug";
import type { ButtplugToy, ButtplugToyControl } from "./toyList.ts";
import { FOLLOW_MODES, percentOf, rangeOf, type FollowMode, type ToyControl } from "./toyOutput.ts";

const LABELS: Record<FollowMode, string> = {
  manual: "Manual",
  pleasure: "Pleasure",
  arousal: "Arousal",
  pressure: "Pressure",
  denied: "Denials",
};

// What a toy control can follow, in the order the drawer offers them.
export const FOLLOWS: readonly { mode: FollowMode; label: string }[] = FOLLOW_MODES.map((mode) => ({ mode, label: LABELS[mode] }));

// What a toy or toy control follows, e.g. "Follows pleasure, arousal", or "Manual" if nothing.
export function followsText(follows: readonly FollowMode[]): string {
  const following = follows.filter((mode) => mode !== "manual");
  return following.length ? `Follows ${following.map((mode) => LABELS[mode].toLowerCase()).join(", ")}` : "Manual";
}

// A 0-255 value as a whole percent.
export const percent255 = (value: number) => percentOf(value, 0, 255);

// Moves one end of the control's range (0-255), stopping at the other end so they can't cross.
// Returns where it ended up, for the slider thumb.
export function setRangeEnd(control: Pick<ToyControl, "min" | "max">, end: "min" | "max", value: number): number {
  const { min, max } = rangeOf(control);
  const v = end === "min" ? Math.min(value, max) : Math.max(value, min);
  control[end] = v;
  return v;
}

// The two range thumbs share one track, so where they meet only the top one can be grabbed, and
// it can only move outward. The min thumb goes on top when it has more room below than the max
// thumb has above, so at either end of the track the thumb that can move is the one on top.
export function minThumbOnTop(control: Pick<ToyControl, "min" | "max">): boolean {
  const { min, max } = rangeOf(control);
  return min > 255 - max;
}

// e.g. "Follows pleasure between 20% and 80%." Inverted, it gives the levels the toy really gets.
export function toyControlHelp(control: ToyControl): string {
  const mode = control.mode ?? "manual";
  const what = mode === "manual" ? "Set by hand" : followsText([mode]);
  const { min, max } = rangeOf(control);
  if (control.invert) return `${what} inverted, from ${percent255(255 - min)}% down to ${percent255(255 - max)}%.`;
  return `${what} between ${percent255(min)}% and ${percent255(max)}%.`;
}

type BatteryToy = { name: string; hasInput(type: InputType): boolean; battery(): Promise<number> };

// The toy's battery level in % (Buttplug v5 reports 0-100), or undefined if it doesn't report one, can't be read, or isn't
// connected, before the read or by the time it finishes.
export async function readToyBattery(toy: BatteryToy, connected: () => boolean): Promise<number | undefined> {
  if (!connected() || !toy.hasInput(InputType.Battery)) return undefined;
  try {
    const level = await toy.battery();
    return connected() ? Math.round(Math.min(100, Math.max(0, level))) : undefined;
  } catch (e) {
    if (connected()) console.error(`Couldn't read the battery of toy ${toy.name}:`, e);
    return undefined;
  }
}

// The control's range or invert changed. A Manual control is set again from where its slider is
// (0-255), through the toy's usual pacing, so the toy and the value pill keep up. A following one
// gets it with the next reading.
export function toyControlChanged<C extends ButtplugToyControl>(
  toy: Pick<ButtplugToy<C>, "setByHand"> | undefined,
  control: C,
  sliderPosition: number,
) {
  if ((control.mode ?? "manual") === "manual") toy?.setByHand(control, sliderPosition / 255);
}
