// Presets: named sets of session settings saved on this phone or browser, never on the EOM.
import { reportedSettings, SETTING_GROUPS, SETTINGS_BY_KEY, type SettingDef, type SettingValue } from "./settings.ts";

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type PresetValues = Record<string, SettingValue>;

const STORAGE_KEY = "eom.presets";
// Safety, Wi-Fi, Bluetooth and Advanced stay as they are, whatever a preset says.
const PRESET_GROUPS = ["session", "stimulation", "detection", "clench", "heartrate"];

export function presetKeys(): string[] {
  return SETTING_GROUPS.filter((g) => PRESET_GROUPS.includes(g.id)).flatMap((g) => g.keys);
}

// The values to send to bring the device's settings in line with a preset.
// Keys the EOM didn't report (`reported`, null offline) are left out: it would refuse them.
export function settingsToLoad(preset: PresetValues, config: PresetValues, reported: ReadonlySet<string> | null): PresetValues {
  const keys = new Set(reportedSettings(presetKeys(), reported));
  const changes: PresetValues = {};
  for (const [key, saved] of Object.entries(preset)) {
    const def = SETTINGS_BY_KEY[key];
    if (!def || !keys.has(key)) continue;
    if (def.kind === "select" && !def.options?.some((o) => o.value === saved)) continue;
    const value = typeof saved === "number" ? clamp(def, saved) : saved;
    if (config[key] !== value) changes[key] = value;
  }
  return changes;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A setting's range can shrink in a newer app after the preset was saved.
function clamp(def: SettingDef, value: number): number {
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, value));
}

export class Presets {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  get(name: string): PresetValues | undefined {
    return this.read()[name];
  }

  // Only reported keys, so a preset from an older EOM doesn't hold the app's defaults for settings it lacks.
  save(name: string, config: PresetValues, reported: ReadonlySet<string> | null) {
    const all = this.read();
    const keys = reportedSettings(presetKeys(), reported).filter((k) => k in config);
    all[name] = Object.fromEntries(keys.map((k) => [k, config[k]]));
    this.write(all);
  }

  delete(name: string) {
    const all = this.read();
    delete all[name];
    this.write(all);
  }

  names(): string[] {
    return Object.keys(this.read()).sort((a, b) => a.localeCompare(b));
  }

  // Bad stored data reads as no presets, so it can't break the settings view.
  private read(): Record<string, PresetValues> {
    let all: unknown;
    try {
      all = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
    if (!isObject(all)) return {};
    return Object.fromEntries(Object.entries(all).filter(([, values]) => isObject(values))) as Record<string, PresetValues>;
  }

  private write(all: Record<string, PresetValues>) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(all));
  }
}
