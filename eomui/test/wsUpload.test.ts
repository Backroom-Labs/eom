// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wsUploader, readWsDeviceInfo, type OtaSocket } from "../src/lib/wsUpload.ts";
import { OtaResult, type UploadStage } from "../src/lib/otaProtocol.ts";

const WINDOW = 16 * 1024;
const CHUNK = 4096;

// Plays the EOM's side of the Wi-Fi OTA protocol (src/include/system/ws_ota.h) on a fake socket.
class FakeEom implements OtaSocket {
  received = new Uint8Array(0);
  frames: { offset: number; length: number }[] = [];
  sentText: any[] = [];
  maxInFlight = 0;
  // Behaviour knobs for a test:
  beginResult: number | null = null; // refuse BEGIN with this result
  dropFrameAt: number | null = null; // lose the frame at this offset once
  holdProgress = false; // stop acknowledging, to see the window fill
  closeAfterBytes: number | null = null;
  oldFirmware = false; // predates Wi-Fi updates

  private listeners: Record<string, Set<(event: any) => void>> = { message: new Set(), close: new Set() };
  private size = 0;
  private next = 0;
  private acked = 0;
  private resendPending = false;

  addEventListener(type: "message" | "close", listener: (event: any) => void) {
    this.listeners[type].add(listener);
  }
  removeEventListener(type: "message" | "close", listener: (event: any) => void) {
    this.listeners[type].delete(listener);
  }
  listenerCount() {
    return this.listeners.message.size + this.listeners.close.size;
  }

  send(data: string | ArrayBufferView) {
    if (typeof data === "string") return this.onText(JSON.parse(data));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.onFrame(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true), bytes.subarray(4));
  }

  // Lets the EOM acknowledge everything it has written so far.
  release() {
    this.holdProgress = false;
    this.progress();
  }

  private emit(event: string, error: number, value: number) {
    const message = { data: JSON.stringify({ ota: { event, error, value } }) };
    queueMicrotask(() => this.listeners.message.forEach((l) => l(message)));
  }

  private onText(msg: any) {
    this.sentText.push(msg);
    if ("otaInfo" in msg && this.oldFirmware) {
      const reply = { data: JSON.stringify({ otaInfo: { error: "NOT IMPLEMENTED" } }) };
      queueMicrotask(() => this.listeners.message.forEach((l) => l(reply)));
    } else if ("otaInfo" in msg) {
      queueMicrotask(() =>
        this.listeners.message.forEach((l) =>
          l({ data: JSON.stringify({ otaInfo: { version: "3.8.0-beta.1", board: "m5stack_atom_echo", maxSize: 1966080, confirmed: true } }) }),
        ),
      );
    } else if ("otaBegin" in msg) {
      if (this.beginResult !== null) return this.emit("result", this.beginResult, 0);
      this.size = msg.otaBegin.size;
      this.emit("ready", 0, 0);
    }
  }

  private onFrame(offset: number, data: Uint8Array) {
    this.frames.push({ offset, length: data.length });
    this.maxInFlight = Math.max(this.maxInFlight, offset + data.length - this.acked);
    if (offset === this.dropFrameAt) {
      this.dropFrameAt = null;
      return; // lost on the way
    }
    if (offset !== this.next) {
      if (!this.resendPending) this.emit("resend", 0, this.next);
      this.resendPending = true;
      return;
    }
    this.resendPending = false;
    const grown = new Uint8Array(this.received.length + data.length);
    grown.set(this.received);
    grown.set(data, this.received.length);
    this.received = grown;
    this.next += data.length;
    if (this.closeAfterBytes !== null && this.next >= this.closeAfterBytes) {
      queueMicrotask(() => this.listeners.close.forEach((l) => l({})));
      return;
    }
    if (!this.holdProgress) this.progress();
  }

  private progress() {
    if (this.next === this.acked) return;
    this.acked = this.next;
    this.emit("progress", 0, this.acked);
    if (this.acked === this.size) this.emit("result", 0, 0);
  }
}

const image = (size: number) => new Uint8Array(size).map((_, i) => (i * 31 + 7) % 256);
const options = (stages: UploadStage[] = []) => ({
  allowDowngrade: false,
  onProgress: (_: number, stage: UploadStage) => stages.push(stage),
});

test("an image goes to the EOM whole, in order, in chunks with their offsets", async () => {
  const eom = new FakeEom();
  const bytes = image(3 * CHUNK + 123);
  const stages: UploadStage[] = [];
  assert.equal(await wsUploader(eom).upload(bytes, options(stages)), OtaResult.OK);
  assert.deepEqual(eom.received, bytes);
  assert.deepEqual(eom.sentText[0], { otaBegin: { size: bytes.length, allowDowngrade: false } });
  assert.deepEqual(eom.frames.map((f) => f.offset), [0, CHUNK, 2 * CHUNK, 3 * CHUNK]);
  assert.equal(stages[0], "preparing");
  assert.equal(stages.at(-1), "verifying");
});

test("no more than the window is in flight beyond what the EOM has acknowledged", async () => {
  const eom = new FakeEom();
  eom.holdProgress = true;
  const bytes = image(10 * CHUNK);
  const upload = wsUploader(eom).upload(bytes, options());
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(eom.frames.length, WINDOW / CHUNK); // then it waits
  eom.release();
  assert.equal(await upload, OtaResult.OK);
  assert.ok(eom.maxInFlight <= WINDOW, `in flight: ${eom.maxInFlight}`);
  assert.deepEqual(eom.received, bytes);
});

test("a lost frame is resent from where the EOM asks", async () => {
  const eom = new FakeEom();
  eom.dropFrameAt = CHUNK;
  const bytes = image(6 * CHUNK);
  assert.equal(await wsUploader(eom).upload(bytes, options()), OtaResult.OK);
  assert.deepEqual(eom.received, bytes);
  assert.equal(eom.frames.filter((f) => f.offset === CHUNK).length, 2);
});

test("a BEGIN the EOM refuses returns its result and sends no image", async () => {
  const eom = new FakeEom();
  eom.beginResult = OtaResult.BUSY;
  assert.equal(await wsUploader(eom).upload(image(CHUNK), options()), OtaResult.BUSY);
  assert.equal(eom.frames.length, 0);
});

test("a connection lost mid-transfer is reported, and the uploader stops listening", async () => {
  const eom = new FakeEom();
  eom.closeAfterBytes = 2 * CHUNK;
  await assert.rejects(wsUploader(eom).upload(image(10 * CHUNK), options()), { message: "The connection to the EOM was lost." });
  assert.equal(eom.listenerCount(), 0);
});

test("readWsDeviceInfo asks the EOM what it runs", async () => {
  assert.deepEqual(await readWsDeviceInfo(new FakeEom()), {
    version: "3.8.0-beta.1",
    board: "m5stack_atom_echo",
    maxSize: 1966080,
    confirmed: true,
  });
});

test("readWsDeviceInfo gives null for firmware from before Wi-Fi updates", async () => {
  const eom = new FakeEom();
  eom.oldFirmware = true;
  assert.equal(await readWsDeviceInfo(eom), null);
  assert.equal(eom.listenerCount(), 0);
});
