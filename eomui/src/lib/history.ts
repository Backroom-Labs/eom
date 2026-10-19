// Session history: the app records the readings it already receives (over BLE or Wi-Fi) into
// IndexedDB in this browser. Nothing is stored on the device, so a session is only recorded while
// the app is open and connected.

export type LiveReading = {
  pressure: number;
  arousal: number;
  motor: number;
  threshold: number;
  denied?: number;
  orgasms?: number;
  baseline?: number;
  phase?: number;
  safety?: number;
  runMode: string;
  localTime: number;
  hr?: number; // bpm from a heart-rate sensor, if one is connected
  // Raw pressure readings (firmware 3.6.0): the last few, oldest first, ending at reading number
  // `end` - 1 (counted since the EOM booted). Overlaps the previous reading's batch.
  raw?: { end: number; p: number[]; hz: number };
};

// A run of consecutive raw pressure readings, starting at reading number seq.
export type RawSegment = { seq: number; p: number[] };

// One row per SAMPLE_MS. Arousal is the peak inside the bucket so edges aren't smoothed away; the
// rest are the bucket's last reading.
export type Sample = [
  t: number, // ms since the session started
  pressure: number,
  arousal: number,
  motor: number,
  threshold: number,
  denied: number,
  orgasms: number,
  baseline: number,
  mode: number, // index into MODES
  phase: number,
  hr?: number, // bpm, 0 = no reading; missing in sessions recorded before heart rate
];
export const MODES = ["MANUAL", "ENDLESS", "ORGASM"];

export type SessionSummary = {
  id: number; // start time (ms since epoch), also the key
  start: number;
  end: number;
  samples: number;
  automaticMs: number; // time in Endless or Orgasm mode
  edges: number; // arousal crossing the edge threshold while stimulated
  denials: number;
  orgasms: number;
  ruined: boolean;
  safetyStop: number; // last safety_stop_t seen, 0 if none
  peakArousal: number;
  avgPleasure: number; // 0-255, over the stimulated time
  threshold: number; // edge threshold at the end
  baselineStart: number;
  baselineEnd: number;
  orgasmPeaks: number[]; // peak arousal in the minute before each orgasm
  peakHr?: number; // bpm; only with a heart-rate sensor
  avgHr?: number;
  edgeHrs?: number[]; // heart rate at each denial
  edgeHrDrops?: number[]; // how far the heart rate fell in the minute after each denial (peak to low)
  orgasmHrPeaks?: number[]; // peak heart rate in the minute before each orgasm
  orgasmHrDrops?: number[]; // how far it fell in the minute after each orgasm
  // Detailed recording: raw pressure at the EOM's update rate. Reading number rawSeq0 was taken at
  // rawT0 ms into the session; the rest follow at rawHz.
  rawSamples?: number;
  rawHz?: number;
  rawSeq0?: number;
  rawT0?: number;
};

const SAMPLE_MS = 200;
const END_AFTER_IDLE_MS = 30_000; // stopped this long -> the session is over
const END_AFTER_SILENT_MS = 60_000; // no readings this long (disconnected) -> over
const MIN_SESSION_MS = 15_000; // shorter sessions aren't kept
const FLUSH_MS = 10_000;
const PRE_ORGASM_WINDOW_MS = 60_000;
const KEEP_SESSIONS = 200;
const HR_DROP_WINDOW_MS = 60_000;

// -----------------------------------------------------------------------------------------------
// Storage

const DB_NAME = "eom-history";
const SESSIONS = "sessions"; // SessionSummary by id
const CHUNKS = "chunks"; // { id, n, samples } by [id, n]

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SESSIONS, { keyPath: "id" });
      req.result.createObjectStore(CHUNKS, { keyPath: ["id", "n"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listSessions(): Promise<SessionSummary[]> {
  const tx = (await db()).transaction(SESSIONS);
  const all = await request(tx.objectStore(SESSIONS).getAll() as IDBRequest<SessionSummary[]>);
  return all.sort((a, b) => b.id - a.id);
}

export async function loadSamples(id: number): Promise<Sample[]> {
  const tx = (await db()).transaction(CHUNKS);
  const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
  const chunks = await request(tx.objectStore(CHUNKS).getAll(range) as IDBRequest<{ n: number; samples: Sample[] }[]>);
  return chunks.sort((a, b) => a.n - b.n).flatMap((c) => c.samples ?? []);
}

export async function deleteSession(id: number): Promise<void> {
  const tx = (await db()).transaction([SESSIONS, CHUNKS], "readwrite");
  tx.objectStore(SESSIONS).delete(id);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Infinity]));
  await done(tx);
}

