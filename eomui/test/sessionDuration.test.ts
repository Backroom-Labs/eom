// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../src/lib/history.ts";

const ms = (h: number, m: number, s: number) => ((h * 60 + m) * 60 + s) * 1000;

test("a session shorter than a minute shows seconds", () => {
  assert.equal(formatDuration(ms(0, 0, 12.4)), "12s");
});

test("seconds that round up to a minute roll over", () => {
  assert.equal(formatDuration(ms(0, 0, 59.6)), "1m 0s");
  assert.equal(formatDuration(ms(0, 17, 59.8)), "18m 0s");
});

test("minutes that round up to an hour roll over", () => {
  assert.equal(formatDuration(ms(0, 59, 59.7)), "1h 0m");
});

test("no duration shows 60 seconds or 60 minutes", () => {
  for (let t = 0; t < ms(3, 0, 0); t += 100) {
    assert.doesNotMatch(formatDuration(t), /\b60[ms]/, `${t} ms`);
  }
});
