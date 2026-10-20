// Turns EOM readings into the values sent to a Buttplug toy control, and sends them through
// Buttplug's own client calls.

// @ts-ignore - the vendored v4 bundle has no matching typings
import { DeviceOutput } from "../../buttplug/buttplug.mjs";

export type ToyReading = { motor: number; arousal: number; pressure: number; denied?: number };

export type ToyControl = {
  mode?: string;
  invert?: boolean;
  min?: number; // 0-255
  max?: number; // 0-255
};

const MAX_Y = 4096; // arousal and pressure are 12 bit

export const DEFAULT_MIN = 0;
export const DEFAULT_MAX = 255;

// Toys such as Lovense stutter and flash their light when sent commands too often.
export const MIN_COMMAND_GAP_MS = 100;

// Used when the toy doesn't say how many levels it has.
const DEFAULT_STEPS = 100;

// Where a reading puts a control that follows it, 0-1.
export function followFraction(mode: string, r: ToyReading, maxDenied: number): number {
  switch (mode) {
    case "arousal": return r.arousal / MAX_Y;
    case "pressure": return r.pressure / MAX_Y;
    case "denied": return (r.denied ?? 0) / maxDenied;
    default: return r.motor / 255;
  }
}

// The Buttplug percent (0-1) for a slider position (0-1), within the control's min and max.
export function percentFor(control: ToyControl, fraction: number): number {
  const min = (control.min ?? DEFAULT_MIN) / 255;
  const max = (control.max ?? DEFAULT_MAX) / 255;
  const f = Math.min(1, Math.max(0, fraction));
  const percent = f * (max - min) + min;
  return control.invert ? 1 - percent : percent;
}

// Follows readings for one control and decides when to send the toy a new value: only when the
// toy's level changes, and no more often than MIN_COMMAND_GAP_MS.
export class ToyFollower {
  sliderValue = 0; // 0-255, the on-screen slider position

  private control: ToyControl;
  private steps: number;
  private sentLevel: number | null = null;
  private sentAt = -Infinity;

  constructor(control: ToyControl, steps?: number) {
    this.control = control;
    this.steps = steps && steps > 0 ? steps : DEFAULT_STEPS;
  }

  // Returns the percent to send, or null to send nothing.
  onReading(r: ToyReading, maxDenied: number, nowMs: number): number | null {
    const control = this.control;
    if (!control.mode || control.mode === "manual") return null;
    const fraction = followFraction(control.mode, r, maxDenied);
    this.sliderValue = Math.round(Math.min(1, Math.max(0, fraction)) * 255);
    const level = Math.round(percentFor(control, fraction) * this.steps);
    if (level === this.sentLevel || nowMs - this.sentAt < MIN_COMMAND_GAP_MS) return null;
    this.sentLevel = level;
    this.sentAt = nowMs;
    return level / this.steps;
  }

  // A value was sent some other way (the slider), so don't skip the next change.
  forget() {
    this.sentLevel = null;
  }
}

// One output feature of a Buttplug toy, as the client gives it.
export type ToyFeature = { runOutput(cmd: unknown): Promise<void> };

// Sets a toy control to a percent (0-1). Buttplug maps the percent to the toy's levels.
// Position toys move there over MIN_COMMAND_GAP_MS, so they arrive about when the next value can come.
export async function setToyPercent(feature: ToyFeature, type: string, percent: number): Promise<void> {
  const cmd = type === "HwPositionWithDuration"
    ? DeviceOutput.PositionWithDuration.percent(percent, MIN_COMMAND_GAP_MS)
    : (DeviceOutput as unknown as Record<string, { percent(p: number): unknown }>)[type].percent(percent);
  return feature.runOutput(cmd);
}

type ToyDevice = { name: string; stop(): Promise<void>; emitDisconnected(): void };

// Stops the toy through Buttplug, then lets it go. A toy that's already out of reach can't be
// stopped, but is still let go.
export async function disconnectToy(device: ToyDevice): Promise<void> {
  try {
    await device.stop();
  } catch (err) {
    console.error(`Couldn't stop toy ${device.name}:`, err);
  }
  device.emitDisconnected();
}
