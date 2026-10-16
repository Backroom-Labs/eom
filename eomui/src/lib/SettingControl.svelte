<script lang="ts">
  import { formatSetting, type SettingDef, type SettingValue } from "./settings";

  interface Props {
    def: SettingDef;
    value: SettingValue;
    disabled?: boolean;
    onchange: (key: string, value: SettingValue) => void;
  }
  let { def, value, disabled = false, onchange }: Props = $props();

  // Slider position while dragging; the device value is only sent when it's released.
  let dragValue = $state<number | null>(null);
  let reveal = $state(false);
  let shown = $derived(dragValue ?? (value as number));
  let fill = $derived(
    def.max !== undefined && def.min !== undefined && def.max > def.min
      ? ((Number(shown) - def.min) / (def.max - def.min)) * 100
      : 0,
  );
  // The same setting can be on screen twice (quick settings and the drawer), so ids must be unique.
  const uid = $props.id();
  const id = `${uid}-${def.key}`;
</script>

<div class="setting" class:disabled>
  {#if def.kind === "toggle"}
    <label class="row toggleRow" for={id}>
      <span class="text">
        <span class="label">{def.label}</span>
        <span class="desc">{def.description}</span>
      </span>
      <span class="switch">
        <input
          {id}
          type="checkbox"
          role="switch"
          checked={Boolean(value)}
          {disabled}
          onchange={(e) => onchange(def.key, e.currentTarget.checked)}
        />
        <span class="track" aria-hidden="true"></span>
      </span>
    </label>
  {:else if def.kind === "select"}
    <div class="text">
      <span class="label">{def.label}</span>
      <span class="desc">{def.description}</span>
    </div>
    <div class="segmented" role="radiogroup" aria-label={def.label}>
      {#each def.options ?? [] as opt}
        <button
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          class:active={value === opt.value}
          {disabled}
          onclick={() => value !== opt.value && onchange(def.key, opt.value)}>{opt.label}</button
        >
      {/each}
    </div>
  {:else if def.kind === "range"}
    <div class="row">
      <label class="label" for={id}>{def.label}</label>
      <output class="pill" for={id}>{formatSetting(def, Number(shown))}</output>
    </div>
    <input
      {id}
      type="range"
      class="slider"
      min={def.min}
      max={def.max}
      step={def.step ?? 1}
      value={shown}
      {disabled}
      style="--fill: {fill}%"
      oninput={(e) => (dragValue = Number(e.currentTarget.value))}
      onchange={(e) => {
        const v = Number(e.currentTarget.value);
        dragValue = null;
        if (v !== value) onchange(def.key, v);
      }}
    />
    <span class="desc">{def.description}</span>
  {:else}
    <label class="label" for={id}>{def.label}</label>
    <div class="field">
      <input
        {id}
        type={def.kind === "password" && !reveal ? "password" : def.kind === "number" ? "number" : "text"}
        min={def.min}
        max={def.max}
        value={value ?? ""}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        {disabled}
        onchange={(e) => {
          let v: SettingValue = e.currentTarget.value;
          if (def.kind === "number") {
            const n = Math.round(Number(v));
            if (!Number.isFinite(n)) return;
            v = Math.min(def.max ?? n, Math.max(def.min ?? n, n));
            e.currentTarget.value = String(v);
          }
          if (v !== value) onchange(def.key, v);
        }}
        onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {#if def.kind === "password"}
        <button type="button" class="ghost" onclick={() => (reveal = !reveal)} aria-label={reveal ? "Hide password" : "Show password"}>
          {reveal ? "Hide" : "Show"}
        </button>
      {/if}
    </div>
    <span class="desc">{def.description}</span>
  {/if}
</div>

<style>
  .setting {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--line);
  }
  .setting:last-child {
    border-bottom: none;
  }
  .disabled {
    opacity: 0.5;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .toggleRow {
    cursor: pointer;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .label {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text);
  }
  .desc {
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.35;
  }
  .pill {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--accent);
    white-space: nowrap;
  }

  /* Range slider */
  .slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 28px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  .slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--surface-3) var(--fill));
  }
  .slider::-moz-range-track {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--surface-3) var(--fill));
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -8px;
    border-radius: 50%;
    background: #fff;
    border: none;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  }
  .slider::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    border: none;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  }
  .slider:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: 4px;
  }

  /* Toggle switch */
  .switch {
    position: relative;
    flex: none;
    width: 46px;
    height: 28px;
  }
  .switch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .track {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: var(--surface-3);
    transition: background 0.15s;
    pointer-events: none;
  }
  .track::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch input:checked + .track {
    background: var(--accent);
  }
  .switch input:checked + .track::after {
    transform: translateX(18px);
  }
  .switch input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Text fields */
  .field {
    display: flex;
    gap: 0.5rem;
  }
  .field input {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 0 0.75rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
  }
  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ghost {
    min-width: 64px;
  }
</style>
