// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lockedCommands, WsSettings } from "../src/lib/wsSettings.ts";

// Plays the EOM's WebSocket replies (doc/WebSocket.md): one reply frame per frame sent, an error
// under a refused command's name, and a nonce echoed for a command that was given one.
function fakeEom(reply: (setting: Record<string, unknown>) => Record<string, unknown> | null) {
  const sent: any[] = [];
  let settings: WsSettings;
  const send = (frame: string) => {
    const msg = JSON.parse(frame);
    sent.push(msg);
    const response: Record<string, unknown> = {};
    const error = reply(msg.configSet);
    if (error) response.configSet = error;
    if (msg.time?.nonce !== undefined) response.time = { nonce: msg.time.nonce };
    queueMicrotask(() => settings.receive(response));
  };
  settings = new WsSettings(send, 50);
  return { settings, sent };
}

test("a setting the EOM accepts resolves to true", async () => {
  const { settings, sent } = fakeEom(() => null);
  assert.equal(await settings.set("edge_delay", 30), true);
  assert.deepEqual(sent[0].configSet, { edge_delay: 30 });
});

test("a setting refused by the Settings lock resolves to false", async () => {
  const { settings } = fakeEom(() => ({ errno: 2, error: "SETTINGS LOCKED" }));
  assert.equal(await settings.set("edge_delay", 30), false);
});

test("each setting gets its own reply when several are in flight", async () => {
  const { settings } = fakeEom((setting) => ("max_pleasure" in setting ? { errno: 1 } : null));
  const results = await Promise.all([settings.set("edge_delay", 30), settings.set("max_pleasure", 999), settings.set("edge_delay", 20)]);
  assert.deepEqual(results, [true, false, true]);
});

test("with no reply, as from firmware that ignores the probe, the setting counts as sent", async () => {
  const settings = new WsSettings(() => {}, 10);
  assert.equal(await settings.set("edge_delay", 30), true);
});

test("lockedCommands names the commands refused by the Settings lock", () => {
  assert.deepEqual(lockedCommands({ setMode: { errno: 2, error: "SETTINGS LOCKED" }, readings: { motor: 0 } }), ["setMode"]);
  assert.deepEqual(lockedCommands({ configSet: { errno: 1 } }), []);
  assert.deepEqual(lockedCommands(null), []);
});
