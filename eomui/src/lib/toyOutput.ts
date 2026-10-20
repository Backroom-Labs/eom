// Turns EOM readings into toy levels for a Buttplug toy control, and sends them through
// Buttplug's own client calls, paced by the toy's command gap.

import { DeviceOutput, type IButtplugClientDeviceFeature, type OutputType } from "buttplug";

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

// Toys such as Lovense stutter and flash their light when sent commands too often. Used when the
// toy doesn't report its own minimum command gap.
export const DEFAULT_COMMAND_GAP_MS = 100;

// The shortest time to leave between commands to a toy: the timing gap Buttplug reports for it,
// or DEFAULT_COMMAND_GAP_MS if it reports none.
export function commandGapMs(toy: { messageTimingGap?: number }): number {
  const gap = toy.messageTimingGap;
  return typeof gap === "number" && gap > 0 ? gap : DEFAULT_COMMAND_GAP_MS;
}

// Used when the toy doesn't say how many toy levels it has.
const DEFAULT_LEVELS = 100;

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

// The toy level (0 to levels) for a slider position (0-1), within the control's min and max.
export function levelFor(control: ToyControl, fraction: number, levels = DEFAULT_LEVELS): number {
  return Math.round(percentFor(control, fraction) * levels);
}

// Follows readings for one control: where its slider shows and which toy level the toy should be at.
export class ToyFollower {
  sliderValue = 0; // 0-255, the on-screen slider position

  private control: ToyControl;
  private levels: number;

  constructor(control: ToyControl, levels?: number) {
    this.control = control;
    this.levels = levels && levels > 0 ? levels : DEFAULT_LEVELS;
  }

  // Returns the toy level for this reading, or null when the control is on Manual.
  onReading(r: ToyReading, maxDenied: number): number | null {
    const control = this.control;
    if (!control.mode || control.mode === "manual") return null;
    const fraction = followFraction(control.mode, r, maxDenied);
    this.sliderValue = Math.round(Math.min(1, Math.max(0, fraction)) * 255);
    return levelFor(control, fraction, this.levels);
  }
}

// One output feature of a Buttplug toy, as the client gives it.
export type ToyFeature = Pick<IButtplugClientDeviceFeature, "runOutput" | "output">;

// How many toy levels the toy has for this output, e.g. 20 for a Lovense vibrator, from the
// output's value range as Buttplug reports it.
export function toyLevels(feature: Pick<IButtplugClientDeviceFeature, "output">, type: OutputType | `${OutputType}`): number | undefined {
  const range = feature.output(type as OutputType)?.valueRange;
  if (!range) return undefined;
  const levels = range[1] - range[0];
  return levels > 0 ? levels : undefined;
}

// Sets a toy control to a toy level. Sent as Buttplug's raw value, not a percent: Buttplug rounds
// a percent up, so float error in level/levels would send one level too high.
// Position toys move there over the toy's command gap, so they arrive about when the next value
// can come, kept within the move times the toy reports.
async function setToyLevel(feature: ToyFeature, type: OutputType | `${OutputType}`, level: number, gapMs: number): Promise<void> {
  const output = feature.output(type as OutputType);
  const value = (output?.valueRange[0] ?? 0) + level;
  if (type === "HwPositionWithDuration") {
    const [shortest, longest] = output?.durationRange ?? [gapMs, gapMs];
    return feature.runOutput(DeviceOutput.HwPositionWithDuration.value(value, Math.min(longest, Math.max(shortest, gapMs))));
  }
  return feature.runOutput(DeviceOutput[type as Exclude<`${OutputType}`, "HwPositionWithDuration" | "Unknown">].value(value));
}

export type PacedControl = { type?: OutputType | `${OutputType}`; feature: ToyFeature };

// Every command to one Buttplug toy goes through its pacer, from all its controls, following or
// set by hand, so the toy never gets two closer together than its command gap. A level that
// can't go yet waits for the gap, replaced by any newer one for the same control, so the last
// one always arrives. Levels the toy is already at aren't sent again.
export class ToyPacer {
  private readonly gapMs: number;
  private toy: { name: string; stop(): Promise<void> };
  private sentAt = -Infinity;
  private sent = new Map<PacedControl, number>(); // the last toy level sent to each control
  private waiting = new Map<PacedControl, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(toy: { name: string; messageTimingGap?: number; stop(): Promise<void> }) {
    this.toy = toy;
    this.gapMs = commandGapMs(toy);
  }

  set(control: PacedControl, level: number) {
    if (!control.type) return;
    if (this.sent.get(control) === level) this.waiting.delete(control);
    else this.waiting.set(control, level);
    this.sendNext();
  }

  // Stops the toy now, whatever the gap, and drops levels still waiting.
  async stop(): Promise<void> {
    this.cancel();
    this.sent.clear();
    this.sentAt = Date.now();
    await this.toy.stop();
  }

  // Drops levels still waiting, for a toy that's gone.
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.waiting.clear();
  }

  private sendNext() {
    if (this.timer !== undefined) return;
    const next = this.waiting.entries().next();
    if (next.done) return;
    const wait = this.sentAt + this.gapMs - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.sendNext();
      }, wait);
      return;
    }
    const [control, level] = next.value;
    this.waiting.delete(control);
    this.sent.set(control, level);
    this.sentAt = Date.now();
    setToyLevel(control.feature, control.type!, level, this.gapMs)
      .catch((err) => console.error(`Error sending command to toy ${this.toy.name}:`, err));
    this.sendNext();
  }
}

type DisconnectableToy = { name: string; stop(): Promise<void>; emitDisconnected(): void };

// Stops the toy through Buttplug, then lets it go. A toy that's already out of reach can't be
// stopped, but is still let go.
export async function disconnectToy(toy: DisconnectableToy): Promise<void> {
  try {
    await toy.stop();
  } catch (err) {
    console.error(`Couldn't stop toy ${toy.name}:`, err);
  }
  toy.emitDisconnected();
}
