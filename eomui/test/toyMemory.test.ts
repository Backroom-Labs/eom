// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyMemory } from "../src/lib/toyMemory.ts";
import type { ToyControl } from "../src/lib/toyOutput.ts";

// Saved preferences on this phone or browser, kept across reconnects (and new ToyMemorys).
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

type Control = ToyControl & { type: string; index: number };
const vibrator = (): Control => ({ type: "Vibrate", index: 0, mode: "manual", invert: false, min: 0, max: 255 });

test("a reconnected toy gets back the range and invert last set", () => {
  const storage = fakeStorage();
  const before = vibrator();
  before.min = 40;
  before.max = 200;
  before.invert = true;
  new ToyMemory(storage).save("Domi", before);

  const after = vibrator();
  new ToyMemory(storage).restore("Domi", [after]);
  assert.deepEqual({ min: after.min, max: after.max, invert: after.invert }, { min: 40, max: 200, invert: true });
});

test("another toy, or another toy control type on the same toy, keeps its own settings", () => {
  const storage = fakeStorage();
  const memory = new ToyMemory(storage);
  memory.save("Domi", { ...vibrator(), min: 40, invert: true });
  memory.save("Lush", { ...vibrator(), max: 100 });
  memory.save("Domi", { type: "Rotate", index: 1, min: 10, max: 20, invert: false });

  const domi = [vibrator(), { type: "Rotate", index: 1 } as Control];
  const lush = [vibrator()];
  const edge = [vibrator()];
  const later = new ToyMemory(storage);
  later.restore("Domi", domi);
  later.restore("Lush", lush);
  later.restore("Edge", edge);
  const settings = (c: Control) => [c.min, c.max, c.invert];
  assert.deepEqual(domi.map(settings), [[40, 255, true], [10, 20, false]]);
  assert.deepEqual(lush.map(settings), [[0, 100, false]]);
  assert.deepEqual(edge.map(settings), [[0, 255, false]], "never saved: left as it was");
});

test("a toy control saved while following comes back on Manual, so the toy doesn't start moving", () => {
  const storage = fakeStorage();
  new ToyMemory(storage).save("Domi", { ...vibrator(), mode: "arousal", min: 40 });
  const after: Control = { ...vibrator(), mode: undefined };
  new ToyMemory(storage).restore("Domi", [after]);
  assert.equal(after.mode, "manual");
  assert.equal(after.min, 40);
});

test("with no saved preferences to use, toys still connect at full range on Manual", () => {
  const blocked = () => { throw new Error("blocked"); };
  const memory = new ToyMemory({ getItem: blocked, setItem: blocked });
  memory.save("Domi", { ...vibrator(), min: 40 });
  const after = vibrator();
  memory.restore("Domi", [after]);
  new ToyMemory(undefined).restore("Domi", [after]);
  assert.deepEqual([after.min, after.max, after.invert, after.mode], [0, 255, false, "manual"]);
});