export async function deleteAllSessions(): Promise<void> {
  const tx = (await db()).transaction([SESSIONS, CHUNKS], "readwrite");
  tx.objectStore(SESSIONS).clear();
  tx.objectStore(CHUNKS).clear();
  await done(tx);
}

async function saveChunk(summary: SessionSummary, n: number, samples: Sample[], raw: RawSegment[] = []) {
  const tx = (await db()).transaction([SESSIONS, CHUNKS], "readwrite");
  tx.objectStore(SESSIONS).put(plainCopy(summary));
  if (samples.length || raw.length) tx.objectStore(CHUNKS).put({ id: summary.id, n, samples, ...(raw.length ? { raw } : {}) });
  await done(tx);
}

// Detailed recording: the session's raw pressure segments, in order.
export async function loadRaw(id: number): Promise<RawSegment[]> {
  const tx = (await db()).transaction(CHUNKS);
  const range = IDBKeyRange.bound([id, 0], [id, Infinity]);
  const chunks = await request(tx.objectStore(CHUNKS).getAll(range) as IDBRequest<{ n: number; raw?: RawSegment[] }[]>);
  return chunks.sort((a, b) => a.n - b.n).flatMap((c) => c.raw ?? []);
}

// Structured clone can't copy Svelte proxies; summaries are plain objects but be safe.
function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function pruneOldSessions() {
  const all = await listSessions();
  for (const s of all.slice(KEEP_SESSIONS)) await deleteSession(s.id);
}

// -----------------------------------------------------------------------------------------------
// Recording

const isActive = (r: LiveReading) => r.runMode !== "MANUAL" || r.motor > 0;

type Current = {
  summary: SessionSummary;
  chunkNo: number;
  stored: number; // samples already saved
  pending: Sample[];
  recent: Sample[]; // last PRE_ORGASM_WINDOW_MS, for orgasm peaks
  bucketStart: number;
  bucketPeak: number;
  last: LiveReading;
  lastActive: number;
  lastFlush: number;
  pleasureSum: number;
  pleasureN: number;
  hrSum: number;
  hrN: number;
  // Denials and orgasms in the last minute, for how far the heart rate falls afterwards.
  hrWatch: { t: number; orgasm: boolean; peak: number; low: number }[];
  rawPending: RawSegment[];
  rawNext: number; // next raw reading number expected, -1 before the first
  aboveThreshold: boolean;
};

function closeHrWatch(s: SessionSummary, w: Current["hrWatch"][number]) {
  if (w.orgasm) (s.orgasmHrDrops ??= []).push(w.peak - w.low);
  else (s.edgeHrDrops ??= []).push(w.peak - w.low);
}

export class Recorder {
  private current: Current | null = null;
  enabled = true;
  detailed = false; // also keep raw pressure at the EOM's update rate
  // Called after a session is saved for the last time.
  onSessionEnd?: (summary: SessionSummary | null) => void;

  get recording(): boolean {
    return this.current !== null;
  }

  // The baseline when the current session started, for drift.
  get sessionBaseline(): number | null {
    return this.current?.summary.baselineStart ?? null;
  }

