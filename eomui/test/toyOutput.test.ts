// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ToyFollower, DEFAULT_MIN, DEFAULT_MAX, type ToyControl, type ToyReading } from "../src/lib/toyOutput.ts";

const READING_HZ = 15; // the EOM's WebSocket readings rate
const DOMI_STEPS = 20; // Lovense vibrate levels
const MAX_COMMANDS_PER_S = 10;

type Sent = { t: number; scalar: number };

function run(control: ToyControl, readings: ToyReading[]): Sent[] {
  const follower = new ToyFollower(control, DOMI_STEPS);
  const sent: Sent[] = [];
  readings.forEach((r, i) => {
    const t = (i * 1000) / READING_HZ;
    const scalar = follower.onReading(r, 20, t);
    if (scalar !== null) sent.push({ t, scalar });
  });
  return sent;
}

const reading = (motor: number, arousal = 0): ToyReading => ({ motor, arousal, pressure: 0, denied: 0 });
const seconds = (s: number) => Math.round(s * READING_HZ);
const step = (scalar: number) => Math.round(scalar * DOMI_STEPS);

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
  assert.equal(sent.at(-1)!.scalar, 1);
});

test("the toy is sent 0 promptly when the motor stops for an edge", () => {
  const readings = rampSession();
  const stopAt = (seconds(120) * 1000) / READING_HZ;
  const sent = run(newControl("pleasure"), readings);
  const zero = sent.find((s) => s.t >= stopAt && s.scalar === 0);
  assert.ok(zero && zero.t - stopAt <= 200, `stop sent at ${zero?.t}`);
});

test("following the ramp, every command changes the toy's level", () => {
  const sent = run(newControl("pleasure"), rampSession());
  const repeats = sent.filter((s, i) => i > 0 && step(s.scalar) === step(sent[i - 1].scalar));
  assert.equal(repeats.length, 0, `${repeats.length} of ${sent.length} commands left the level unchanged`);
});

test("following noisy arousal, the toy gets at most 10 commands a second", () => {
  const sent = run(newControl("arousal"), noisyArousal());
  assert.ok(maxPerSecond(sent) <= MAX_COMMANDS_PER_S, `${maxPerSecond(sent)} commands in one second`);
});

test("an inverted control runs full when the motor is off and stops at full motor", () => {
  const control = { ...newControl("pleasure"), invert: true };
  const follower = new ToyFollower(control, DOMI_STEPS);
  assert.equal(follower.onReading(reading(0), 20, 0), 1);
  assert.equal(follower.onReading(reading(255), 20, 1000), 0);
});
