// Remembers each OSSM control's range and invert with ToyMemory, as for Buttplug toys, so an
// OSSM that reconnects gets them back. OSSMs are told apart by their Bluetooth name, so two with
// the same name share their settings. What a control follows isn't remembered.

import { highest, intoRange, lowest, type OssmHandle, type OssmToyControl } from "./ossmControls.ts";
import type { RememberedControl, ToyMemory } from "./toyMemory.ts";

// Pattern's range isn't remembered: it's set from the patterns the OSSM has when it connects.
const NOT_REMEMBERED = ["pattern"];

// The control as ToyMemory keeps it: its range as min and max, keyed by the control's name.
function remembered(name: string, control: OssmToyControl): RememberedControl {
  return {
    type: name,
    index: 0,
    min: lowest(control),
    max: highest(control),
    invert: control.inverted ?? false,
  };
}

// Saves the control's range and invert, for when an OSSM with this name next connects.
export function rememberOssmControl(memory: ToyMemory, ossmName: string, name: string, control: OssmToyControl) {
  if (NOT_REMEMBERED.includes(name)) return;
  memory.save(ossmName, remembered(name, control));
}

// Gives a newly connected OSSM's controls the range and invert last saved for them, and queues a
// write for any value outside its range, to move it in. Every one starts on Manual, as ToyMemory
// restores them, so an OSSM never starts moving the moment it connects. Speed is never changed:
// an OSSM connected mid-session keeps going as it was.
export function restoreOssmControls(memory: ToyMemory, ossm: OssmHandle) {
  const controls = Object.entries(ossm.controls);
  const restored = controls.map(([name, control]) => remembered(name, control));
  memory.restore(ossm.name, restored);
  // Every range first, so a value one control's write derives for another (stroker mode) is
  // kept inside the other's restored range.
  controls.forEach(([name, control], i) => {
    const r = restored[i];
    control.mode = r.mode ?? "manual";
    if (NOT_REMEMBERED.includes(name)) return;
    control.limitMin = r.min;
    control.limitMax = r.max;
    control.inverted = r.invert;
  });
  for (const [name, control] of controls) {
    if (name === "speed") continue;
    const value = intoRange(control, control.value);
    if (value !== control.value) ossm.setControl(name, value);
  }
}
