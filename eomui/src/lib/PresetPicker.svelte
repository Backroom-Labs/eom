<script lang="ts">
  import { Presets, settingsToLoad } from "./presets";
  import { savedPreferences } from "./savedPreferences";
  import { SETTINGS_BY_KEY, type SettingValue } from "./settings";

  interface Props {
    config: Record<string, SettingValue>;
    // The device's settings have been received.
    canSave: boolean;
    // Connected, settings received and no Settings lock.
    canLoad: boolean;
    // Sends one setting to the device; resolves to false if the write failed.
    change: (key: string, value: SettingValue) => Promise<boolean>;
    notify: (text: string, tone?: "info" | "error") => void;
  }
  let { config, canSave, canLoad, change, notify }: Props = $props();

  const presets = new Presets(savedPreferences);
  let names = $state(presets.names());
  let selected = $state(presets.names()[0] ?? "");
  let loading = $state(false);

  function saveAs() {
    const name = prompt("Save the current session settings as:", selected)?.trim();
    if (!name) return;
    if (names.includes(name) && !confirm(`Replace the preset "${name}" with the current settings?`)) return;
    presets.save(name, config);
    names = presets.names();
    selected = name;
    notify(`Saved preset "${name}"`);
  }

  async function load() {
    const values = presets.get(selected);
    if (!values) return;
    loading = true;
    const failed: string[] = [];
    // One at a time, so Bluetooth writes don't overlap.
    for (const [key, value] of Object.entries(settingsToLoad(values, config))) {
      if (!(await change(key, value))) failed.push(SETTINGS_BY_KEY[key]?.label ?? key);
    }
    loading = false;
    if (failed.length) notify(`Couldn't change ${failed.join(", ")}`, "error");
    else notify(`Loaded preset "${selected}"`);
  }

  function remove() {
    if (!confirm(`Delete the preset "${selected}"?`)) return;
    presets.delete(selected);
    names = presets.names();
    selected = names[0] ?? "";
  }
</script>

<div class="presets">
  <select aria-label="Preset" bind:value={selected} disabled={names.length === 0}>
    {#if names.length === 0}<option value="">No presets yet</option>{/if}
    {#each names as name (name)}<option value={name}>{name}</option>{/each}
  </select>
  <div class="buttons">
    <button class="small primary" disabled={!canLoad || !selected || loading} onclick={load}>Load</button>
    <button class="small" disabled={!canSave} onclick={saveAs}>Save as…</button>
    <button class="small" disabled={!selected} onclick={remove}>Delete</button>
  </div>
</div>

<style>
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 12px 0;
  }
  select {
    flex: 1 1 10rem;
    min-width: 0;
    min-height: 32px;
    padding: 0 0.6rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
  }
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .buttons {
    display: flex;
    gap: 0.5rem;
  }
</style>
