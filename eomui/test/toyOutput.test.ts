// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyFollower, setToyPercent, toyLevels, commandGapMs, disconnectToy, DEFAULT_MIN, DEFAULT_MAX, type ToyControl, type ToyReading } from "../src/lib/toyOutput.ts";
import { ButtplugClientDevice, type ButtplugMessage } from "buttplug";

const READING_HZ = 15; // the EOM's WebSocket readings rate
const DOMI_STEPS = 20; // Lovense vibrate levels
const MAX_COMMANDS_PER_S = 10;

type Sent = { t: number; percent: number };

function run(control: ToyControl, readings: ToyReading[], gapMs?: number): Sent[] {
  const follower = new ToyFollower(control, DOMI_STEPS, gapMs);
  const sent: Sent[] = [];
  readings.forEach((r, i) => {
    const t = (i * 1000) / READING_HZ;
    const percent = follower.onReading(r, 20, t);
    if (percent !== null) sent.push({ t, percent });
  });
  return sent;
}

const reading = (motor: number, arousal = 0): ToyReading => ({ motor, arousal, pressure: 0, denied: 0 });
const seconds = (s: number) => Math.round(s * READING_HZ);
const step = (percent: number) => Math.round(percent * DOMI_STEPS);

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

const newControl = (mode: string): ToyControl => ({ mode, invert: false, min: DEFAULT_MIN, max: DEFAULT_MAX });

function maxPerSecond(sent: Sent[]): number {
  let worst = 0;
  for (let i = 0; i < sent.length; i++) {
    let n = 0;
    while (i + n < sent.length && sent[i + n].t - sent[i].t < 1000) n++;
    worst = Math.max(worst, n);
  }
  return worst;
}

test("full motor drives the toy at full power", () => {
  const sent = run(newControl("pleasure"), rampSession());
  assert.equal(sent.at(-1)!.percent, 1);
});

test("the toy is sent 0 promptly when the motor stops for an edge", () => {
  const readings = rampSession();
  const stopAt = (seconds(120) * 1000) / READING_HZ;
  const sent = run(newControl("pleasure"), readings);
  const zero = sent.find((s) => s.t >= stopAt && s.percent === 0);
  assert.ok(zero && zero.t - stopAt <= 200, `stop sent at ${zero?.t}`);
});

test("following the ramp, every command changes the toy's level", () => {
  const sent = run(newControl("pleasure"), rampSession());
  const repeats = sent.filter((s, i) => i > 0 && step(s.percent) === step(sent[i - 1].percent));
  assert.equal(repeats.length, 0, `${repeats.length} of ${sent.length} commands left the level unchanged`);
});

test("following noisy arousal, the toy gets at most 10 commands a second", () => {
  const sent = run(newControl("arousal"), noisyArousal());
  assert.ok(maxPerSecond(sent) <= MAX_COMMANDS_PER_S, `${maxPerSecond(sent)} commands in one second`);
});

function minGap(sent: Sent[]): number {
  let gap = Infinity;
  for (let i = 1; i < sent.length; i++) gap = Math.min(gap, sent[i].t - sent[i - 1].t);
  return gap;
}

test("a toy that reports a 250 ms gap never gets commands closer together than that", () => {
  const sent = run(newControl("arousal"), noisyArousal(), 250);
  assert.ok(sent.length > 1);
  assert.ok(minGap(sent) >= 250, `commands ${minGap(sent)} ms apart`);
});

test("with a reported gap, the toy is still sent only level changes", () => {
  const sent = run(newControl("pleasure"), rampSession(), 250);
  const repeats = sent.filter((s, i) => i > 0 && step(s.percent) === step(sent[i - 1].percent));
  assert.equal(repeats.length, 0, `${repeats.length} of ${sent.length} commands left the level unchanged`);
  assert.equal(sent.at(-1)!.percent, 1);
});

test("an inverted control runs full when the motor is off and stops at full motor", () => {
  const control = { ...newControl("pleasure"), invert: true };
  const follower = new ToyFollower(control, DOMI_STEPS);
  assert.equal(follower.onReading(reading(0), 20, 0), 1);
  assert.equal(follower.onReading(reading(255), 20, 1000), 0);
});

