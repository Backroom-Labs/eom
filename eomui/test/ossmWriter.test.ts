import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { OssmWriter } from "../src/lib/ossmWriter.ts";
import { settle } from "./fakeToy.ts";

// Runs fn with a fake clock starting at 0.
async function withClock(fn: () => Promise<void>) {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  try {
    await fn();
  } finally {
    mock.timers.reset();
  }
}

// Moves the fake clock on 1 ms at a time, letting writes finish in between.
async function tick(ms: number) {
  for (let i = 0; i < ms; i++) {
    mock.timers.tick(1);
    await settle();
  }
}

// An OSSM's Bluetooth link: each write takes writeMs to finish, and the link takes one at a time.
function fakeLink(writeMs = 0) {
  const writes: { at: number; name: string; value: number }[] = [];
  let busy = false;
  let overlapped = false;
  const write = async (name: string, value: number) => {
    if (busy) overlapped = true;
    busy = true;
    writes.push({ at: Date.now(), name, value });
    if (writeMs > 0) await new Promise((resolve) => setTimeout(resolve, writeMs));
    busy = false;
  };
  const sent = () => writes.map((w) => [w.name, w.value]);
  return { write, writes, sent, overlapped: () => overlapped };
}

test("a value set on a control is written to the OSSM", () => withClock(async () => {
  const link = fakeLink();
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  await settle();
  assert.deepEqual(link.sent(), [["speed", 40]]);
}));

test("values for two controls set together both reach the OSSM, one write at a time", () => withClock(async () => {
  const link = fakeLink(30);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  writer.set("stroke", 70);
  await tick(500);
  assert.deepEqual(link.sent(), [["speed", 40], ["stroke", 70]]);
  assert.equal(link.overlapped(), false);
}));

test("a control set again while waiting sends only its latest value", () => withClock(async () => {
  const link = fakeLink(30);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  writer.set("stroke", 10);
  writer.set("stroke", 20);
  writer.set("stroke", 30);
  await tick(500);
  assert.deepEqual(link.sent(), [["speed", 40], ["stroke", 30]]);
}));

test("writes are at least 100 ms apart, across all controls", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  for (let i = 0; i < 50; i++) {
    writer.set(i % 2 ? "speed" : "stroke", i);
    await tick(10);
  }
  await tick(500);
  const gaps = link.writes.slice(1).map((w, i) => w.at - link.writes[i].at);
  assert.ok(gaps.every((gap) => gap >= 100), `gaps ${gaps}`);
  assert.deepEqual(link.sent().slice(-2).sort(), [["speed", 49], ["stroke", 48]]);
}));

test("a value the OSSM already has isn't sent again", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  await tick(200);
  writer.set("speed", 40);
  writer.set("stroke", 50);
  writer.set("stroke", 60);
  writer.set("stroke", 50);
  await tick(500);
  assert.deepEqual(link.sent(), [["speed", 40], ["stroke", 50]]);
}));

test("stop sets speed 0 at once, inside the gap, and drops values still waiting", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  await tick(10);
  writer.set("speed", 80);
  writer.set("stroke", 70);
  const stopped = writer.stop();
  await settle();
  await tick(500);
  await stopped;
  assert.deepEqual(link.writes.map((w) => [w.at, w.name, w.value]), [[0, "speed", 40], [10, "speed", 0]]);
}));

test("stop waits for a write in flight, then goes next", () => withClock(async () => {
  const link = fakeLink(30);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  writer.set("stroke", 70);
  const stopped = writer.stop();
  await tick(100);
  await stopped;
  assert.deepEqual(link.writes.map((w) => [w.at, w.name, w.value]), [[0, "speed", 40], [30, "speed", 0]]);
  assert.equal(link.overlapped(), false);
}));

test("stop fails if speed 0 couldn't be written", () => withClock(async () => {
  const writer = new OssmWriter(async () => { throw new Error("Not connected to Bluetooth device"); });
  await assert.rejects(writer.stop(), /Not connected/);
}));

test("cancel drops values still waiting", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  writer.set("stroke", 70);
  writer.cancel();
  await tick(500);
  assert.deepEqual(link.sent(), [["speed", 40]]);
}));

test("a value the OSSM reported having isn't sent", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  writer.has("speed", 30);
  writer.has("stroke", 50);
  writer.set("speed", 30);
  writer.set("stroke", 60);
  await tick(500);
  assert.deepEqual(link.sent(), [["stroke", 60]]);
}));

test("a value the OSSM no longer has is sent again, once it reports the change", () => withClock(async () => {
  const link = fakeLink(5);
  const writer = new OssmWriter(link.write);
  writer.set("speed", 40);
  await tick(200);
  writer.has("speed", 25); // changed on the OSSM itself
  writer.set("speed", 40);
  await tick(200);
  assert.deepEqual(link.sent(), [["speed", 40], ["speed", 40]]);
}));

test("a value whose write failed is sent again when set again", () => withClock(async () => {
  let fail = true;
  const sent: number[] = [];
  const writer = new OssmWriter(async (_name, value) => {
    sent.push(value);
    if (fail) throw new Error("GATT operation failed");
  });
  writer.set("speed", 40);
  await tick(200);
  fail = false;
  writer.set("speed", 40);
  await tick(200);
  assert.deepEqual(sent, [40, 40]);
}));
