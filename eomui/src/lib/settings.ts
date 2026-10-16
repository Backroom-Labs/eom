// Every device setting the UI can change. Keys match the firmware's CONFIG_DEFS in src/config.c;
// the device sends them all in configList (WebSocket) or as config dumps (Bluetooth).

export type SettingValue = number | string | boolean;

export type SettingKind = "range" | "toggle" | "text" | "password" | "number" | "select";

export type SettingDef = {
  key: string;
  label: string;
  description: string;
  kind: SettingKind;
  default: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // Show the raw value as a percentage of this number.
  percentOf?: number;
  options?: { value: SettingValue; label: string }[];
  // Takes effect only after the device restarts.
  restart?: boolean;
  // Only shown when this returns true.
  visible?: (config: Record<string, SettingValue>) => boolean;
  format?: (value: number) => string;
};

export type SettingGroup = {
  id: string;
  title: string;
  description?: string;
  keys: string[];
};

const ADC_MAX = 4096; // arousal and pressure are 12 bit
const PLEASURE_MAX = 255;

const seconds = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}m ${v % 60 ? `${v % 60}s` : ""}`.trim() : `${v}s`);
const millis = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}s` : `${v}ms`);
const minutes = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}h ${v % 60 ? `${v % 60}m` : ""}`.trim() : `${v} min`);

export const SETTINGS: SettingDef[] = [
  // Session
  {
    key: "vibration_mode",
    label: "Algorithm",
    description: "How pleasure is ramped in Endless and Orgasm mode.",
    kind: "select",
    default: 2,
    options: [
      { value: 1, label: "Ramp-Stop" },
      { value: 2, label: "Depletion" },
      { value: 3, label: "Enhancement" },
    ],
  },
  {
    key: "auto_edging_duration_minutes",
    label: "Edging time before orgasm",
    description: "In Orgasm mode, how long to edge before an orgasm is permitted.",
    kind: "range", default: 30, min: 1, max: 120, format: minutes,
  },
  {
    key: "max_denied",
    label: "Denials before orgasm",
    description: "In Orgasm mode, permit an orgasm after this many denials, even if the edging time hasn't passed. 0 means no limit.",
    kind: "range", default: 20, min: 0, max: 99,
    format: (v) => (v === 0 || v >= 100 ? "No limit" : `${v}`),
  },
  {
    key: "edge_menu_lock",
    label: "Lock settings during Orgasm mode",
    description: "Two minutes into an Orgasm mode session, settings can't be changed until the session ends. Helps you stick to the plan.",
    kind: "toggle", default: false,
  },

  // Stimulation
  {
    key: "max_pleasure",
    label: "Maximum intensity",
    description: "The highest pleasure level the device ramps up to.",
    kind: "range", default: 255, min: 0, max: PLEASURE_MAX, percentOf: PLEASURE_MAX,
  },
  {
    key: "initial_pleasure",
    label: "Starting intensity",
    description: "Pleasure level when stimulation starts or resumes after an edge.",
    kind: "range", default: 10, min: 0, max: PLEASURE_MAX, percentOf: PLEASURE_MAX,
  },
  {
    key: "motor_ramp_time_s",
    label: "Ramp time",
    description: "Seconds to ramp from the starting intensity to the maximum.",
    kind: "range", default: 120, min: 1, max: 255, format: seconds,
  },
  {
    key: "edge_delay",
    label: "Edge cooldown",
    description: "Minimum time to wait after an edge before pleasure resumes.",
    kind: "range", default: 10, min: 0, max: 120, format: seconds,
  },
  {
    key: "max_additional_delay",
    label: "Random extra cooldown",
    description: "Up to this many extra seconds, picked at random, are added to each edge cooldown. 0 turns it off.",
    kind: "range", default: 10, min: 0, max: 120, format: seconds,
  },
  {
    key: "minimum_on_time",
    label: "Minimum on time",
    description: "After pleasure resumes, edges aren't detected for this long.",
    kind: "range", default: 1, min: 0, max: 60, format: seconds,
  },

  // Arousal detection
  {
    key: "sensitivity_threshold",
    label: "Edge threshold",
    description: "Arousal level that counts as an edge. Lower stops sooner. Everyone's ideal value differs.",
    kind: "range", default: 1024, min: 10, max: ADC_MAX, step: 8, percentOf: ADC_MAX,
  },
  {
    key: "mid_threshold",
    label: "Warning threshold",
    description: "Arousal level where the warning zone starts (the LED turns yellow).",
    kind: "range", default: 512, min: 0, max: ADC_MAX, step: 8, percentOf: ADC_MAX,
  },
  {
    key: "sensor_sensitivity",
    label: "Sensor gain",
    description: "Pressure sensor prescaling. Adjust until resting pressure sits around 60-70%.",
    kind: "range", default: 50, min: 0, max: 100, unit: "%",
  },
  {
    key: "pressure_smoothing",
    label: "Pressure smoothing",
    description: "Number of samples averaged together. Higher reduces false edges but adds lag.",
    kind: "range", default: 10, min: 1, max: 100, unit: "samples",
  },
  {
    key: "use_average_values",
    label: "Use averaged pressure",
    description: "Calculate arousal from the smoothed pressure instead of raw readings.",
    kind: "toggle", default: true,
  },
  {
    key: "update_frequency_hz",
    label: "Update rate",
    description: "How often pressure is read and arousal is updated. Changing it also changes how fast ramps run.",
    kind: "range", default: 50, min: 1, max: 100, unit: "Hz",
  },

  // Clench & post-orgasm
  {
    key: "use_post_orgasm",
    label: "Post-orgasm stimulation",
    description: "Keep stimulating at full intensity after an orgasm is detected in Orgasm mode.",
    kind: "toggle", default: true,
  },
  {
    key: "post_orgasm_duration_seconds",
    label: "Post-orgasm duration",
    description: "How long to keep stimulating after an orgasm is detected.",
    kind: "range", default: 10, min: 0, max: 300, format: seconds,
    visible: (c) => Boolean(c.use_post_orgasm),
  },
  {
    key: "clench_detector_in_edging",
    label: "Clench detection while edging",
    description: "Sustained clenches raise arousal during Endless and Orgasm mode.",
    kind: "toggle", default: true,
  },
  {
    key: "clench_pressure_sensitivity",
    label: "Clench sensitivity",
    description: "Pressure rise above arousal that counts as a clench. Lower is more sensitive.",
    kind: "range", default: 300, min: 0, max: ADC_MAX, step: 8, percentOf: ADC_MAX,
  },
  {
    key: "clench_time_threshold_ms",
    label: "Clench start time",
    description: "How long pressure must stay high before it counts as a clench.",
    kind: "range", default: 900, min: 0, max: 10000, step: 100, format: millis,
  },
  {
    key: "clench_time_to_orgasm_ms",
    label: "Clench time to orgasm",
    description: "A clench held this long is detected as an orgasm.",
    kind: "range", default: 1500, min: 0, max: 30000, step: 100, format: millis,
  },
  {
    key: "max_clench_duration_ms",
    label: "Maximum clench effect",
    description: "How long a single clench can keep raising arousal while edging.",
    kind: "range", default: 3000, min: 0, max: 60000, step: 100, format: millis,
  },

  // Wi-Fi
  {
    key: "wifi_on",
    label: "Wi-Fi",
    description: "Turn on Wi-Fi and the WebSocket server.",
    kind: "toggle", default: true, restart: true,
  },
  {
    key: "wifi_ap_mode",
    label: "Wi-Fi mode",
    description: "Host its own network, or join an existing one.",
    kind: "select", default: true, restart: true,
    options: [
      { value: true, label: "Own network" },
      { value: false, label: "Join network" },
    ],
    visible: (c) => Boolean(c.wifi_on),
  },
  {
    key: "ap_ssid",
    label: "Network name",
    description: "Name of the network the EOM hosts.",
    kind: "text", default: "EOM", restart: true,
    visible: (c) => Boolean(c.wifi_on) && Boolean(c.wifi_ap_mode),
  },
  {
    key: "ap_password",
    label: "Network password",
    description: "Leave empty for an open network. Otherwise at least 8 characters.",
    kind: "password", default: "", restart: true,
    visible: (c) => Boolean(c.wifi_on) && Boolean(c.wifi_ap_mode),
  },
  {
    key: "ap_channel",
    label: "Channel",
    description: "Wi-Fi channel of the hosted network. Try another one if the connection is unreliable.",
    kind: "range", default: 1, min: 1, max: 13, restart: true,
    visible: (c) => Boolean(c.wifi_on) && Boolean(c.wifi_ap_mode),
  },
  {
    key: "ap_max_connections",
    label: "Maximum clients",
    description: "How many devices can join the hosted network at once.",
    kind: "range", default: 4, min: 1, max: 4, restart: true,
    visible: (c) => Boolean(c.wifi_on) && Boolean(c.wifi_ap_mode),
  },
  {
    key: "wifi_ssid",
    label: "Wi-Fi network",
    description: "Name (SSID) of the network to join.",
    kind: "text", default: "", restart: true,
    visible: (c) => Boolean(c.wifi_on) && !c.wifi_ap_mode,
  },
  {
    key: "wifi_key",
    label: "Wi-Fi password",
    description: "Password of the network to join.",
    kind: "password", default: "", restart: true,
    visible: (c) => Boolean(c.wifi_on) && !c.wifi_ap_mode,
  },
  {
    key: "hostname",
    label: "Hostname",
    description: "Find the device as <hostname>.local on your network.",
    kind: "text", default: "eom", restart: true,
    visible: (c) => Boolean(c.wifi_on),
  },
  {
    key: "use_ssl",
    label: "Secure WebSocket (wss://)",
    description: "Needed when the UI is opened over https. Falls back to ws:// if the device has no certificate.",
    kind: "toggle", default: true, restart: true,
    visible: (c) => Boolean(c.wifi_on),
  },
  {
    key: "websocket_port",
    label: "WebSocket port",
    description: "Port of the plain ws:// server.",
    kind: "number", default: 80, min: 1, max: 65535, restart: true,
    visible: (c) => Boolean(c.wifi_on),
  },

  // Bluetooth
  {
    key: "bt_on",
    label: "Bluetooth",
    description: "Turn on Bluetooth. If both Bluetooth and Wi-Fi are off, the device can't be reached without reflashing.",
    kind: "toggle", default: true, restart: true,
  },
  {
    key: "bt_display_name",
    label: "Bluetooth name",
    description: "Name shown when scanning. Keep the EOM prefix, or the app won't find it.",
    kind: "text", default: "EOM_BT", restart: true,
    visible: (c) => Boolean(c.bt_on),
  },
  {
    key: "force_bt_coex",
    label: "Bluetooth and Wi-Fi together",
    description: "Run both radios at once. When off and Wi-Fi is on, Bluetooth is turned off to save memory.",
    kind: "toggle", default: true, restart: true,
  },

  // Advanced
  {
    key: "classic_serial",
    label: "Classic serial output",
    description: "Stream readings over USB serial for older NoGasm software.",
    kind: "toggle", default: false,
  },
  {
    key: "chart_window_s",
    label: "Chart history",
    description: "Seconds of history shown on the chart. Long windows can be slow on older phones.",
    kind: "range", default: 5, min: 1, max: 120, format: seconds,
  },
];

export const SETTINGS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "session",
    title: "Session",
    keys: ["vibration_mode", "auto_edging_duration_minutes", "max_denied", "edge_menu_lock"],
  },
  {
    id: "stimulation",
    title: "Stimulation",
    keys: ["max_pleasure", "initial_pleasure", "motor_ramp_time_s", "edge_delay", "max_additional_delay", "minimum_on_time"],
  },
  {
    id: "detection",
    title: "Arousal detection",
    keys: ["sensitivity_threshold", "mid_threshold", "sensor_sensitivity", "pressure_smoothing", "use_average_values", "update_frequency_hz"],
  },
  {
    id: "clench",
    title: "Clench & post-orgasm",
    keys: [
      "use_post_orgasm", "post_orgasm_duration_seconds", "clench_detector_in_edging",
      "clench_pressure_sensitivity", "clench_time_threshold_ms", "clench_time_to_orgasm_ms", "max_clench_duration_ms",
    ],
  },
  {
    id: "wifi",
    title: "Wi-Fi",
    description: "Changes here are saved right away and apply after a restart.",
    keys: ["wifi_on", "wifi_ap_mode", "ap_ssid", "ap_password", "ap_channel", "ap_max_connections", "wifi_ssid", "wifi_key", "hostname", "use_ssl", "websocket_port"],
  },
  {
    id: "bluetooth",
    title: "Bluetooth",
    description: "Changes here are saved right away and apply after a restart.",
    keys: ["bt_on", "bt_display_name", "force_bt_coex"],
  },
  {
    id: "advanced",
    title: "Advanced",
    keys: ["classic_serial"],
  },
];

// Settings shown on the main screen for quick access.
export const QUICK_SETTINGS = ["sensitivity_threshold", "max_pleasure", "motor_ramp_time_s", "edge_delay"];

export function defaultConfig(): Record<string, SettingValue> {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}

// Converts a value from the device (JSON or a BLE config dump) to the setting's type.
export function coerce(def: SettingDef, raw: unknown): SettingValue {
  if (def.kind === "toggle") return raw === true || raw === 1 || raw === "1" || raw === "true";
  if (def.kind === "text" || def.kind === "password") return raw == null ? "" : String(raw);
  if (typeof def.default === "boolean") return raw === true || raw === 1 || raw === "true";
  const n = Number(raw);
  return Number.isFinite(n) ? n : def.default;
}

export function formatSetting(def: SettingDef, value: SettingValue): string {
  if (def.kind === "toggle") return value ? "On" : "Off";
  if (def.kind === "select") return def.options?.find((o) => o.value === value)?.label ?? String(value);
  if (typeof value !== "number") return String(value);
  if (def.format) return def.format(value);
  if (def.percentOf) return `${Math.round((value / def.percentOf) * 100)}%`;
  return def.unit ? `${value} ${def.unit}` : String(value);
}

// The firmware parses BLE values with atoi()/atob(), so booleans go over as true/false.
export function toWire(value: SettingValue): string {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}
