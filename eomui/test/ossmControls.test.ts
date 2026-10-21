// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ossmControls, ossmStateValues, sliderPercent, strokerPartner } from "../src/lib/ossmControls.ts";

test("a value's place along a slider, in %", () => {
  assert.equal(sliderPercent(25, 0, 100), 25);
  assert.equal(sliderPercent(3, 0, 6), 50);
});

test("a slider with one value, like the pattern slider with only Simple Stroke, puts it at the start", () => {
  assert.equal(sliderPercent(0, 0, 0), 0);
});

test("in stroker mode, depth and stroke each set the other, keeping the stroke centred", () => {
  const controls = ossmControls();
  assert.deepEqual(strokerPartner("depth", 75, controls), ["stroke", 50]);
  assert.deepEqual(strokerPartner("stroke", 40, controls), ["depth", 70]);
  assert.equal(strokerPartner("speed", 40, controls), undefined);
});

test("in stroker mode, the value set for the other control stays inside its range", () => {
  const controls = ossmControls();
  controls.stroke.limitMin = 10;
  controls.stroke.limitMax = 40;
  controls.depth.limitMax = 60;
  assert.deepEqual(strokerPartner("depth", 75, controls), ["stroke", 40]); // 50, above stroke's range
  assert.deepEqual(strokerPartner("depth", 52, controls), ["stroke", 10]); // 4, below it
  assert.deepEqual(strokerPartner("stroke", 40, controls), ["depth", 60]); // 70, above depth's
});

const PATTERNS = [{ name: "Simple Stroke", idx: 0 }, { name: "Deeper", idx: 4 }, { name: "Knot", idx: 10 }];

test("the state an OSSM reports gives each control's value", () => {
  const state = { state: "strokeEngine", speed: 30, stroke: 60, depth: 20, sensation: 50, pattern: 0 };
  assert.deepEqual(ossmStateValues(state, PATTERNS), { speed: 30, stroke: 60, depth: 20, sensation: 50, pattern: 0 });
});

test("the reported pattern is found by its idx, as the pattern control counts patterns in the list", () => {
  assert.deepEqual(ossmStateValues({ pattern: 10 }, PATTERNS), { pattern: 2 });
  assert.deepEqual(ossmStateValues({ pattern: 7 }, PATTERNS), {});
});

test("anything in the state that isn't a control's value is left out", () => {
  assert.deepEqual(ossmStateValues({ speed: "fast", stroke: null, depth: 40, other: 3 }, PATTERNS), { depth: 40 });
  assert.deepEqual(ossmStateValues(null, PATTERNS), {});
  assert.deepEqual(ossmStateValues("garbled", PATTERNS), {});
});
