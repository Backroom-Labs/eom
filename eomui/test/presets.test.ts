// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Presets, settingsToLoad } from "../src/lib/presets.ts";
import { defaultConfig, SETTING_GROUPS } from "../src/lib/settings.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

test("a preset holds the session settings and none of the safety, connectivity or advanced ones", () => {
  const presets = new Presets(fakeStorage());
  presets.save("Long tease", defaultConfig(), null);
  const keys = Object.keys(presets.get("Long tease")!);

  for (const key of ["vibration_mode", "max_pleasure", "sensitivity_threshold", "auto_baseline", "hr_orgasm_drop_bpm"]) {
    assert.ok(keys.includes(key), `${key} should be saved`);
  }
  for (const key of ["sensor_fault_stop", "max_motor_output", "hr_max_bpm", "wifi_on", "ap_password", "bt_on", "classic_serial", "chart_window_s"]) {
    assert.ok(!keys.includes(key), `${key} shouldn't be saved`);
  }
  // Group-driven, so a setting added to one of these groups later is saved too.
  const groups = ["session", "stimulation", "detection", "clench", "heartrate"];
  const groupKeys = SETTING_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.keys);
  assert.deepEqual([...keys].sort(), [...groupKeys].sort());
});

test("loading a preset sends only the settings that differ from the device's", () => {
  const device = { ...defaultConfig(), max_pleasure: 200, edge_delay: 10 };
  const preset = { max_pleasure: 200, edge_delay: 30, vibration_mode: 3 };
  assert.deepEqual(settingsToLoad(preset, device, null), { edge_delay: 30, vibration_mode: 3 });
});

test("settings added after a preset was saved keep their current value", () => {
  const device = { ...defaultConfig(), hr_edge_bpm: 120 };
  assert.deepEqual(settingsToLoad({ edge_delay: 30 }, device, null), { edge_delay: 30 });
});

test("settings the app no longer knows, or that presets don't cover, are ignored", () => {
  const device = defaultConfig();
  const preset = { edge_delay: 30, retired_setting: 5, max_motor_output: 100, wifi_on: false, chart_window_s: 60 };
  assert.deepEqual(settingsToLoad(preset, device, null), { edge_delay: 30 });
});

test("numbers outside a setting's range are clamped to it", () => {
  const device = { ...defaultConfig(), edge_delay: 10, sensitivity_threshold: 500, motor_ramp_time_s: 255 };
  const preset = { edge_delay: 500, sensitivity_threshold: 2, motor_ramp_time_s: 900 };
  assert.deepEqual(settingsToLoad(preset, device, null), { edge_delay: 120, sensitivity_threshold: 10 });
});

test("a choice that's no longer one of the options is skipped", () => {
  const device = { ...defaultConfig(), vibration_mode: 2, after_orgasm: 1 };
  assert.deepEqual(settingsToLoad({ vibration_mode: 7, after_orgasm: 2 }, device, null), { after_orgasm: 2 });
});

test("saved presets are listed by name and kept on this phone or browser", () => {
  const storage = fakeStorage();
  new Presets(storage).save("Workday quickie", defaultConfig(), null);
  new Presets(storage).save("Long tease", { ...defaultConfig(), edge_delay: 45 }, null);
  const presets = new Presets(storage);
  assert.deepEqual(presets.names(), ["Long tease", "Workday quickie"]);
  assert.equal(presets.get("Long tease")?.edge_delay, 45);
});

test("a deleted preset is gone and the others stay", () => {
  const storage = fakeStorage();
  new Presets(storage).save("Workday quickie", defaultConfig(), null);
  new Presets(storage).save("Long tease", defaultConfig(), null);
  new Presets(storage).delete("Workday quickie");
  assert.deepEqual(new Presets(storage).names(), ["Long tease"]);
});

test("unreadable stored presets count as none", () => {
  for (const stored of ["{not json", "[1,2]", "42", "null", '{"Broken": 5}']) {
    const presets = new Presets(fakeStorage({ "eom.presets": stored }));
    assert.deepEqual(presets.names(), [], stored);
    assert.equal(presets.get("Broken"), undefined, stored);
  }
});

test("a preset saves only the settings the EOM reported, not the app's defaults for the rest", () => {
  const presets = new Presets(fakeStorage());
  const reported = new Set(["edge_delay", "max_pleasure", "wifi_on"]);
  presets.save("Older EOM", { ...defaultConfig(), edge_delay: 45 }, reported);
  assert.deepEqual(presets.get("Older EOM"), { edge_delay: 45, max_pleasure: defaultConfig().max_pleasure });
});

test("loading a preset leaves out settings this EOM didn't report", () => {
  const device = { ...defaultConfig(), edge_delay: 10 };
  const reported = new Set(["edge_delay"]);
  assert.deepEqual(settingsToLoad({ edge_delay: 30, hr_edge_bpm: 140 }, device, reported), { edge_delay: 30 });
});
