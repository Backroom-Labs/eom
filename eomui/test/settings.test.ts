// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportedSettings } from "../src/lib/settings.ts";

test("reportedSettings hides settings the device's config didn't include and keeps the rest in order", () => {
  const reported = new Set(["edge_delay", "max_pleasure", "something_new"]);
  assert.deepEqual(reportedSettings(["max_pleasure", "arousal_memory_s", "edge_delay"], reported), ["max_pleasure", "edge_delay"]);
});

test("reportedSettings keeps every setting before any config has arrived", () => {
  assert.deepEqual(reportedSettings(["max_pleasure", "edge_delay"], null), ["max_pleasure", "edge_delay"]);
});
