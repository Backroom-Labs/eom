// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyList, buttplugToy, ossmToy, type Toy, type ButtplugToyControl } from "../src/lib/toyList.ts";
import { type ToyReading } from "../src/lib/toyOutput.ts";
import { fakeToy, settle } from "./fakeToy.ts";

// A toy that records what the list asks of it.
function recordingToy() {
  const calls: string[] = [];
  const toy: Toy = {
    key: {},
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

// A Buttplug toy with one vibrator following arousal, on the real client; shown records what
// the toy tells the screen.
function fakeButtplugToy(mode = "arousal") {
  const t = fakeToy({ Vibrate: { Value: [0, 20] } });
  let stops = 0;
  const control: ButtplugToyControl = { type: "Vibrate", mode, invert: false, min: 0, max: 255, feature: t.feature };
  const shown = { mode, slider: 0 };
  const handle = { name: "Domi", controls: [control], stop: async () => { stops++; await t.toy.stop(); } };
  const toy = buttplugToy(handle, (c, slider) => { shown.mode = c.mode!; shown.slider = slider; });
  const sent = () => t.outputs();
  return { toy, control, shown, sent, stops: () => stops };
}

test("a Buttplug toy following arousal is sent the reading", async () => {
  const t = fakeButtplugToy();
  t.toy.follow(AROUSAL_HALF, 20);
  await settle();
  assert.deepEqual(t.sent(), [{ Vibrate: { Value: 10, Duration: undefined } }]);
  assert.equal(t.shown.slider, 128);
});

test("a stopped Buttplug toy is stopped, shows Manual at 0, and ignores new readings", async () => {
  const t = fakeButtplugToy();
  t.toy.follow(AROUSAL_HALF, 20);
  await t.toy.stop();
  assert.equal(t.stops(), 1);
  assert.equal(t.control.mode, "manual");
  assert.deepEqual(t.shown, { mode: "manual", slider: 0 });
  const before = t.sent().length;
  t.toy.follow(AROUSAL_FULL, 20);
  await settle();
  assert.equal(t.sent().length, before);
});

test("a Buttplug toy driven by hand is stopped too", async () => {
  const t = fakeButtplugToy("manual");
  t.toy.setByHand(t.control, 0.8);
  await t.toy.stop();
  assert.equal(t.stops(), 1);
  assert.equal(t.shown.slider, 0);
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
  ossmToy(ossm).follow(PLEASURE_FULL, 20);
  assert.equal(ossm.controls.speed.value, 100);
});

test("a stopped OSSM is at speed 0, leaves stroke and depth where they are, has every control on Manual, and ignores new readings", async () => {
  const { ossm, writes } = fakeOssm();
  const toy = ossmToy(ossm);
  toy.follow(PLEASURE_FULL, 20);
  const stroke = ossm.controls.stroke.value;
  await toy.stop();
  assert.equal(ossm.controls.speed.value, 0);
  assert.equal(ossm.controls.stroke.value, stroke);
  assert.equal(ossm.controls.depth.value, 10);
  assert.deepEqual(Object.values(ossm.controls).map((c: any) => c.mode), ["manual", "manual", "manual"]);
  const before = writes.length;
  toy.follow(PLEASURE_FULL, 20);
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
  toys.add(bp.toy);
  toys.add(ossmToy(ossm.ossm));
  toys.follow(PLEASURE_FULL, 20);
  return { toys, bp, ossm };
}

// Every toy is stopped, on Manual, and a new reading doesn't start either again.
async function assertAllStopped({ toys, bp, ossm }: ReturnType<typeof listOfBoth>) {
  assert.equal(bp.stops(), 1);
  assert.equal(bp.control.mode, "manual");
  assert.equal(ossm.ossm.controls.speed.value, 0);
  assert.ok(Object.values(ossm.ossm.controls).every((c: any) => c.mode === "manual"));
  const sent = bp.sent().length;
  const writes = ossm.writes.length;
  await toys.follow(PLEASURE_FULL, 20);
  await settle();
  assert.equal(bp.sent().length, sent);
  assert.equal(ossm.writes.length, writes);
}

test("the list passes each reading to every toy", async () => {
  const { bp, ossm } = listOfBoth();
  await settle();
  assert.equal(bp.sent().length, 1);
  assert.equal(ossm.ossm.controls.speed.value, 100);
});

test("the EOM's Stop button stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.stopAll();
  await assertAllStopped(both);
});

test("a safety stop reported by the EOM stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20);
  await assertAllStopped(both);
});

test("a safety stop still being reported doesn't stop toys started again by hand", async () => {
  const { toys, bp } = listOfBoth();
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20);
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20);
  assert.equal(bp.stops(), 1);
});

test("losing the EOM connection stops every toy", async () => {
  const both = listOfBoth();
  await both.toys.eomConnected(true);
  await both.toys.eomConnected(false);
  await assertAllStopped(both);
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
  toys.remove(a.toy.key);
  await toys.stopAll();
  assert.deepEqual(a.calls, []);
});

test("a toy is sent exactly the toy level a reading puts it at, whatever its level count", async () => {
  const wrong: string[] = [];
  for (let levels = 1; levels <= 120; levels++) {
    for (let level = 0; level <= levels; level++) {
      const t = fakeToy({ Vibrate: { Value: [0, levels] } });
      const control: ButtplugToyControl = { type: "Vibrate", mode: "denied", feature: t.feature };
      buttplugToy({ name: "Toy", controls: [control], stop: async () => {} }).follow({ motor: 0, arousal: 0, pressure: 0, denied: level }, levels);
      await settle();
      const value = t.outputs()[0]?.Vibrate.Value;
      if (value !== level) wrong.push(`${level} of ${levels} sent as ${value}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("a safety stop still reported after the EOM reconnects doesn't stop toys again", async () => {
  const { toys, bp } = listOfBoth();
  await toys.eomConnected(true);
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20);
  await toys.eomConnected(false);
  await toys.eomConnected(true);
  await toys.follow({ ...PLEASURE_FULL, safety: 3 }, 20);
  assert.equal(bp.stops(), 2);
});

test("a toy removed from the list gets nothing still waiting to be sent", async () => {
  const toys = new ToyList();
  const t = fakeToy({ Vibrate: { Value: [0, 20] } });
  const control: ButtplugToyControl = { type: "Vibrate", mode: "manual", feature: t.feature };
  const handle = { name: "Toy", messageTimingGap: 20, controls: [control], stop: async () => {} };
  const toy = buttplugToy(handle);
  toys.add(toy);
  toy.setByHand(control, 0.5);
  toy.setByHand(control, 1);
  toys.remove(handle);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(t.outputs().length, 1);
});
