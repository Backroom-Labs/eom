<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    // 0..1
    fraction: number;
    text: string;
    color: string;
    // Marks on the ring, 0..1
    markers?: { at: number; color: string; title: string }[];
    pulse?: boolean;
    action?: Snippet;
  }
  let { label, fraction, text, color, markers = [], pulse = false, action }: Props = $props();

  // 270 degree arc, open at the bottom
  const R = 80;
  const SWEEP = 270;
  const CIRC = 2 * Math.PI * R;
  const ARC = (CIRC * SWEEP) / 360;
  let f = $derived(Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)));

  function markerPoint(at: number, r: number) {
    const angle = ((135 + Math.max(0, Math.min(1, at)) * SWEEP) * Math.PI) / 180;
    return [100 + r * Math.cos(angle), 100 + r * Math.sin(angle)];
  }
</script>

<div class="gauge" class:pulse style="--c: {color}">
  <svg viewBox="0 0 200 200" role="img" aria-label="{label} {text}">
    <circle
      cx="100" cy="100" r={R} fill="none" stroke="var(--surface-3)" stroke-width="14"
      stroke-linecap="round" stroke-dasharray="{ARC} {CIRC}" transform="rotate(135 100 100)"
    />
    <circle
      class="value"
      cx="100" cy="100" r={R} fill="none" stroke="var(--c)" stroke-width="14"
      stroke-linecap="round" stroke-dasharray="{ARC * f} {CIRC}" transform="rotate(135 100 100)"
    />
    {#each markers as m}
      {@const [x1, y1] = markerPoint(m.at, R - 12)}
      {@const [x2, y2] = markerPoint(m.at, R + 12)}
      <line {x1} {y1} {x2} {y2} stroke={m.color} stroke-width="4" stroke-linecap="round"><title>{m.title}</title></line>
    {/each}
    <text x="100" y="98" text-anchor="middle" dominant-baseline="middle" class="big">{text}</text>
    <text x="100" y="138" text-anchor="middle" dominant-baseline="middle" class="small">{label}</text>
  </svg>
  {#if action}{@render action()}{/if}
</div>

<style>
  .gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  svg {
    width: 100%;
    max-width: 200px;
    aspect-ratio: 1;
  }
  .value {
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--c) 45%, transparent));
  }
  .big {
    fill: var(--text);
    font-size: 44px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .small {
    fill: var(--c);
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .pulse .value {
    animation: pulse 0.6s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pulse .value {
      animation: none;
    }
  }
</style>
