// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readOssmPatterns } from "../src/lib/ossmPatterns.ts";

const reply = (text: string) => async () => new DataView(new TextEncoder().encode(text).buffer);

test("an OSSM's patterns are read from its pattern list", async () => {
  const patterns = await readOssmPatterns(reply('[{"name":"Simple Stroke","idx":0},{"name":"Deeper","idx":4}]'));
  assert.deepEqual(patterns, [{ name: "Simple Stroke", idx: 0 }, { name: "Deeper", idx: 4 }]);
});

test("patterns without an idx are numbered in order", async () => {
  const patterns = await readOssmPatterns(reply('[{"name":"Simple Stroke"},{"name":"Teasing Pounding"}]'));
  assert.deepEqual(patterns, [{ name: "Simple Stroke", idx: 0 }, { name: "Teasing Pounding", idx: 1 }]);
});

test("an OSSM whose patterns can't be read gets Simple Stroke alone", async () => {
  const patterns = await readOssmPatterns(async () => { throw new Error("GATT operation failed"); });
  assert.deepEqual(patterns, [{ name: "Simple Stroke", idx: 0 }]);
});

test("an OSSM whose pattern list is garbled or empty gets Simple Stroke alone", async () => {
  assert.deepEqual(await readOssmPatterns(reply("not json")), [{ name: "Simple Stroke", idx: 0 }]);
  assert.deepEqual(await readOssmPatterns(reply("[]")), [{ name: "Simple Stroke", idx: 0 }]);
  assert.deepEqual(await readOssmPatterns(reply("{}")), [{ name: "Simple Stroke", idx: 0 }]);
});
