// Remembers each Buttplug toy control's range and invert in this phone's or browser's saved
// preferences, so a toy that reconnects gets them back. What it follows isn't remembered.
// Toys are told apart by name, so toys of the same model share their settings.

import { DEFAULT_MAX, DEFAULT_MIN, type ToyControl } from "./toyOutput.ts";

export type ToyMemoryStorage = Pick<Storage, "getItem" | "setItem">;

// A toy control as remembered: which toy control on the toy it is, and what it was set to.
export type RememberedControl = Pick<ToyControl, "mode" | "min" | "max" | "invert"> & { type?: string; index: number };

const STORAGE_KEY = "eom.toyControls";

type Settings = { min: number; max: number; invert: boolean };

export class ToyMemory {
  private storage: ToyMemoryStorage | undefined;

  constructor(storage: ToyMemoryStorage | undefined) {
    this.storage = storage;
  }

  // Saves the control's range and invert, for when a toy with this name next connects.
  save(toyName: string, control: RememberedControl) {
    if (!control.type) return;
    const saved = this.load();
    saved[keyOf(toyName, control)] = {
      min: control.min ?? DEFAULT_MIN,
      max: control.max ?? DEFAULT_MAX,
      invert: control.invert ?? false,
    };
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {}
  }

  // Gives a newly connected toy's controls the range and invert last saved for them. Every one
  // starts on Manual, so a toy never starts moving the moment it connects.
  restore(toyName: string, controls: RememberedControl[]) {
    const saved = this.load();
    for (const control of controls) {
      control.mode = "manual";
      const s = control.type ? validSettings(saved[keyOf(toyName, control)]) : undefined;
      if (!s) continue;
      control.min = s.min;
      control.max = s.max;
      control.invert = s.invert;
    }
  }

  private load(): Record<string, unknown> {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }
}

// Saved settings as a toy control can take them, or undefined if they aren't valid: saved
// preferences can be edited by hand or left by an older app. A range outside 0-255 is pulled in.
function validSettings(s: unknown): Settings | undefined {
  if (!s || typeof s !== "object") return undefined;
  const { min, max, invert } = s as Record<string, unknown>;
  if (typeof min !== "number" || typeof max !== "number" || typeof invert !== "boolean") return undefined;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return undefined;
  const clamp = (v: number) => Math.round(Math.min(DEFAULT_MAX, Math.max(DEFAULT_MIN, v)));
  return { min: clamp(min), max: clamp(max), invert };
}

// One entry per toy, toy control type and feature, so two vibrators on one toy keep their own.
const keyOf = (toyName: string, control: RememberedControl) => JSON.stringify([toyName, control.type, control.index]);