  push(r: LiveReading) {
    const now = r.localTime;
    if (!this.current) {
      if (!this.enabled || !isActive(r)) return;
      this.current = {
        summary: {
          id: now, start: now, end: now, samples: 0, automaticMs: 0, edges: 0, denials: 0, orgasms: 0,
          ruined: false, safetyStop: 0, peakArousal: 0, avgPleasure: 0, threshold: r.threshold,
          baselineStart: r.baseline ?? 0, baselineEnd: r.baseline ?? 0, orgasmPeaks: [],
        },
        chunkNo: 0, stored: 0, pending: [], recent: [], bucketStart: now, bucketPeak: r.arousal, last: r,
        lastActive: now, lastFlush: now, pleasureSum: 0, pleasureN: 0, hrSum: 0, hrN: 0, hrWatch: [], rawPending: [], rawNext: -1, aboveThreshold: false,
      };
    }
    const c = this.current;
    const s = c.summary;
    const prev = c.last;

    if (r.runMode !== "MANUAL") s.automaticMs += Math.max(0, Math.min(1000, now - prev.localTime));
    if (isActive(r)) c.lastActive = now;
    const denied = Math.max(0, (r.denied ?? 0) - (prev.denied ?? 0));
    s.denials += denied;
    if (denied && r.hr) {
      (s.edgeHrs ??= []).push(r.hr);
      c.hrWatch.push({ t: now, orgasm: false, peak: r.hr, low: r.hr });
    }
    if (r.phase === 3) s.ruined = true;
    if (r.safety) s.safetyStop = r.safety;
    if ((r.orgasms ?? 0) > (prev.orgasms ?? 0)) {
      s.orgasms += (r.orgasms ?? 0) - (prev.orgasms ?? 0);
      const peak = Math.max(r.arousal, c.bucketPeak, ...c.recent.filter((x) => now - s.start - x[0] < PRE_ORGASM_WINDOW_MS).map((x) => x[2]));
      s.orgasmPeaks.push(peak);
      const hrs = [r.hr ?? 0, ...c.recent.filter((x) => now - s.start - x[0] < PRE_ORGASM_WINDOW_MS).map((x) => x[10] ?? 0)];
      const hrPeak = Math.max(...hrs);
      if (hrPeak > 0) {
        (s.orgasmHrPeaks ??= []).push(hrPeak);
        c.hrWatch.push({ t: now, orgasm: true, peak: r.hr || hrPeak, low: r.hr || hrPeak });
      }
    }
    if (r.hr) this.watchHr(r.hr, now);
    if (r.raw && this.detailed) this.addRaw(r.raw, now);
    const above = r.arousal > r.threshold && r.motor > 0;
    if (above && !c.aboveThreshold) s.edges++;
    c.aboveThreshold = r.arousal > r.threshold;

    c.bucketPeak = Math.max(c.bucketPeak, r.arousal);
    c.last = r;
    if (now - c.bucketStart >= SAMPLE_MS) this.emit(now);

    if (now - c.lastActive > END_AFTER_IDLE_MS) this.end();
    else if (now - c.lastFlush > FLUSH_MS) this.flush();
  }

  // After a denial or orgasm the heart rate usually climbs a little more, then falls: keep the peak
  // and the lowest point after it for a minute.
  private watchHr(hr: number, now: number) {
    const c = this.current!;
    for (const w of c.hrWatch) {
      if (hr > w.peak) w.peak = w.low = hr;
      else w.low = Math.min(w.low, hr);
    }
    while (c.hrWatch.length && now - c.hrWatch[0].t > HR_DROP_WINDOW_MS) closeHrWatch(c.summary, c.hrWatch.shift()!);
  }

  // Keep only raw readings not seen yet; a jump in numbering (missed notifications, reconnect)
  // starts a new segment.
  private addRaw(raw: NonNullable<LiveReading["raw"]>, now: number) {
    const c = this.current!;
    const s = c.summary;
    const start = raw.end - raw.p.length;
    if (s.rawSeq0 === undefined) {
      s.rawHz = raw.hz;
      s.rawSeq0 = raw.end - 1;
      s.rawT0 = now - s.start;
      s.rawSamples = 0;
    }
    if (raw.end <= c.rawNext) return;
    const from = Math.max(start, c.rawNext);
    const fresh = raw.p.slice(from - start);
    const last = c.rawPending[c.rawPending.length - 1];
    if (last && last.seq + last.p.length === from) last.p.push(...fresh);
    else c.rawPending.push({ seq: from, p: fresh });
    c.rawNext = raw.end;
    s.rawSamples! += fresh.length;
  }

  // Call every few seconds: ends a session whose readings stopped (disconnected).
  tick(now = Date.now()) {
    if (this.current && now - this.current.last.localTime > END_AFTER_SILENT_MS) this.end();
  }

  private emit(now: number) {
    const c = this.current!;
    const r = c.last;
    const s = c.summary;
    const sample: Sample = [
      now - s.start, r.pressure, c.bucketPeak, r.motor, r.threshold, r.denied ?? 0, r.orgasms ?? 0,
      r.baseline ?? 0, Math.max(0, MODES.indexOf(r.runMode)), r.phase ?? 0, r.hr ?? 0,
    ];
    c.pending.push(sample);
    c.recent.push(sample);
    while (c.recent.length && sample[0] - c.recent[0][0] > PRE_ORGASM_WINDOW_MS) c.recent.shift();
    s.end = now;
    s.peakArousal = Math.max(s.peakArousal, c.bucketPeak);
    s.threshold = r.threshold;
    if (r.baseline !== undefined) {
      if (!s.baselineStart) s.baselineStart = r.baseline;
      s.baselineEnd = r.baseline;
    }
    if (r.hr) {
      c.hrSum += r.hr;
      c.hrN++;
      s.avgHr = Math.round(c.hrSum / c.hrN);
      s.peakHr = Math.max(s.peakHr ?? 0, r.hr);
    }
    if (r.motor > 0) {
      c.pleasureSum += r.motor;
      c.pleasureN++;
      s.avgPleasure = Math.round(c.pleasureSum / c.pleasureN);
    }
    c.bucketStart = now;
    c.bucketPeak = 0;
  }

