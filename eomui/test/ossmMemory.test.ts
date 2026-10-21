// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyMemory } from "../src/lib/toyMemory.ts";
import { rememberOssmControl, restoreOssmControls } from "../src/lib/ossmMemory.ts";
import { ossmControls, type OssmHandle } from "../src/lib/ossmControls.ts";

// Saved preferences on this phone or browser, kept across reconnects (and new ToyMemorys).
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

// A newly connected OSSM, recording the writes queued for it.
function fakeOssm(name = "OSSM") {
  const writes: [string, number][] = [];
  const ossm: OssmHandle = {
    name,
    controls: ossmControls(),
    setControl: (control, value) => void writes.push([control, value]),
    stop: async () => {},
    cancel: () => {},
  };
  return { ossm, writes };
}

const settings = (ossm: OssmHandle, name: string) => {
  const c = ossm.controls[name];
  return { limitMin: c.limitMin, limitMax: c.limitMax, inverted: c.inverted };
};

test("a reconnected OSSM gets back the range and invert last set", () => {
  const storage = fakeStorage();
  const { ossm: before } = fakeOssm();
  before.controls.speed.limitMin = 20;
  before.controls.speed.limitMax = 70;
  before.controls.speed.inverted = true;
  rememberOssmControl(new ToyMemory(storage), before.name, "speed", before.controls.speed);

  const { ossm: after } = fakeOssm();
  restoreOssmControls(new ToyMemory(storage), after);
  assert.deepEqual(settings(after, "speed"), { limitMin: 20, limitMax: 70, inverted: true });
});

test("each control, and each OSSM name, keeps its own settings", () => {
  const storage = fakeStorage();
  const memory = new ToyMemory(storage);
  const { ossm } = fakeOssm("OSSM");
  ossm.controls.speed.limitMax = 60;
  ossm.controls.stroke.limitMin = 30;
  ossm.controls.stroke.inverted = true;
  rememberOssmControl(memory, "OSSM", "speed", ossm.controls.speed);
  rememberOssmControl(memory, "OSSM", "stroke", ossm.controls.stroke);

  const { ossm: same } = fakeOssm("OSSM");
  const { ossm: other } = fakeOssm("OSSM 2");
  restoreOssmControls(new ToyMemory(storage), same);
  restoreOssmControls(new ToyMemory(storage), other);
  assert.deepEqual(settings(same, "speed"), { limitMin: 0, limitMax: 60, inverted: false });
  assert.deepEqual(settings(same, "stroke"), { limitMin: 30, limitMax: 100, inverted: true });
  assert.deepEqual(settings(same, "depth"), { limitMin: 0, limitMax: 100, inverted: false });
  assert.deepEqual(settings(other, "speed"), { limitMin: 0, limitMax: 100, inverted: false });
});

test("every control starts on Manual after connecting, whatever it followed before", () => {
  const storage = fakeStorage();
  const { ossm: before } = fakeOssm();
  before.controls.speed.mode = "arousal";
  rememberOssmControl(new ToyMemory(storage), before.name, "speed", before.controls.speed);

  const { ossm: after } = fakeOssm();
  for (const control of Object.values(after.controls)) control.mode = "pleasure";
  restoreOssmControls(new ToyMemory(storage), after);
  assert.deepEqual(Object.values(after.controls).map((c) => c.mode), ["manual", "manual", "manual", "manual", "manual"]);
});

test("a value outside the restored range is moved into it through the OSSM's writes", () => {
  const storage = fakeStorage();
  const memory = new ToyMemory(storage);
  const { ossm: before } = fakeOssm();
  before.controls.stroke.limitMin = 60; // stroke starts at 50
  before.controls.depth.limitMax = 5; // depth starts at 10
  before.controls.sensation.limitMin = 40; // sensation starts at 50: inside, left alone
  for (const name of ["stroke", "depth", "sensation"]) rememberOssmControl(memory, before.name, name, before.controls[name]);

  const { ossm: after, writes } = fakeOssm();
  restoreOssmControls(new ToyMemory(storage), after);
  assert.deepEqual(writes, [["stroke", 60], ["depth", 5]]);
});

test("connecting never changes an OSSM's speed, even outside the restored range", () => {
  const storage = fakeStorage();
  const memory = new ToyMemory(storage);
  const { ossm: before } = fakeOssm();
  before.controls.speed.limitMin = 20;
  before.controls.speed.limitMax = 70;
  rememberOssmControl(memory, before.name, "speed", before.controls.speed);

  const { ossm: paused, writes: pausedWrites } = fakeOssm(); // speed 0
  restoreOssmControls(new ToyMemory(storage), paused);
  assert.deepEqual(pausedWrites, []);

  const { ossm: fast, writes: fastWrites } = fakeOssm();
  fast.controls.speed.value = 90;
  restoreOssmControls(new ToyMemory(storage), fast);
  assert.deepEqual(fastWrites, []);
  assert.equal(fast.controls.speed.value, 90);
});

test("pattern's range isn't remembered, as it follows the patterns the OSSM has", () => {
  const storage = fakeStorage();
  const { ossm: before } = fakeOssm();
  before.controls.pattern.limitMin = 2;
  before.controls.pattern.limitMax = 3;
  rememberOssmControl(new ToyMemory(storage), before.name, "pattern", before.controls.pattern);

  const { ossm: after, writes } = fakeOssm();
  restoreOssmControls(new ToyMemory(storage), after);
  assert.deepEqual(settings(after, "pattern"), { limitMin: 0, limitMax: 6, inverted: false });
  assert.deepEqual(writes, []);
});
