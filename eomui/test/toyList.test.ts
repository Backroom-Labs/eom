// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyList, buttplugToy, ossmToy, type Toy } from "../src/lib/toyList.ts";
import { ToyFollower, type ToyReading } from "../src/lib/toyOutput.ts";

// A toy that records what the list asks of it.
function recordingToy() {
  const calls: string[] = [];
  const toy: Toy = {
    device: {},
    follow: () => { calls.push("follow"); },
    stop: async () => { calls.push("stop"); },
  };
  return { toy, calls };
}

test("stopping the list stops every connected toy", async () => {
  const toys = new ToyList();
  const a = recordingToy();
  const b = recordingToy();
  toys.add(a.toy);
  toys.add(b.toy);
  await toys.stopAll();
  assert.deepEqual(a.calls, ["stop"]);
  assert.deepEqual(b.calls, ["stop"]);
});

const AROUSAL_HALF: ToyReading = { motor: 0, arousal: 2048, pressure: 0, denied: 0 };
const AROUSAL_FULL: ToyReading = { motor: 0, arousal: 4096, pressure: 0, denied: 0 };

// A Buttplug toy with one vibrator following arousal; sent counts the commands that reach it.
function fakeButtplugToy(mode = "arousal") {
  const sent: unknown[] = [];
  let stops = 0;
  const control: any = { type: "Vibrate", mode, invert: false, min: 0, max: 255, feature: { runOutput: async (cmd: unknown) => { sent.push(cmd); } } };
  control.follower = new ToyFollower(control, 20);
  control.sliderElement = { value: "0" };
  control.modeElement = { value: mode };
  const device = { name: "Domi", controls: [control], stop: async () => { stops++; } };
  return { device, control, sent, stops: () => stops };
}

test("a Buttplug toy following arousal is sent the reading", () => {
  const t = fakeButtplugToy();
  buttplugToy(t.device).follow(AROUSAL_HALF, 20, 0);
  assert.equal(t.sent.length, 1);
  assert.equal(t.control.sliderElement.value, "128");
});

test("a stopped Buttplug toy is stopped, shows Manual at 0, and ignores new readings", async () => {
  const t = fakeButtplugToy();
  const toy = buttplugToy(t.device);
  toy.follow(AROUSAL_HALF, 20, 0);
  await toy.stop();
  assert.equal(t.stops(), 1);
  assert.equal(t.control.mode, "manual");
  assert.equal(t.control.modeElement.value, "manual");
  assert.equal(t.control.sliderElement.value, "0");
  const before = t.sent.length;
  toy.follow(AROUSAL_FULL, 20, 1000);
  assert.equal(t.sent.length, before);
});

test("a Buttplug toy driven by hand is stopped too", async () => {
  const t = fakeButtplugToy("manual");
  t.control.sliderElement.value = "200";
  await buttplugToy(t.device).stop();
  assert.equal(t.stops(), 1);
  assert.equal(t.control.sliderElement.value, "0");
});

// An OSSM like OSSM.svelte's: setControl drops a write while another is in flight.
function fakeOssm(speedMode = "pleasure") {
  const writes: [string, number][] = [];
  const ossm: any = {
    name: "OSSM",
    isWriting: false,
    controls: {
      speed: { value: 0, min: 0, max: 100, mode: speedMode },
      stroke: { value: 50, min: 0, max: 100, mode: "arousal" },
      depth: { value: 10, min: 0, max: 100, mode: "manual" },
    },
    async setControl(name: string, value: number) {
      if (ossm.isWriting) return;
      writes.push([name, value]);
      ossm.controls[name].value = value;
    },
  };
  return { ossm, writes };
}

const PLEASURE_FULL: ToyReading = { motor: 255, arousal: 4096, pressure: 0, denied: 0 };

test("an OSSM following pleasure gets its speed from the reading", () => {
  const { ossm } = fakeOssm();
  ossmToy(ossm).follow(PLEASURE_FULL, 20, 0);
  assert.equal(ossm.controls.speed.value, 100);
});

test("a stopped OSSM is at speed 0 with every control on Manual, and ignores new readings", async () => {
  const { ossm, writes } = fakeOssm();
  const toy = ossmToy(ossm);
  toy.follow(PLEASURE_FULL, 20, 0);
  await toy.stop();
  assert.equal(ossm.controls.speed.value, 0);
  assert.deepEqual(Object.values(ossm.controls).map((c: any) => c.mode), ["manual", "manual", "manual"]);
  const before = writes.length;
  toy.follow(PLEASURE_FULL, 20, 1000);
  assert.equal(writes.length, before);
});

test("an OSSM busy writing when stopped still ends at speed 0", async () => {
  const { ossm } = fakeOssm("manual");
  ossm.controls.speed.value = 60;
  ossm.isWriting = true;
  setTimeout(() => (ossm.isWriting = false), 30);
  await ossmToy(ossm).stop();
  assert.equal(ossm.controls.speed.value, 0);
});

// A list holding a Buttplug toy and an OSSM, both following the EOM.
function listOfBoth() {
  const toys = new ToyList();
  const bp = fakeButtplugToy();
  const ossm = fakeOssm();
  toys.add(buttplugToy(bp.device));
  toys.add(ossmToy(ossm.ossm));
  toys.follow(PLEASURE_FULL, 20, 0);
  return { toys, bp, ossm };
}

// Every toy is stopped, on Manual, and a new reading doesn't start either again.
function assertAllStopped({ toys, bp, ossm }: ReturnType<typeof listOfBoth>) {
  assert.equal(bp.stops(), 1);
  assert.equal(bp.control.mode, "manual");
  assert.equal(ossm.ossm.controls.speed.value, 0);
  assert.ok(Object.values(ossm.ossm.controls).every((c: any) => c.mode === "manual"));
  const sent = bp.sent.length;
  const writes = ossm.writes.length;
  toys.follow(PLEASURE_FULL, 20, 5000);
  assert.equal(bp.sent.length, sent);
  assert.equal(ossm.writes.length, writes);
}

test("the list passes each reading to every toy", () => {
  const { bp, ossm } = listOfBoth();
  assert.equal(bp.sent.length, 1);
  assert.equal(ossm.ossm.controls.speed.value, 100);
});

test("the EOM's Stop button stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.stopAll();
  assertAllStopped(both);
});

test("a safety stop reported by the EOM stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20, 100);
  assertAllStopped(both);
});

test("a safety stop still being reported doesn't stop toys started again by hand", async () => {
  const { toys, bp } = listOfBoth();
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20, 100);
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20, 200);
  assert.equal(bp.stops(), 1);
});

test("losing the EOM connection stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.eomConnected(true);
  await both.toys.eomConnected(false);
  assertAllStopped(both);
});

test("connecting to the EOM doesn't stop toys", async () => {
  const { toys, bp } = listOfBoth();
  await toys.eomConnected(false);
  await toys.eomConnected(true);
  assert.equal(bp.stops(), 0);
});

test("a toy removed from the list is no longer stopped", async () => {
  const toys = new ToyList();
  const a = recordingToy();
  toys.add(a.toy);
  toys.remove(a.toy.device);
  await toys.stopAll();
  assert.deepEqual(a.calls, []);
});
