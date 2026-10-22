// Run from eomui/: node --test test/*.test.ts
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { ToyFollower, toyLevels, commandGapMs, disconnectToy, DEFAULT_MIN, DEFAULT_MAX, type FollowMode, type ToyControl, type ToyReading } from "../src/lib/toyOutput.ts";
import { buttplugToy, type ButtplugToyControl } from "../src/lib/toyList.ts";
import { ButtplugClientDevice } from "buttplug";
import { fakeToy, settle, type FakeOutput } from "./fakeToy.ts";

const READING_MS = 66; // the EOM's WebSocket readings come about 15 times a second
const DOMI_LEVELS = 20; // Lovense vibrate levels
const MAX_COMMANDS_PER_S = 10;
const VIBRATOR: FakeOutput = { Vibrate: { Value: [0, DOMI_LEVELS] } };

const reading = (motor: number, arousal = 0): ToyReading => ({ motor, arousal, pressure: 0, denied: 0 });
const seconds = (s: number) => Math.round((s * 1000) / READING_MS);

// Runs fn with a fake clock (Date.now and setTimeout) starting at 0.
async function withClock(fn: () => Promise<void>) {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  try {
    await fn();
  } finally {
    mock.timers.reset();
  }
}

// Moves the fake clock on 1 ms at a time: a single big tick runs timers with Date.now() already
// at the end of it.
async function tick(ms: number) {
  for (let i = 0; i < ms; i++) mock.timers.tick(1);
  await settle();
}

const newControl = (mode: FollowMode, feature: ButtplugToyControl["feature"], type: ButtplugToyControl["type"] = "Vibrate"): ButtplugToyControl =>
  ({ type, mode, invert: false, min: DEFAULT_MIN, max: DEFAULT_MAX, feature });

type Sent = { t: number; level: number };

// A Buttplug toy with one or more controls following readings, one reading every READING_MS.
// Returns the commands that reached the toy.
async function run(mode: FollowMode, readings: ToyReading[], gapMs?: number, controls = 1): Promise<Sent[]> {
  const t = fakeToy(VIBRATOR, gapMs);
  const list = Array.from({ length: controls }, () => newControl(mode, t.feature));
  const toy = buttplugToy({ ...wrap(t.toy), controls: list });
  for (const r of readings) {
    toy.follow(r, 20);
    await tick(READING_MS);
  }
  await tick(1000);
  return t.wire.filter((w) => w.msg.OutputCmd).map((w) => ({ t: w.at, level: (w.msg.OutputCmd!.Command as any).Vibrate.Value }));
}

// The client toy as buttplugToy takes it.
const wrap = (toy: ButtplugClientDevice) => ({
  name: toy.name,
  messageTimingGap: toy.messageTimingGap,
  stop: () => toy.stop(),
});

// A ramp from 0 to full over 120 s, an edge stop, then full motor.
function rampSession(): ToyReading[] {
  const out: ToyReading[] = [];
  for (let i = 0; i < seconds(120); i++) out.push(reading(Math.floor((i / seconds(120)) * 255)));
  for (let i = 0; i < seconds(2); i++) out.push(reading(0));
  for (let i = 0; i < seconds(2); i++) out.push(reading(255));
  return out;
}

// Arousal wobbling around the middle, like a real sensor.
function noisyArousal(): ToyReading[] {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: ToyReading[] = [];
  for (let i = 0; i < seconds(10); i++) out.push(reading(0, 2048 + (rand() - 0.5) * 1200));
  return out;
}

