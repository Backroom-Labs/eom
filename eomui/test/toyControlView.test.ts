// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { minThumbOnTop, readToyBattery, setRangeEnd, toyControlHelp, toyLevelPercent } from "../src/lib/toyControlView.ts";

test("help text says what a following toy control follows and its range", () => {
  assert.equal(toyControlHelp({ mode: "pleasure", min: 51, max: 204 }), "Follows pleasure between 20% and 80%.");
  assert.equal(toyControlHelp({ mode: "denied", min: 0, max: 255 }), "Follows denials between 0% and 100%.");
});

test("help text for a Manual toy control says it's set by hand", () => {
  assert.equal(toyControlHelp({ mode: "manual", min: 0, max: 128 }), "Set by hand between 0% and 50%.");
});

// Inverted, the toy gets 1 - level within the range, so a 0-50% range runs it from 100% down to 50%.
test("help text for an inverted toy control gives the levels the toy really gets", () => {
  assert.equal(toyControlHelp({ mode: "arousal", min: 0, max: 128, invert: true }), "Follows arousal inverted, from 100% down to 50%.");
  assert.equal(toyControlHelp({ mode: "manual", min: 51, max: 255, invert: true }), "Set by hand inverted, from 80% down to 0%.");
});

// The value pill shows the toy level the toy was last set to, so it snaps to the toy's own levels.
test("the value pill shows the toy level the toy was set to, in %", () => {
  assert.equal(toyLevelPercent({ toyLevel: 10, levels: 20 }), 50);
  assert.equal(toyLevelPercent({ toyLevel: 11, levels: 20 }), 55);
  assert.equal(toyLevelPercent({ toyLevel: 30 }), 30); // a toy that doesn't say how many levels it has
});

// Inverted, slider 0 means 100%, but until something is sent the toy is still off.
test("a toy control that hasn't sent anything shows 0%", () => {
  assert.equal(toyLevelPercent({ mode: "manual", invert: true, levels: 20 }), 0);
});

test("moving one end of the range sets it", () => {
  const control = { min: 0, max: 255 };
  setRangeEnd(control, "min", 51);
  setRangeEnd(control, "max", 204);
  assert.deepEqual(control, { min: 51, max: 204 });
});

test("the two ends of the range can't cross", () => {
  const control = { min: 100, max: 150 };
  assert.equal(setRangeEnd(control, "min", 200), 150);
  assert.equal(setRangeEnd(control, "max", 20), 150);
  assert.deepEqual(control, { min: 150, max: 150 });
});

// The range thumbs sit on one track, so only the top one can be grabbed where they meet. It's
// the one with room to move outward.
test("the range's min thumb is on top only when it has more room to move than the max thumb", () => {
  assert.equal(minThumbOnTop({ min: 0, max: 0 }), false);
  assert.equal(minThumbOnTop({ min: 255, max: 255 }), true);
  assert.equal(minThumbOnTop({ min: 200, max: 200 }), true);
  assert.equal(minThumbOnTop({ min: 60, max: 60 }), false);
  assert.equal(minThumbOnTop({ min: 100, max: 240 }), true); // 100 below, 15 above
  assert.equal(minThumbOnTop({ min: 20, max: 100 }), false);
});

// A toy whose battery read waits until done() is called.
function batteryToy(level = 0.8) {
  let done = () => {};
  let reads = 0;
  const toy = {
    name: "Domi",
    hasInput: () => true,
    battery: () => {
      reads++;
      return new Promise<number>((resolve) => { done = () => resolve(level); });
    },
  };
  return { toy, done: () => done(), reads: () => reads };
}

// Buttplug v5 reports the battery as a whole % (0-100), not a 0-1 fraction.
test("a toy's battery is read as the % the toy reports", async () => {
  const t = batteryToy(92);
  const read = readToyBattery(t.toy, () => true);
  t.done();
  assert.equal(await read, 92);
});

test("a battery reading outside 0-100 is kept within it", async () => {
  for (const [raw, want] of [[140, 100], [-5, 0]]) {
    const t = batteryToy(raw);
    const read = readToyBattery(t.toy, () => true);
    t.done();
    assert.equal(await read, want);
  }
});

test("a toy that's no longer connected isn't asked for its battery", async () => {
  const t = batteryToy();
  assert.equal(await readToyBattery(t.toy, () => false), undefined);
  assert.equal(t.reads(), 0);
});

test("a battery read that finishes after its toy went away gives nothing", async () => {
  const t = batteryToy();
  let connected = true;
  const read = readToyBattery(t.toy, () => connected);
  connected = false;
  t.done();
  assert.equal(await read, undefined);
});
