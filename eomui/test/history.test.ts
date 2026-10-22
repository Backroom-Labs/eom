// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Recorder, toCsv, toDetailedCsv, type LiveReading, type RawSegment, type Sample, type SessionStore, type SessionSummary,
} from "../src/lib/history.ts";

// Keeps what the Recorder saves in memory instead of IndexedDB.
function memoryStore() {
  const sessions = new Map<number, SessionSummary>();
  const store: SessionStore = {
    save: async (summary) => void sessions.set(summary.id, JSON.parse(JSON.stringify(summary))),
    remove: async (id) => void sessions.delete(id),
    prune: async () => {},
  };
  return { store, sessions };
}

const START = 1_700_000_000_000;
const reading = (t: number): LiveReading => ({
  pressure: 2000, arousal: 100, motor: 120, threshold: 600, runMode: "ENDLESS", localTime: START + t,
});

// Feeds readings every 100 ms for `ms`, then ends the session and resolves with what was saved.
async function recordSession(ms: number, during: (recorder: Recorder, t: number) => void = () => {}) {
  const { store, sessions } = memoryStore();
  const recorder = new Recorder(store);
  const saved = new Promise<SessionSummary | null>((resolve) => (recorder.onSessionEnd = resolve));
  for (let t = 0; t <= ms; t += 100) {
    recorder.push(reading(t));
    during(recorder, t);
  }
  recorder.end();
  const summary = await saved;
  return { summary, stored: summary ? sessions.get(summary.id) : undefined };
}

test("an orgasm mark is stored as ms since the session started", async () => {
  const { stored } = await recordSession(30_000, (recorder, t) => {
    if (t === 12_300) recorder.markOrgasm(START + 12_345);
  });
  assert.deepEqual(stored?.orgasmMarks, [12_345]);
});

test("presses within 5 s of the last mark are ignored", async () => {
  const accepted: boolean[] = [];
  const { stored } = await recordSession(30_000, (recorder, t) => {
    if (t === 10_000) accepted.push(recorder.markOrgasm(START + 10_000));
    if (t === 10_300) accepted.push(recorder.markOrgasm(START + 10_300));
    if (t === 14_900) accepted.push(recorder.markOrgasm(START + 14_900));
    if (t === 15_000) accepted.push(recorder.markOrgasm(START + 15_000));
  });
  assert.deepEqual(accepted, [true, false, false, true]);
  assert.deepEqual(stored?.orgasmMarks, [10_000, 15_000]);
});

test("marking with no session recording records nothing", () => {
  const recorder = new Recorder(memoryStore().store);
  assert.equal(recorder.markOrgasm(START), false);
});

test("a session without marks is saved without the field", async () => {
  const { summary, stored } = await recordSession(30_000);
  assert.ok(summary);
  assert.equal("orgasmMarks" in stored!, false);
  assert.deepEqual(stored, JSON.parse(JSON.stringify(summary)));
});

const summary = (extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: START, start: START, end: START + 2_000, samples: 11, automaticMs: 2_000, edges: 0, denials: 0, orgasms: 0,
  ruined: false, safetyStop: 0, peakArousal: 100, avgPleasure: 120, threshold: 600, baselineStart: 2000,
  baselineEnd: 2000, orgasmPeaks: [], ...extra,
});
// 5 Hz samples from 0 to 2 s.
const samples: Sample[] = Array.from({ length: 11 }, (_, i) => [i * 200, 2000, 100, 120, 600, 0, 0, 2000, 1, 0, 0]);

// The header and the named column's value on each data row.
function column(csv: string, name: string) {
  const lines = csv.trim().split("\n").filter((l) => !l.startsWith("#"));
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, values: rows.map((r) => r[header.indexOf(name)]), rows };
}

test("the session CSV puts 1 on the row nearest each mark, in a trailing orgasm_marked column", () => {
  const { header, values } = column(toCsv(summary({ orgasmMarks: [390, 1_510] }), samples), "orgasm_marked");
  assert.equal(header.at(-1), "orgasm_marked");
  // 390 ms is nearest the 400 ms row; 1510 ms is nearer 1600 ms than 1400 ms.
  assert.deepEqual(values, ["", "", "1", "", "", "", "", "", "1", "", ""]);
});

// 50 Hz raw readings 100 to 149, the first taken 1 s into the session (rows at 1.00 s to 1.98 s).
const detailed = { rawHz: 50, rawSeq0: 100, rawT0: 1_000, rawSamples: 50 };
const raw: RawSegment[] = [{ seq: 100, p: Array.from({ length: 50 }, () => 2000) }];

test("the detailed CSV puts 1 on the row nearest each mark, in a trailing orgasm_marked column", () => {
  const { header, values, rows } = column(toDetailedCsv(summary({ ...detailed, orgasmMarks: [1_101, 1_900] }), samples, raw), "orgasm_marked");
  assert.equal(header.at(-1), "orgasm_marked");
  const marked = rows.filter((_, i) => values[i] === "1").map((r) => r[0]);
  assert.deepEqual(marked, ["1.100", "1.900"]);
  assert.equal(values.filter((v) => v === "").length, 48);
});

test("a session from before marks exports both CSVs with an empty orgasm_marked column", () => {
  const plain = column(toCsv(summary(), samples), "orgasm_marked");
  assert.equal(plain.header.at(-1), "orgasm_marked");
  assert.ok(plain.values.every((v) => v === ""));
  const full = column(toDetailedCsv(summary(detailed), samples, raw), "orgasm_marked");
  assert.equal(full.header.at(-1), "orgasm_marked");
  assert.ok(full.values.every((v) => v === ""));
});
