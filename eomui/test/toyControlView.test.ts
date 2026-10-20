// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRangeEnd, toyControlHelp, toyLevelPercent } from "../src/lib/toyControlView.ts";

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

// The value pill shows the toy level the toy is at, so it snaps to the toy's own levels.
test("the live level is the toy level the slider puts the toy at, in %", () => {
  const full = { mode: "manual", min: 0, max: 255 };
  assert.equal(toyLevelPercent(full, 128, 20), 50);
  assert.equal(toyLevelPercent(full, 140, 20), 55); // 0.549 of 20 levels is level 11
  assert.equal(toyLevelPercent({ ...full, min: 51, max: 204 }, 255, 20), 80);
  assert.equal(toyLevelPercent({ ...full, invert: true }, 0, 20), 100);
  assert.equal(toyLevelPercent(full, 77), 30); // a toy that doesn't say how many levels it has
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
