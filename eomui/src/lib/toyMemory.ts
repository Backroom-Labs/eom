// Remembers each Buttplug toy control's range and invert in this phone's or browser's saved
// preferences, so a toy that reconnects gets them back. What it follows isn't remembered.

import type { ToyControl } from "./toyOutput.ts";

export type ToyMemoryStorage = Pick<Storage, "getItem" | "setItem">;

// A toy control as remembered: which toy control on the toy it is, and what it was set to.
export type RememberedControl = Pick<ToyControl, "mode" | "min" | "max" | "invert"> & { type?: string; index: number };

const STORAGE_KEY = "eom.toyControls";

type Saved = Record<string, { min?: number; max?: number; invert?: boolean }>;

export class ToyMemory {
  private storage: ToyMemoryStorage | undefined;

  constructor(storage: ToyMemoryStorage | undefined) {
    this.storage = storage;
  }

  // Saves the control's range and invert, for when the toy with this name next connects.
  save(toyName: string, control: RememberedControl) {
    if (!control.type) return;
    const saved = this.load();
    saved[keyOf(toyName, control)] = { min: control.min, max: control.max, invert: control.invert };
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
      const s = control.type ? saved[keyOf(toyName, control)] : undefined;
      if (!s) continue;
      if (typeof s.min === "number") control.min = s.min;
      if (typeof s.max === "number") control.max = s.max;
      if (typeof s.invert === "boolean") control.invert = s.invert;
    }
  }

  private load(): Saved {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }
}

// One entry per toy, toy control type and feature, so two vibrators on one toy keep their own.
const keyOf = (toyName: string, control: RememberedControl) => JSON.stringify([toyName, control.type, control.index]);
