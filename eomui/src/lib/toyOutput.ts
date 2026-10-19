// Turns EOM readings into the values sent to a Buttplug toy control.

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

// The Buttplug scalar (0-1) for a slider position (0-1), within the control's min and max.
export function scalarFor(control: ToyControl, fraction: number): number {
  const min = (control.min ?? DEFAULT_MIN) / 255;
  const max = (control.max ?? DEFAULT_MAX) / 255;
  const f = Math.min(1, Math.max(0, fraction));
  const scalar = f * (max - min) + min;
  return control.invert ? 1 - scalar : scalar;
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

  // Returns the scalar to send, or null to send nothing.
  onReading(r: ToyReading, maxDenied: number, nowMs: number): number | null {
    const control = this.control;
    if (!control.mode || control.mode === "manual") return null;
    const fraction = followFraction(control.mode, r, maxDenied);
    this.sliderValue = Math.round(Math.min(1, Math.max(0, fraction)) * 255);
    const level = Math.round(scalarFor(control, fraction) * this.steps);
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
