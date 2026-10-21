// Remembers each OSSM control's range and invert with ToyMemory, as for Buttplug toys, so an
// OSSM that reconnects gets them back. OSSMs are told apart by their Bluetooth name, so two with
// the same name share their settings. What a control follows isn't remembered.

import type { OssmHandle, OssmToyControl } from "./toyList.ts";
import type { RememberedControl, ToyMemory } from "./toyMemory.ts";

// Pattern's range isn't remembered: it's set from the patterns the OSSM has when it connects.
const NOT_REMEMBERED = ["pattern"];

// The control as ToyMemory keeps it: its range as min and max, keyed by the control's name.
function remembered(name: string, control: OssmToyControl): RememberedControl {
  return {
    type: name,
    index: 0,
    min: control.limitMin ?? control.min,
    max: control.limitMax ?? control.max,
    invert: control.inverted ?? false,
  };
}

// Saves the control's range and invert, for when an OSSM with this name next connects.
export function rememberOssmControl(memory: ToyMemory, ossmName: string, name: string, control: OssmToyControl) {
  if (NOT_REMEMBERED.includes(name)) return;
  memory.save(ossmName, remembered(name, control));
}

// Gives a newly connected OSSM's controls the range and invert last saved for them, and queues a
// write for any value outside its range, to move it in. Every one starts on Manual, so an OSSM never starts moving the moment it
// connects.
export function restoreOssmControls(memory: ToyMemory, ossm: OssmHandle) {
  for (const [name, control] of Object.entries(ossm.controls)) {
    control.mode = "manual";
    if (NOT_REMEMBERED.includes(name)) continue;
    const r = remembered(name, control);
    memory.restore(ossm.name, [r]);
    control.limitMin = r.min;
    control.limitMax = r.max;
    control.inverted = r.invert;
    const value = intoRange(name, control);
    if (value !== control.value) ossm.setControl(name, value);
  }
}

// Where the control's value has to go to be inside its range. Speed is only ever lowered, so a
// paused OSSM doesn't start moving when it connects.
function intoRange(name: string, control: OssmToyControl): number {
  const max = control.limitMax ?? control.max;
  if (name === "speed") return Math.min(control.value, max);
  return Math.min(max, Math.max(control.limitMin ?? control.min, control.value));
}
