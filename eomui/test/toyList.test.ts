// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyList, buttplugToy, ossmToy, ossmControls, type Toy, type ButtplugToyControl } from "../src/lib/toyList.ts";
import { type ToyReading } from "../src/lib/toyOutput.ts";
import { fakeToy, settle } from "./fakeToy.ts";
import { setRangeEnd, toyControlChanged } from "../src/lib/toyControlView.ts";

// A toy that records what the list asks of it.
function recordingToy() {
  const calls: string[] = [];
  const toy: Toy = {
    key: {},
    status: () => ({ name: "Toy", strength: 0, follows: [] }),
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

test("an OSSM never follows with its pattern or sensation, even if they're set to follow", () => {
  const { ossm, writes } = fakeOssm();
  ossm.controls.pattern = { value: 0, min: 0, max: 10, mode: "pleasure" };
  ossm.controls.sensation = { value: 50, min: 0, max: 100, mode: "arousal" };
  const toy = ossmToy(ossm);
  toy.follow(PLEASURE_FULL, 20);
  assert.deepEqual(writes.map(([name]) => name), ["speed", "stroke"]);
  assert.deepEqual(toy.status().follows, ["pleasure", "arousal"]);
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

test("a newly connected OSSM has speed, stroke, depth, pattern and sensation all on Manual", () => {
  const controls = ossmControls();
  assert.deepEqual(
    Object.entries(controls).map(([name, c]) => [name, c.mode]),
    [["speed", "manual"], ["stroke", "manual"], ["depth", "manual"], ["pattern", "manual"], ["sensation", "manual"]],
  );
});

test("an OSSM connected mid-session keeps the speed it was already at", async () => {
  const toys = new ToyList();
  toys.add(fakeButtplugToy().toy);
  toys.follow(PLEASURE_FULL, 20);
  const writes: [string, number][] = [];
  const ossm = {
    name: "OSSM",
    controls: ossmControls(),
    async setControl(name: string, value: number) {
      writes.push([name, value]);
      ossm.controls[name].value = value;
    },
  };
  ossm.controls.speed.value = 30; // as read from the OSSM when it connected
  toys.add(ossmToy(ossm));
  await toys.follow(PLEASURE_FULL, 20);
  await settle();
  assert.equal(ossm.controls.speed.value, 30);
  assert.deepEqual(writes, []);
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

test("a stop with toys connected says so, so the user knows they're on Manual", async () => {
  let told = 0;
  const toys = new ToyList(() => told++);
  await toys.stopAll();
  assert.equal(told, 0, "no toys, nothing to say");
  toys.add(recordingToy().toy);
  await toys.stopAll();
  assert.equal(told, 1);
});

test("a Buttplug toy keeps the toy level it set each control to, and 0 after a stop", async () => {
  const t = fakeButtplugToy("manual");
  t.toy.setByHand(t.control, 0.5);
  assert.equal(t.control.toyLevel, 10);
  t.control.mode = "arousal";
  t.toy.follow(AROUSAL_FULL, 20);
  assert.equal(t.control.toyLevel, 20);
  await t.toy.stop();
  assert.equal(t.control.toyLevel, 0);
});

// So the toy and the value pill agree with the new range or invert.
test("changing a Manual control's range or invert sets the toy again from where its slider is", async () => {
  const t = fakeButtplugToy("manual");
  t.toy.setByHand(t.control, 0.5);
  setRangeEnd(t.control, "max", 128);
  toyControlChanged(t.toy, t.control, 128);
  assert.equal(t.control.toyLevel, 5);
  t.control.invert = true;
  toyControlChanged(t.toy, t.control, 128);
  assert.equal(t.control.toyLevel, 15);
  await new Promise((resolve) => setTimeout(resolve, 150)); // past the toy's command gap
  // Paced: 5 was still waiting for the gap when 15 replaced it.
  assert.deepEqual(t.sent().map((c) => c.Vibrate.Value), [10, 15]);
});

test("changing a following control's range leaves it to the next reading", () => {
  const t = fakeButtplugToy("arousal");
  setRangeEnd(t.control, "max", 128);
  toyControlChanged(t.toy, t.control, 0);
  assert.equal(t.control.toyLevel, undefined);
});

// The toy strip on the main screen.

test("the toy strip has nothing when no toy is connected", () => {
  assert.deepEqual(new ToyList().strip(), []);
});

test("the toy strip shows each toy's name, live strength and what its toy controls follow", async () => {
  const { toys, bp, ossm } = listOfBoth();
  assert.deepEqual(toys.strip(), [
    { key: bp.toy.key, name: "Domi", strength: 100, follows: ["arousal"] },
    { key: ossm.ossm, name: "OSSM", strength: 100, follows: ["pleasure", "arousal"] },
  ]);
  await toys.follow(AROUSAL_HALF, 20);
  assert.equal(toys.strip()[0].strength, 50);
});

test("the screen is told when a toy connects or leaves, so the strip shows and hides", () => {
  const toys = new ToyList();
  const shown: string[][] = [];
  toys.onChange(() => shown.push(toys.strip().map((t) => t.name)));
  const a = recordingToy();
  toys.add(a.toy);
  toys.remove(a.toy.key);
  assert.deepEqual(shown, [["Toy"], []]);
});

test("the screen isn't told when a toy that isn't connected leaves", () => {
  const toys = new ToyList();
  let told = 0;
  toys.onChange(() => told++);
  toys.remove({});
  assert.equal(told, 0);
});

// To resume, the user picks what it follows in the Toys drawer.
test("stopping one toy from the strip stops just that toy, and it stays stopped through later readings", async () => {
  const { toys, bp, ossm } = listOfBoth();
  await toys.stop(bp.toy.key);
  assert.equal(bp.stops(), 1);
  const sent = bp.sent().length;
  await toys.follow(PLEASURE_FULL, 20);
  await settle();
  assert.deepEqual(toys.strip().map(({ name, strength, follows }) => ({ name, strength, follows })), [
    { name: "Domi", strength: 0, follows: [] },
    { name: "OSSM", strength: 100, follows: ["pleasure", "arousal"] },
  ]);
  assert.equal(bp.sent().length, sent, "nothing sent after the stop");
  assert.equal(ossm.ossm.controls.stroke.value, 100, "the OSSM still follows");
});
