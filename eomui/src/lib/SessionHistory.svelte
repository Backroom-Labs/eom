<script lang="ts">
  // Recorded sessions: list, full-session graph, stats and CSV export. Recording is in history.ts.
  import { Capacitor } from "@capacitor/core";
  import {
    csvFileName,
    deleteAllSessions,
    deleteSession,
    formatDuration,
    loadRaw,
    loadSamples,
    toCsv,
    toDetailedCsv,
    type Sample,
    type SessionSummary,
  } from "./history";

  interface Props {
    sessions: SessionSummary[];
    recording: boolean;
    onchange: () => void; // a session was deleted
  }
  let { sessions, recording, onchange }: Props = $props();

  const MAX_Y = 4096;
  const SAFETY_LABELS: Record<number, string> = { 1: "sensor fault", 2: "disconnected", 3: "time limit" };
  // Heart rate is drawn on the same 0-100% axis, with 40-200 bpm across the full height.
  const hrY = (bpm: number) => Math.max(0, Math.min(1, (bpm - 40) / 160)) * MAX_Y;
  const LINES = [
    { i: 3, label: "Pleasure", color: "--pleasure", width: 2, scale: MAX_Y / 255 },
    { i: 2, label: "Arousal", color: "--arousal", width: 2, scale: 1 },
    { i: 4, label: "Edge threshold", color: "--arousal", width: 1, scale: 1, dash: [6, 6] },
    { i: 1, label: "Pressure", color: "--pressure", width: 1, scale: 1 },
    { i: 7, label: "Resting pressure", color: "--pressure", width: 1, scale: 1, dash: [2, 4] },
    { i: 10, label: "Heart rate (40–200 bpm)", color: "--heart", width: 1.5, scale: 1 },
  ];

  let selected = $state<SessionSummary | null>(null);
  let samples = $state.raw<Sample[]>([]);
  let hasHr = $derived(samples.some((s) => s[10]));
  let loading = $state(false);
  let canvas = $state<HTMLCanvasElement>();

  async function open(s: SessionSummary) {
    selected = s;
    loading = true;
    samples = [];
    try {
      samples = await loadSamples(s.id);
    } finally {
      loading = false;
    }
  }

  function when(t: number) {
    return new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const pct = (v: number, max = MAX_Y) => `${Math.round((v / max) * 100)}%`;

  async function exportCsv(s: SessionSummary, detailed = false) {
    const data = samples.length && selected?.id === s.id ? samples : await loadSamples(s.id);
    const name = detailed ? csvFileName(s).replace(/\.csv$/, "-detailed.csv") : csvFileName(s);
    const text = detailed ? toDetailedCsv(s, data, await loadRaw(s.id)) : toCsv(s, data);
    const file = new File([text], name, { type: "text/csv" });
    // In the Android/iOS app a download link goes nowhere, so use the share sheet.
    if (Capacitor.isNativePlatform() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function remove(s: SessionSummary) {
    if (!confirm(`Delete the session from ${when(s.start)}?`)) return;
    await deleteSession(s.id);
    selected = null;
    onchange();
  }

  async function removeAll() {
    if (!confirm("Delete all recorded sessions?")) return;
    await deleteAllSessions();
    selected = null;
    onchange();
  }

  function draw() {
    if (!canvas || !samples.length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(canvas);
    const color = (v: string) => css.getPropertyValue(v).trim() || "#fff";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 36, r: 8, t: 8, b: 22 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const span = Math.max(1, samples[samples.length - 1][0]);
    const x = (t: number) => pad.l + (t / span) * plotW;
    const y = (v: number) => pad.t + plotH - (Math.max(0, Math.min(MAX_Y, v)) / MAX_Y) * plotH;

    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = color("--muted");
    ctx.strokeStyle = color("--line");
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const gy = y((MAX_Y * i) / 4);
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
      ctx.fillText(`${i * 25}%`, pad.l - 6, gy);
    }
    // Time axis, in minutes
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const minutes = span / 60_000;
    const every = [1, 2, 5, 10, 15, 30, 60].find((m) => minutes / m <= 6) ?? 120;
    for (let m = 0; m <= minutes; m += every) ctx.fillText(`${m}m`, x(m * 60_000), h - pad.b + 6);

    // Orgasms and denials as markers
    for (let i = 1; i < samples.length; i++) {
      const [t] = samples[i];
      if (samples[i][6] > samples[i - 1][6]) {
        ctx.fillStyle = color("--orgasm");
        ctx.fillRect(x(t) - 1, pad.t, 2, plotH);
      } else if (samples[i][5] > samples[i - 1][5]) {
        ctx.fillStyle = color("--denied");
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x(t) - 0.5, pad.t, 1, plotH);
        ctx.globalAlpha = 1;
      }
    }

    // Keep the peak of each pixel column so edges stay visible on long sessions.
    const cols = Math.max(1, Math.floor(plotW));
    ctx.lineJoin = "round";
    for (const line of LINES) {
      if (line.i === 7 && !samples.some((s) => s[7] > 0)) continue; // firmware without a baseline
      if (line.i === 10 && !hasHr) continue;
      const peaks = new Array<number>(cols).fill(-1);
      for (const s of samples) {
        const c = Math.min(cols - 1, Math.floor((s[0] / span) * cols));
        if (line.i === 10) {
          if (s[10]) peaks[c] = Math.max(peaks[c], hrY(s[10]));
        } else {
          peaks[c] = Math.max(peaks[c], s[line.i]! * line.scale);
        }
      }
      ctx.strokeStyle = color(line.color);
      ctx.lineWidth = line.width;
      ctx.setLineDash(line.dash ?? []);
      ctx.beginPath();
      let started = false;
      peaks.forEach((v, c) => {
        if (v < 0) return;
        const px = pad.l + (c / cols) * plotW;
        if (started) ctx.lineTo(px, y(v));
        else ctx.moveTo(px, y(v));
        started = true;
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  $effect(() => {
    void samples;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  });
</script>

{#if selected}
  {@const s = selected}
  <div class="detail">
    <button class="back" onclick={() => (selected = null)}>‹ All sessions</button>
    <h3>{when(s.start)}</h3>
    {#if loading}
      <p class="muted">Loading…</p>
    {:else}
      <canvas bind:this={canvas} class="chart" aria-label="Session graph"></canvas>
      <ul class="legend">
        {#each LINES.filter((l) => l.i !== 10 || hasHr) as line}
          <li><span class="swatch" class:dashed={line.dash} style="--c: var({line.color})"></span>{line.label}</li>
        {/each}
        <li><span class="swatch tall" style="--c: var(--denied)"></span>Denial</li>
        <li><span class="swatch tall" style="--c: var(--orgasm)"></span>Orgasm</li>
      </ul>
    {/if}
    <dl class="stats">
      <div><dt>Duration</dt><dd>{formatDuration(s.end - s.start)}</dd></div>
      <div><dt>Edges</dt><dd>{s.edges}</dd></div>
      <div><dt>Denials</dt><dd>{s.denials}</dd></div>
      <div><dt>Orgasms</dt><dd>{s.orgasms}{s.ruined ? " (ruined)" : ""}</dd></div>
      <div><dt>Peak arousal</dt><dd>{pct(s.peakArousal)}</dd></div>
      <div><dt>Avg pleasure</dt><dd>{pct(s.avgPleasure, 255)}</dd></div>
      <div><dt>Edge threshold</dt><dd>{pct(s.threshold)}</dd></div>
      {#if s.peakHr}
        <div><dt>Heart rate</dt><dd>{s.avgHr} avg, {s.peakHr} peak</dd></div>
      {/if}
      {#if s.edgeHrs?.length}
        <div><dt>Heart rate at edges</dt><dd>{avg(s.edgeHrs)} bpm{#if s.edgeHrDrops?.length}, then −{avg(s.edgeHrDrops)}{/if}</dd></div>
      {/if}
      {#if s.orgasmHrPeaks?.length}
        <div><dt>Heart rate at orgasm</dt><dd>{avg(s.orgasmHrPeaks)} bpm{#if s.orgasmHrDrops?.length}, then −{avg(s.orgasmHrDrops)}{/if}</dd></div>
      {/if}
      {#if s.baselineStart}
        <div><dt>Resting drift</dt><dd>{s.baselineEnd >= s.baselineStart ? "+" : "−"}{pct(Math.abs(s.baselineEnd - s.baselineStart))}</dd></div>
      {/if}
      {#if s.safetyStop}
        <div><dt>Safety stop</dt><dd>{SAFETY_LABELS[s.safetyStop] ?? s.safetyStop}</dd></div>
      {/if}
    </dl>
    <div class="row">
      <button class="primary" onclick={() => exportCsv(s)}>Export CSV</button>
      {#if s.rawSamples}
        <button onclick={() => exportCsv(s, true)} title="Raw pressure at {s.rawHz ?? 50} Hz">Export detailed CSV</button>
      {/if}
      <button onclick={() => remove(s)}>Delete</button>
    </div>
  </div>
{:else}
  <p class="muted">
    {recording ? "Recording this session. " : ""}Sessions are recorded by this app while it's connected and saved in this
    browser only. A session ends 30 seconds after the EOM stops.
  </p>
  {#if sessions.length}
    <ul class="list">
      {#each sessions as s (s.id)}
        <li>
          <button onclick={() => open(s)}>
            <span class="when">{when(s.start)}</span>
            <span class="facts">
              {formatDuration(s.end - s.start)} · {s.edges} edge{s.edges === 1 ? "" : "s"} · {s.denials} denied{s.orgasms ? ` · ${s.orgasms} orgasm${s.orgasms === 1 ? "" : "s"}` : ""}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <button class="small" onclick={removeAll}>Delete all</button>
  {:else}
    <p class="empty">No sessions yet. Start Endless or Orgasm mode, or set an intensity.</p>
  {/if}
{/if}

<style>
  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0 0 12px;
  }
  .empty {
    padding: 24px 0;
    text-align: center;
    color: var(--muted);
  }
  .list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
  }
  .list li + li {
    border-top: 1px solid var(--line);
  }
  .list button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 4px;
    background: none;
    border: none;
    border-radius: 8px;
    text-align: left;
  }
  .when {
    font-weight: 600;
  }
  .facts {
    color: var(--muted);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .detail h3 {
    margin: 4px 0 12px;
  }
  .back {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0.25rem 0;
    font-weight: 600;
  }
  .chart {
    width: 100%;
    height: clamp(200px, 36vh, 360px);
    display: block;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 16px;
    height: 3px;
    border-radius: 2px;
    background: var(--c);
  }
  .swatch.dashed {
    background: repeating-linear-gradient(to right, var(--c) 0 4px, transparent 4px 7px);
  }
  .swatch.tall {
    width: 3px;
    height: 12px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
    margin: 16px 0;
  }
  @media (min-width: 640px) {
    .stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .stats div {
    display: flex;
    flex-direction: column;
  }
  .stats dt {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .stats dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
