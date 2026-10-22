// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportsPressureSim, simPressureToSend } from "../src/lib/pressureSim.ts";

test("firmware that reports the simulator has it", () => {
  assert.equal(reportsPressureSim({ fwVersion: "3.8.0", pressureSim: true }), true);
  assert.equal(reportsPressureSim({ version: "3.8.0", board: "m5stack_atom_echo", pressureSim: true }), true);
});

test("firmware without the field, or with anything but true, has no simulator", () => {
  assert.equal(reportsPressureSim({ fwVersion: "3.7.0" }), false);
  assert.equal(reportsPressureSim({ pressureSim: false }), false);
  assert.equal(reportsPressureSim({ pressureSim: "true" }), false);
  assert.equal(reportsPressureSim(null), false);
  assert.equal(reportsPressureSim(undefined), false);
  assert.equal(reportsPressureSim("info"), false);
});

test("toggle off sends -1, so the EOM reads the real sensor", () => {
  assert.equal(simPressureToSend(true, false, 1500), -1);
});

test("toggle on sends the slider's pressure", () => {
  assert.equal(simPressureToSend(true, true, 1500), 1500);
});

test("nothing is sent to firmware without the simulator, even with the toggle saved on", () => {
  assert.equal(simPressureToSend(false, true, 1500), null);
  assert.equal(simPressureToSend(false, false, 1500), null);
});