  private flush() {
    const c = this.current;
    if (!c || c.summary.end - c.summary.start < MIN_SESSION_MS) return;
    // Hold back samples after the last activity: if the session is ending they get trimmed.
    const activeEnd = c.lastActive - c.summary.start;
    const samples = c.pending.filter((x) => x[0] <= activeEnd);
    c.pending = c.pending.slice(samples.length);
    c.stored += samples.length;
    c.summary.samples = c.stored;
    c.lastFlush = c.last.localTime;
    const raw = c.rawPending;
    c.rawPending = [];
    saveChunk(c.summary, c.chunkNo++, samples, raw).catch((err) => console.error("Couldn't save session history:", err));
  }

  // Finish the current session (also called when recording is turned off).
  end() {
    const c = this.current;
    if (!c) return;
    this.current = null;
    for (const w of c.hrWatch) closeHrWatch(c.summary, w);
    // Trim the idle tail so the duration is the time something was running.
    const activeEnd = c.lastActive - c.summary.start;
    c.pending = c.pending.filter((x) => x[0] <= activeEnd + SAMPLE_MS);
    c.summary.end = Math.min(c.summary.end, c.lastActive);
    c.summary.samples = c.stored + c.pending.length;
    if (c.summary.end - c.summary.start < MIN_SESSION_MS) {
      // Too short to keep; drop anything already flushed.
      if (c.chunkNo > 0) deleteSession(c.summary.id).catch(() => {});
      this.onSessionEnd?.(null);
      return;
    }
    const summary = c.summary;
    saveChunk(summary, c.chunkNo, c.pending, c.rawPending)
      .then(pruneOldSessions)
      .then(() => this.onSessionEnd?.(summary))
      .catch((err) => console.error("Couldn't save session history:", err));
  }
}

// -----------------------------------------------------------------------------------------------
// Export

export function toCsv(summary: SessionSummary, samples: Sample[]): string {
  const rows = [
    "time_s,mode,pressure,arousal_peak,pleasure,edge_threshold,denials,orgasms,baseline,phase,heart_rate",
    ...samples.map((x) =>
      [(x[0] / 1000).toFixed(1), MODES[x[8]] ?? "", x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[9], x[10] || ""].join(","),
    ),
  ];
  return `# EOM session ${new Date(summary.start).toISOString()}\n${rows.join("\n")}\n`;
}

// Detailed CSV: one row per raw pressure reading, with the other values from the 5 Hz samples
// (the latest one at or before that time).
export function toDetailedCsv(summary: SessionSummary, samples: Sample[], raw: RawSegment[]): string {
  const hz = summary.rawHz || 50;
  const seq0 = summary.rawSeq0 ?? 0;
  const t0 = summary.rawT0 ?? 0;
  const rows = ["time_s,reading,pressure_raw,arousal_peak,pleasure,edge_threshold,denials,orgasms,heart_rate"];
  let j = 0;
  for (const seg of raw) {
    seg.p.forEach((p, i) => {
      const seq = seg.seq + i;
      const t = t0 + ((seq - seq0) * 1000) / hz;
      while (j + 1 < samples.length && samples[j + 1][0] <= t) j++;
      const x = samples[j];
      rows.push([(t / 1000).toFixed(3), seq, p, x?.[2] ?? "", x?.[3] ?? "", x?.[4] ?? "", x?.[5] ?? "", x?.[6] ?? "", x?.[10] || ""].join(","));
    });
  }
  return `# EOM session ${new Date(summary.start).toISOString()}, raw pressure at ${hz} Hz\n${rows.join("\n")}\n`;
}

export function csvFileName(summary: SessionSummary): string {
  const d = new Date(summary.start);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `eom-session-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.csv`;
}

// -----------------------------------------------------------------------------------------------
// Threshold suggestion