function maxPerSecond(sent: Sent[]): number {
  let worst = 0;
  for (let i = 0; i < sent.length; i++) {
    let n = 0;
    while (i + n < sent.length && sent[i + n].t - sent[i].t < 1000) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

function minGap(sent: { t: number }[]): number {
  let gap = Infinity;
  for (let i = 1; i < sent.length; i++) gap = Math.min(gap, sent[i].t - sent[i - 1].t);
  return gap;
}

const repeats = (sent: Sent[]) => sent.filter((s, i) => i > 0 && s.level === sent[i - 1].level);

test("full motor drives the toy at its top level", () => withClock(async () => {
  const all = await run("pleasure", rampSession());
  assert.equal(all.at(-1)!.level, DOMI_LEVELS);
}));

test("the toy is sent 0 promptly when the motor stops for an edge", () => withClock(async () => {
  const stopAt = seconds(120) * READING_MS;
  const all = await run("pleasure", rampSession());
  const zero = all.find((s) => s.t >= stopAt && s.level === 0);
  assert.ok(zero && zero.t - stopAt <= 200, `stop sent at ${zero?.t}`);
}));

test("following the ramp, every command changes the toy's level", () => withClock(async () => {
  const all = await run("pleasure", rampSession());
  assert.equal(repeats(all).length, 0, `${repeats(all).length} of ${all.length} commands left the level unchanged`);
}));

test("following noisy arousal, the toy gets at most 10 commands a second", () => withClock(async () => {
  const all = await run("arousal", noisyArousal());
  assert.ok(maxPerSecond(all) <= MAX_COMMANDS_PER_S, `${maxPerSecond(all)} commands in one second`);
}));

test("a toy that reports a 250 ms gap never gets commands closer together than that", () => withClock(async () => {
  const all = await run("arousal", noisyArousal(), 250);
  assert.ok(all.length > 1);
  assert.ok(minGap(all) >= 250, `commands ${minGap(all)} ms apart`);
}));

test("a toy's gap holds across all its controls together", () => withClock(async () => {
  const all = await run("arousal", noisyArousal(), 250, 3);
  assert.ok(all.length > 3);
  assert.ok(minGap(all) >= 250, `commands ${minGap(all)} ms apart`);
}));

test("with a reported gap, the toy is still sent only level changes, and ends at the last one", () => withClock(async () => {
  const all = await run("pleasure", rampSession(), 250);
  assert.equal(repeats(all).length, 0, `${repeats(all).length} of ${all.length} commands left the level unchanged`);
  assert.equal(all.at(-1)!.level, DOMI_LEVELS);
}));

test("an inverted control runs full when the motor is off and stops at full motor", () => {
  const follower = new ToyFollower({ mode: "pleasure", invert: true }, DOMI_LEVELS);
  assert.equal(follower.onReading(reading(0), 20), DOMI_LEVELS);
  assert.equal(follower.onReading(reading(255), 20), 0);
});

test("a control on Manual doesn't follow readings", () => {
  const follower = new ToyFollower({ mode: "manual" } as ToyControl, DOMI_LEVELS);
  assert.equal(follower.onReading(reading(255), 20), null);
});

test("a toy's command gap is the timing gap Buttplug reports for it", () => {
  const { toy } = fakeToy(VIBRATOR, 250);
  assert.equal(commandGapMs(toy), 250);
});

test("a toy that reports no timing gap gets 100 ms between commands", () => withClock(async () => {
  const { toy } = fakeToy(VIBRATOR);
  assert.equal(commandGapMs(toy), 100);
  const all = await run("arousal", noisyArousal());
  assert.ok(minGap(all) >= 100, `commands ${minGap(all)} ms apart`);
}));

test("a slider moved faster than the toy's gap still delivers its last position", () => withClock(async () => {
  const t = fakeToy(VIBRATOR, 250);
  const control = newControl("manual", t.feature);
  const toy = buttplugToy({ ...wrap(t.toy), controls: [control] });
  toy.setByHand(control, 0.1);
  await tick(10);
  toy.setByHand(control, 0.5);
  await tick(10);
  toy.setByHand(control, 1);
  await tick(1000);
  assert.deepEqual(t.wire.map((w) => [w.at, (w.msg.OutputCmd!.Command as any).Vibrate.Value]), [[0, 2], [250, 20]]);
}));

test("the slider and following share the toy's gap", () => withClock(async () => {
  const t = fakeToy(VIBRATOR, 250);
  const following = newControl("pleasure", t.feature);
  const byHand = newControl("manual", t.feature);
  const toy = buttplugToy({ ...wrap(t.toy), controls: [following, byHand] });
  toy.follow(reading(255), 20);
  await tick(50);
  toy.setByHand(byHand, 0.5);
  await tick(1000);
  assert.deepEqual(t.wire.map((w) => w.at), [0, 250]);
}));

test("stop reaches the toy at once, inside the gap, and drops commands still waiting", () => withClock(async () => {
  const t = fakeToy(VIBRATOR, 250);
  const control = newControl("manual", t.feature);
  const toy = buttplugToy({ ...wrap(t.toy), controls: [control] });
  toy.setByHand(control, 0.5);
  await tick(10);
  toy.setByHand(control, 1);
  await tick(10);
  await toy.stop();
  await tick(1000);
  assert.deepEqual(t.wire.map((w) => [w.at, w.msg.StopCmd ? "stop" : "output"]), [[0, "output"], [20, "stop"]]);
}));

test("a slider set back to where the toy already is sends nothing", () => withClock(async () => {
  const t = fakeToy(VIBRATOR, 250);
  const control = newControl("manual", t.feature);
  const toy = buttplugToy({ ...wrap(t.toy), controls: [control] });
  toy.setByHand(control, 0.5);
  await tick(10);
  toy.setByHand(control, 1);
  await tick(10);
  toy.setByHand(control, 0.5);
  await tick(1000);
  assert.equal(t.wire.length, 1);
}));

test("a stroker moves over the toy's command gap", () => withClock(async () => {
  const t = fakeToy({ HwPositionWithDuration: { Value: [0, 100], Duration: [0, 10000] } }, 250);
  const control = newControl("manual", t.feature, "HwPositionWithDuration");
  buttplugToy({ ...wrap(t.toy), controls: [control] }).setByHand(control, 0.25);
  await settle();
  assert.deepEqual(t.outputs(), [{ HwPositionWithDuration: { Value: 25, Duration: 250 } }]);
}));

test("a stroker's move time is kept within the durations it reports", () => withClock(async () => {
  const t = fakeToy({ HwPositionWithDuration: { Value: [0, 100], Duration: [300, 10000] } });
  const control = newControl("manual", t.feature, "HwPositionWithDuration");
  buttplugToy({ ...wrap(t.toy), controls: [control] }).setByHand(control, 0.25);
  await settle();
  assert.deepEqual(t.outputs(), [{ HwPositionWithDuration: { Value: 25, Duration: 300 } }]);
}));

test("a toy whose levels don't start at 0 is sent the value for the level", () => withClock(async () => {
  const t = fakeToy({ Vibrate: { Value: [5, 25] } });
  const control = newControl("manual", t.feature);
  buttplugToy({ ...wrap(t.toy), controls: [control] }).setByHand(control, 1);
  await settle();
  assert.deepEqual(t.outputs(), [{ Vibrate: { Value: 25, Duration: undefined } }]);
}));

test("a control Buttplug can't set fails quietly, without throwing", () => withClock(async () => {
  const t = fakeToy(VIBRATOR);
  const control = newControl("manual", t.feature, "Rotate");
  const toy = buttplugToy({ ...wrap(t.toy), controls: [control] });
  assert.doesNotThrow(() => toy.setByHand(control, 0.5));
  await settle();
  assert.equal(t.wire.length, 0);
}));

test("disconnecting a toy stops it through Buttplug", async () => {
  const { toy, sent } = fakeToy(VIBRATOR);
  await disconnectToy(toy);
  assert.deepEqual(sent().map((m) => m.StopCmd), [{ Id: 1, DeviceIndex: 3, FeatureIndex: undefined, Inputs: true, Outputs: true }]);
});

test("a toy that can't be reached still disconnects", async () => {
  const toy = ButtplugClientDevice.fromMsg(
    { DeviceIndex: 3, DeviceName: "Toy", DeviceFeatures: {} },
    async () => { throw new Error("GATT Server is disconnected"); },
  );
  let removed = false;
  toy.on("deviceremoved", () => (removed = true));
  await disconnectToy(toy);
  assert.ok(removed);
});

test("a toy control's level count comes from the output range Buttplug reports", () => {
  const { feature } = fakeToy(VIBRATOR);
  assert.equal(toyLevels(feature, "Vibrate"), DOMI_LEVELS);
});

test("a toy control Buttplug reports no range for has no level count", () => {
  const { feature } = fakeToy(VIBRATOR);
  assert.equal(toyLevels(feature, "Rotate"), undefined);
});