// A toy on the real Buttplug client, with the wire to the server replaced by a list of sent messages.
function fakeToy(output: Record<string, { Value: number[]; Duration?: number[] }>, timingGapMs?: number) {
  const sent: ButtplugMessage[] = [];
  const device = ButtplugClientDevice.fromMsg(
    {
      DeviceIndex: 3,
      DeviceName: "Toy",
      DeviceFeatures: { 0: { FeatureIndex: 0, FeatureDescriptor: "", Output: output, Input: {} } },
      DeviceMessageTimingGap: timingGapMs,
    },
    async (msg) => { sent.push(msg); return { Ok: { Id: 1 } }; },
  );
  return { device, feature: device.features.get(0)!, sent };
}

test("a toy's command gap is the timing gap Buttplug reports for it", () => {
  const { device } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } }, 250);
  assert.equal(commandGapMs(device), 250);
});

test("a toy that reports no timing gap gets 100 ms between commands", () => {
  const { device } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  assert.equal(commandGapMs(device), 100);
  const sent = run(newControl("arousal"), noisyArousal(), commandGapMs(device));
  assert.ok(minGap(sent) >= 100, `commands ${minGap(sent)} ms apart`);
});

test("a stroker moves over the toy's command gap", async () => {
  const { feature, sent } = fakeToy({ HwPositionWithDuration: { Value: [0, 100], Duration: [0, 10000] } }, 250);
  await setToyPercent(feature, "HwPositionWithDuration", 0.25, 250);
  assert.deepEqual(sent.map((m) => m.OutputCmd?.Command), [{ HwPositionWithDuration: { Value: 25, Duration: 250 } }]);
});

test("a vibrator control is set through Buttplug as a percent", async () => {
  const { feature, sent } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  await setToyPercent(feature, "Vibrate", 0.45);
  assert.deepEqual(sent.map((m) => m.OutputCmd?.Command), [{ Vibrate: { Value: 9, Duration: undefined } }]);
});

test("a stroker control is moved through Buttplug to a percent position", async () => {
  const { feature, sent } = fakeToy({ HwPositionWithDuration: { Value: [0, 100], Duration: [0, 10000] } });
  await setToyPercent(feature, "HwPositionWithDuration", 0.25);
  assert.deepEqual(sent.map((m) => m.OutputCmd?.Command), [{ HwPositionWithDuration: { Value: 25, Duration: 100 } }]);
});

test("disconnecting a toy stops it through Buttplug", async () => {
  const { device, sent } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  await disconnectToy(device);
  assert.deepEqual(sent.map((m) => m.StopCmd), [{ Id: 1, DeviceIndex: 3, FeatureIndex: undefined, Inputs: true, Outputs: true }]);
});

test("a toy that can't be reached still disconnects", async () => {
  const device = ButtplugClientDevice.fromMsg(
    { DeviceIndex: 3, DeviceName: "Toy", DeviceFeatures: {} },
    async () => { throw new Error("GATT Server is disconnected"); },
  );
  let removed = false;
  device.on("deviceremoved", () => (removed = true));
  await disconnectToy(device);
  assert.ok(removed);
});

test("an output Buttplug can't set fails as a rejected promise, so callers can catch it", async () => {
  const { feature, sent } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  let call: Promise<void> | undefined;
  assert.doesNotThrow(() => { call = setToyPercent(feature, "Rotate", 0.5); });
  await assert.rejects(call!);
  assert.equal(sent.length, 0);
});

test("a toy control's level count comes from the output range Buttplug reports", () => {
  const { feature } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  assert.equal(toyLevels(feature, "Vibrate"), DOMI_STEPS);
});

test("a toy control Buttplug reports no range for has no level count", () => {
  const { feature } = fakeToy({ Vibrate: { Value: [0, DOMI_STEPS] } });
  assert.equal(toyLevels(feature, "Rotate"), undefined);
});
