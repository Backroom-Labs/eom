// Every write to one OSSM goes through its writer, from all its controls, following or set by
// hand, as ToyPacer does for Buttplug toys (ADR 0009). The OSSM takes one write at a time, at
// most one every 100 ms. A value that can't go yet waits, replaced by any newer one for the same
// control, so the last one always arrives. Values the OSSM already has aren't sent again.

export const OSSM_GAP_MS = 100;

export type OssmWrite = (name: string, value: number) => Promise<void>;

export class OssmWriter {
  private write: OssmWrite;
  private sentAt = -Infinity;
  private sent = new Map<string, number>(); // the last value written, or being written, to each control
  private waiting = new Map<string, number>();
  private inFlight: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  // write sends one value to the OSSM, and rejects if it didn't get there.
  constructor(write: OssmWrite) {
    this.write = write;
  }

  set(name: string, value: number) {
    if (this.sent.get(name) === value) this.waiting.delete(name);
    else this.waiting.set(name, value);
    this.sendNext();
  }

  private sendNext() {
    if (this.inFlight || this.timer !== undefined) return;
    const next = this.waiting.entries().next();
    if (next.done) return;
    const wait = this.sentAt + OSSM_GAP_MS - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.sendNext();
      }, wait);
      return;
    }
    const [name, value] = next.value;
    this.waiting.delete(name);
    this.start(() => this.send(name, value));
  }

  // Sets speed 0 at once, whatever the gap, ahead of values still waiting, which are dropped. A
  // write already in flight finishes first, as the OSSM takes one at a time. Rejects if speed 0
  // couldn't be written.
  async stop(): Promise<void> {
    this.cancel();
    const before = this.inFlight;
    let failed: unknown;
    await this.start(async () => {
      await before;
      this.sent.set("speed", 0);
      this.sentAt = Date.now();
      try {
        await this.write("speed", 0);
      } catch (err) {
        this.sent.delete("speed");
        failed = err;
      }
    });
    if (failed !== undefined) throw failed;
  }

  // Drops values still waiting, for an OSSM that's gone.
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.waiting.clear();
  }

  // Runs one write, which never rejects. Nothing else is sent until it's done.
  private start(task: () => Promise<void>): Promise<void> {
    const running: Promise<void> = task().finally(() => {
      if (this.inFlight !== running) return;
      this.inFlight = undefined;
      this.sendNext();
    });
    this.inFlight = running;
    return running;
  }

  private async send(name: string, value: number) {
    this.sent.set(name, value);
    this.sentAt = Date.now();
    try {
      await this.write(name, value);
    } catch (err) {
      // We don't know what the OSSM has now, so the next value for this control goes out.
      if (this.sent.get(name) === value) this.sent.delete(name);
      console.error(`Error writing ${name} ${value} to OSSM:`, err);
    }
  }
}
