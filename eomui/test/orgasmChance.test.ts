// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deniedByChance, nextRoundStart, denialsUntilPermitted } from "../src/lib/orgasmChance.ts";

test("deniedByChance is true when the count of lost rolls goes up", () => {
  assert.equal(deniedByChance({ chanceDenials: 0 }, { chanceDenials: 1 }), true);
  assert.equal(deniedByChance({ chanceDenials: 1 }, { chanceDenials: 1 }), false);
  assert.equal(deniedByChance({}, {}), false);
  // Starting Orgasm mode again resets the count.
  assert.equal(deniedByChance({ chanceDenials: 2 }, { chanceDenials: 0 }), false);
});

test("a round starts at 0 denials until a roll is lost", () => {
  assert.equal(nextRoundStart(null, { denied: 0 }, { denied: 0, chanceDenials: 0 }, false), 0);
  assert.equal(nextRoundStart(0, { denied: 3 }, { denied: 4, chanceDenials: 0 }, true), 0);
});

test("a lost roll starts a round that counts it as the round's first denial", () => {
  assert.equal(nextRoundStart(0, { denied: 4, chanceDenials: 0 }, { denied: 5, chanceDenials: 1 }, true), 4);
  assert.equal(nextRoundStart(4, { denied: 6, chanceDenials: 1 }, { denied: 7, chanceDenials: 1 }, true), 4);
});

test("the round start is unknown when a lost roll happened while the app wasn't listening", () => {
  assert.equal(nextRoundStart(null, {}, { denied: 9, chanceDenials: 2 }, false), null);
  assert.equal(nextRoundStart(0, { denied: 4, chanceDenials: 0 }, { denied: 9, chanceDenials: 2 }, false), null);
});

test("a denied count that drops (reset, or a new Milking round) starts the round again at 0", () => {
  assert.equal(nextRoundStart(4, { denied: 7, chanceDenials: 1 }, { denied: 0, chanceDenials: 1 }, true), 0);
  assert.equal(nextRoundStart(null, { denied: 7, chanceDenials: 1 }, { denied: 0, chanceDenials: 1 }, true), 0);
});

test("denialsUntilPermitted counts the denials the EOM still needs this round", () => {
  // The EOM permits once a round has more denials than Denials before orgasm.
  assert.equal(denialsUntilPermitted(3, 0, 0), 4);
  assert.equal(denialsUntilPermitted(3, 3, 0), 1);
  // After a lost roll at 4 denials (the 5th), max_denied more.
  assert.equal(denialsUntilPermitted(3, 5, 4), 3);
});

test("denialsUntilPermitted is null with no denial target or an unknown round start", () => {
  assert.equal(denialsUntilPermitted(0, 2, 0), null);
  assert.equal(denialsUntilPermitted(100, 2, 0), null);
  assert.equal(denialsUntilPermitted(3, 2, null), null);
  assert.equal(denialsUntilPermitted(3, 9, 0), null);
});