export type Suggestion = {
  threshold: number | null; // null: no change suggested
  reason: string;
  sessions: number; // sessions it's based on
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round16 = (v: number) => Math.max(16, Math.min(4080, Math.round(v / 16) * 16));

// Suggest an edge threshold from the last few sessions:
// 1. With orgasms on record: 80% of the typical arousal peak in the minute before an orgasm, so
//    edges come a little before the point of no return.
// 2. Otherwise from how often edges came: more than 2 a minute means the threshold is so low that
//    every small clench trips it; none in 10 minutes of stimulation means it's out of reach.
export function suggestThreshold(sessions: SessionSummary[], current: number): Suggestion {
  const recent = sessions.filter((s) => s.automaticMs > 60_000).slice(0, 10);
  if (!recent.length) {
    return { threshold: null, reason: "Record a session in Endless or Orgasm mode first.", sessions: 0 };
  }

  const peaks = recent.flatMap((s) => s.orgasmPeaks);
  if (peaks.length) {
    const suggested = round16(median(peaks) * 0.8);
    const n = recent.filter((s) => s.orgasmPeaks.length).length;
    return {
      threshold: Math.abs(suggested - current) < 32 ? null : suggested,
      reason: `Arousal peaked around ${Math.round((median(peaks) / 4096) * 100)}% before your ${peaks.length === 1 ? "orgasm" : `${peaks.length} orgasms`}; edging at 80% of that stops just before.`,
      sessions: n,
    };
  }

  const latest = recent[0];
  const minutes = latest.automaticMs / 60_000;
  const rate = latest.edges / minutes;
  if (rate > 2) {
    return {
      threshold: round16(latest.threshold * 1.15),
      reason: `Last session had ${rate.toFixed(1)} edges a minute, so small clenches are tripping it. A higher threshold waits for real arousal.`,
      sessions: 1,
    };
  }
  if (latest.edges === 0 && minutes >= 10) {
    return {
      threshold: round16(latest.threshold * 0.85),
      reason: `No edges in ${Math.round(minutes)} minutes of stimulation, so the threshold may be out of reach.`,
      sessions: 1,
    };
  }
  return {
    threshold: null,
    reason: "Your edge rate looks reasonable. An orgasm detected in Orgasm mode gives a better suggestion.",
    sessions: recent.length,
  };
}

// -----------------------------------------------------------------------------------------------
// Heart-rate suggestions, for the Heart rate settings (firmware Config.hr_*)

export type HrSuggestion = {
  key: string; // setting key
  value: number;
  reason: string;
};

// From the last 10 sessions with a heart rate recorded. Each value only appears once there's
// enough data for it.
export function suggestHeartRate(sessions: SessionSummary[]): { suggestions: HrSuggestion[]; sessions: number } {
  const recent = sessions.filter((s) => s.peakHr).slice(0, 10);
  const all = (pick: (s: SessionSummary) => number[] | undefined) => recent.flatMap((s) => pick(s) ?? []);
  const out: HrSuggestion[] = [];

  const edges = all((s) => s.edgeHrs);
  if (edges.length >= 3) {
    const m = Math.round(median(edges));
    out.push({
      key: "hr_edge_bpm",
      value: Math.max(60, m - 5),
      reason: `Your heart rate was around ${m} bpm at your last ${edges.length} edges; the edge zone starts a little below that.`,
    });
  }
  const edgeDrops = all((s) => s.edgeHrDrops).filter((d) => d > 0);
  if (edgeDrops.length >= 3) {
    const m = Math.round(median(edgeDrops));
    out.push({
      key: "hr_recovery_bpm",
      value: Math.max(3, Math.round(m * 0.6)),
      reason: `After an edge your heart rate typically fell ${m} bpm within a minute; resuming at about 60% of that fall.`,
    });
  }
  const orgasmPeaks = all((s) => s.orgasmHrPeaks);
  if (orgasmPeaks.length >= 1) {
    const m = Math.round(median(orgasmPeaks));
    out.push({
      key: "hr_orgasm_min_bpm",
      value: Math.round(m * 0.9),
      reason: `Your heart rate peaked around ${m} bpm before ${orgasmPeaks.length === 1 ? "your orgasm" : `${orgasmPeaks.length} orgasms`}; clenches below 90% of that are ignored.`,
    });
  }
  const orgasmDrops = all((s) => s.orgasmHrDrops).filter((d) => d > 0);
  if (orgasmDrops.length >= 2) {
    const m = Math.round(median(orgasmDrops));
    out.push({
      key: "hr_orgasm_drop_bpm",
      value: Math.max(5, Math.round(m * 0.6)),
      reason: `After an orgasm your heart rate typically fell ${m} bpm within a minute.`,
    });
  }
  return { suggestions: out, sessions: recent.length };
}
