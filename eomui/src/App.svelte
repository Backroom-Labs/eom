<script lang="ts">
  import { onMount } from "svelte";
  import { Capacitor } from "@capacitor/core";
  import { BleClient } from "@capacitor-community/bluetooth-le";
  import BTLED from "./BTLED.svelte";
  import OSSM from "./OSSM.svelte";
  import DeviceList from "./ButtplugConnector.svelte";
  import FirmwareUpdate, { type UpdateLink } from "./FirmwareUpdate.svelte";
  import Gauge from "./lib/Gauge.svelte";
  import SettingControl from "./lib/SettingControl.svelte";
  import PresetPicker from "./lib/PresetPicker.svelte";
  import SessionHistory from "./lib/SessionHistory.svelte";
  import { Recorder, listSessions, suggestHeartRate, suggestThreshold, type SessionSummary } from "./lib/history";
  import { O2Ring, type RingReading } from "./lib/o2ring";
  import {
    QUICK_SETTINGS,
    SETTING_GROUPS,
    SETTINGS_BY_KEY,
    AFTER_ORGASM_MILKING,
    coerce,
    defaultConfig,
    formatSetting,
    toWire,
    type SettingValue,
  } from "./lib/settings";
  import { ToyList } from "./lib/toyList";
  import { followsText } from "./lib/toyControlView";
  import { savedPreferences } from "./lib/savedPreferences";

  // ---------------------------------------------------------------------------------------------
  // Types and constants

  type Reading = {
    arousal: number;
    cooldown?: number; // seconds left of the denial period
    color?: string;
    denied?: number;
    localTime: number;
    millis: number;
    motor: number; // "pleasure"; called motor on the wire for backwards compatibility
    pressure: number;
    runMode: string;
    permit?: number; // seconds until an orgasm is permitted
    threshold: number;
    lock?: boolean; // settings locked by edge_menu_lock
    safety?: number; // why the safety checks last stopped the session, see SAFETY_MESSAGES
    phase?: number; // after-orgasm phase, see PHASE_*
    orgasms?: number; // orgasms detected this session
    rest?: number; // seconds left of a Milking rest
    baseline?: number; // resting pressure followed by the firmware (after 3.3.0)
    hr?: number; // bpm from the O2Ring, added by the app
    hrWait?: boolean; // cooldown waiting for the heart rate to settle (firmware 3.5.0)
    hrZone?: boolean; // heart rate in the edge zone, edge threshold lowered
    raw?: { end: number; p: number[]; hz: number }; // raw pressure batch (firmware 3.6.0), see history.ts
  };

  type RunMode = "MANUAL" | "ENDLESS" | "ORGASM";
  const RUN_MODES: RunMode[] = ["MANUAL", "ENDLESS", "ORGASM"];
  const RUN_MODE_LABELS: Record<RunMode, string> = { MANUAL: "Manual", ENDLESS: "Endless", ORGASM: "Orgasm" };
  const ENHANCEMENT = 3;
  const DEPLETION = 2;

  // Matches safety_stop_t in src/include/safety.h.
  const SAFETY_MESSAGES: Record<number, string> = {
    1: "Stopped: the pressure sensor isn't giving a usable signal. Check the sensor and its tube, then start again.",
    2: "Stopped because nothing was connected to the EOM. Start again when you're ready.",
    3: "Stopped: the session reached its time limit.",
    4: "Stopped: your heart rate stayed above the limit set in Safety settings. Take a break before starting again.",
  };

  // Matches oc_after_orgasm_phase_t in src/include/orgasm_control.h.
  const PHASE_POST_ORGASM = 1;
  const PHASE_RESTING = 2;
  const PHASE_RUINED = 3;

  const MAX_Y = 4096; // arousal, pressure and threshold are 12 bit
  const PLEASURE_MAX = 255;
  // Heart rate shares the 0-100% axis: 40-200 bpm across the full height.
  const HR_MIN = 40;
  const HR_MAX = 200;
  const hrFraction = (bpm: number) => Math.max(0, Math.min(1, (bpm - HR_MIN) / (HR_MAX - HR_MIN)));
  const HR_STALE_MS = 5000;

  const BT_SERVICE_UUID = "00006969-0000-1000-8000-00805f9b34fb";
  const BT_READINGS_CHAR = "0000696a-0000-1000-8000-00805f9b34fb";
  const BT_CONTROL_CHAR = "0000696b-0000-1000-8000-00805f9b34fb";
  const BT_CONFIG_CHAR = "0000696c-0000-1000-8000-00805f9b34fb";
  const BT_CMD_CONTROL = 0x01;
  const BT_CMD_SET_CONFIG = 0x02;
  const BT_CMD_GET_CONFIG = 0x03;
  const BT_CMD_RESTART = 0x04;
  const BT_CMD_SIM_PRESSURE = 0x05;
  const BT_CMD_HEART_RATE = 0x06;

  const isNativeMobile = Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android";

  // ---------------------------------------------------------------------------------------------
  // App preferences, stored in this browser only

  type Prefs = {
    wsUrl: string;
    pressureStep: number; // raw threshold units added by "Apply pressure"
    defaultView: "gauges" | "chart";
    keepAwake: boolean;
    pressureSim: boolean; // show the pressure simulator (needs a -DEOM_PRESSURE_SIM firmware build)
    recordSessions: boolean; // keep session history in this browser
    detailedRecording: boolean; // also record raw pressure at the EOM's update rate
  };
  const PREFS_KEY = "eom.prefs";
  const LEGACY_WS_URL_KEY = "eom.wsUrl";

  function loadPrefs(): Prefs {
    // Pages served over https can only open wss:// sockets. The UI is hosted externally, so default
    // to the EOM's access-point address.
    const defaults: Prefs = {
      wsUrl: window.location.protocol === "https:" ? "wss://192.168.4.1/" : "ws://192.168.4.1/",
      pressureStep: 100,
      defaultView: "gauges",
      keepAwake: true,
      pressureSim: false,
      recordSessions: true,
      detailedRecording: false,
    };
    const legacy = savedPreferences.getItem(LEGACY_WS_URL_KEY);
    if (legacy) defaults.wsUrl = legacy;
    try {
      return { ...defaults, ...JSON.parse(savedPreferences.getItem(PREFS_KEY) ?? "{}") };
    } catch {
      return defaults;
    }
  }

  let prefs = $state(loadPrefs());
  $effect(() => {
    savedPreferences.setItem(PREFS_KEY, JSON.stringify(prefs));
  });

  // ---------------------------------------------------------------------------------------------
  // State

  let config = $state(defaultConfig());
  let configLoaded = $state(false);
  let restartNeeded = $state(false);
  let fwVersion = $state<string | null>(null);

  // Chart history is a plain array: it changes 50 times a second and only the canvas reads it.
  let history: Reading[] = [];
  let latest = $state<Reading>({
    pressure: 0, arousal: 0, motor: 0, threshold: 1024, denied: 0, cooldown: 0,
    runMode: "MANUAL", localTime: 0, millis: 0, // the device boots stopped
  });

  let currentPleasure = $state(0); // manual pleasure slider
  let pleasureLockedUntil = 0; // don't let incoming readings move the slider while it's dragged

  let isWsConnected = $state(false);
  let isBtConnected = $state(false);
  let connecting = $state<"bt" | "ws" | null>(null);
  let lastConnection: "bt" | "ws" = "bt";
  let btDeviceId = $state<string | null>(null);
  let socket: WebSocket | undefined;
  let syncDelta = 0;
  let toast = $state<{ text: string; tone: "info" | "error" } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  let view = $state<"gauges" | "chart">(prefs.defaultView);
  let settingsDialog = $state<HTMLDialogElement>();
  let toysDialog = $state<HTMLDialogElement>();
  let historyDialog = $state<HTMLDialogElement>();
  let connectDialog = $state<HTMLDialogElement>();
  let settingsTab = $state("session");
  let wsUrlDraft = $state(prefs.wsUrl);

  // Toy integrations
  let btledComponent: any;
  let ossmComponent: any;
  // Every connected Buttplug toy and OSSM. A stop switches them to Manual, which is easy to miss.
  const toys = new ToyList(() => showToast("Toys stopped and switched to Manual"));
  const logToyError = (err: unknown) => console.error("Error driving toys:", err);
  // The toy strip on the main screen. Toys coming and going bump the version; live strengths and
  // modes update by themselves, as each toy's controls are reactive.
  let toysVersion = $state(0);
  toys.onChange(() => toysVersion++);
  const toyStrip = $derived.by(() => {
    void toysVersion;
    return toys.strip();
  });
  let ossmDevices = $state([]);
  let deviceList = $state([]);
  let BTLEDconnected = $state(false);

  // Heart rate from an O2Ring, connected alongside the EOM
  const ring = new O2Ring();
  let ringConnected = $state(false);
  let ringConnecting = $state(false);
  let ringName = $state("");
  let heart = $state<RingReading | null>(null);
  let ringClosing = false; // disconnected on purpose, no toast
  ring.onReading = (r) => {
    heart = r;
    sendHeartRate(r.hr ?? 0);
  };
  ring.onDisconnect = () => {
    ringConnected = false;
    heart = null;
    sendHeartRate(0);
    if (!ringClosing) showToast(`${ringName} disconnected`, "error");
  };

  async function ringConnect() {
    ringConnecting = true;
    try {
      ringName = await ring.connect();
      ringConnected = true;
      showToast(`Connected to ${ringName}`);
    } catch (error: any) {
      console.error("O2Ring connection error:", error);
      const text = String(error?.message ?? error);
      if (!/cancel/i.test(text)) showToast(`Heart rate: ${text}`, "error");
    } finally {
      ringConnecting = false;
    }
  }

  async function ringDisconnect() {
    ringClosing = true;
    await ring.disconnect();
    ringClosing = false;
  }

  // Session history and calibration
  const recorder = new Recorder();
  let sessions = $state.raw<SessionSummary[]>([]);
  let recording = $state(false);
  let sessionBaseline = $state<number | null>(null);
  function refreshSessions() {
    listSessions()
      .then((list) => (sessions = list))
      .catch((err) => console.error("Couldn't read session history:", err));
  }
  recorder.onSessionEnd = (summary) => {
    if (summary) showToast("Session saved to History");
    refreshSessions();
  };
  $effect(() => {
    recorder.enabled = prefs.recordSessions;
    recorder.detailed = prefs.detailedRecording;
    if (!prefs.recordSessions) recorder.end();
  });

  // ---------------------------------------------------------------------------------------------
  // Derived values

  let connected = $derived(isWsConnected || isBtConnected);
  // Firmware updates go over whichever connection is up.
  let updateLink = $derived<UpdateLink | null>(
    isBtConnected && btDeviceId ? { kind: "ble", deviceId: btDeviceId } : isWsConnected && socket ? { kind: "ws", socket } : null,
  );
  let runMode = $derived((RUN_MODES.includes(latest.runMode as RunMode) ? latest.runMode : "ENDLESS") as RunMode);
  let locked = $derived(Boolean(latest.lock));
  let safetyMessage = $derived(SAFETY_MESSAGES[latest.safety ?? 0]);
  let maxDenied = $derived(Number(config.max_denied) > 0 && Number(config.max_denied) < 100 ? Number(config.max_denied) : 20);
  let isEnhancement = $derived(Number(config.vibration_mode) === ENHANCEMENT);
  let onCooldown = $derived((latest.cooldown ?? 0) > 0 && latest.motor === 0);
  // The edge threshold the firmware is using right now (lowered in the heart-rate edge zone).
  let edgeThreshold = $derived(
    latest.hrZone ? Math.round((latest.threshold * (100 - Number(config.hr_edge_sensitivity))) / 100) : latest.threshold,
  );
  let aroused = $derived(latest.arousal >= edgeThreshold);
  let suggestion = $derived(suggestThreshold(sessions, latest.threshold));
  let hrSuggestion = $derived(suggestHeartRate(sessions));
  let heartText = $derived(
    !heart ? "…" : heart.hr !== null ? `${heart.hr} bpm` : heart.finger ? "Reading…" : "No finger",
  );
  let hasBaseline = $derived(latest.baseline !== undefined);
  let drift = $derived(sessionBaseline !== null && latest.baseline !== undefined ? latest.baseline - sessionBaseline : null);

  let isMilking = $derived(Number(config.after_orgasm) === AFTER_ORGASM_MILKING);
  let orgasmsText = $derived.by(() => {
    const count = latest.orgasms ?? 0;
    const max = Number(config.milking_max_orgasms);
    return isMilking && max > 0 ? `${count} of ${max}` : String(count);
  });

  // Orgasms detected this session; Milking keeps counting across rounds.
  let showOrgasms = $derived(runMode === "ORGASM" || (latest.orgasms ?? 0) > 0);
  // Enhancement counts orgasms as denials; once the real count shows, keep calling them denials.
  let deniedLabel = $derived(isEnhancement && !showOrgasms ? "Orgasms" : "Denied");
  let orgasmScale = $derived(
    isMilking && Number(config.milking_max_orgasms) > 0 ? Number(config.milking_max_orgasms) : Math.max(5, latest.orgasms ?? 0),
  );

  let status = $derived.by(() => {
    if (latest.phase === PHASE_RUINED && runMode === "MANUAL" && latest.motor === 0) {
      return { title: "Ruined", detail: "Stopped as soon as the orgasm was detected.", tone: "danger" };
    }
    if (latest.phase === PHASE_RESTING) {
      return { title: "Resting", detail: `Orgasms: ${orgasmsText}. Edging starts again in ${latest.rest ?? 0}s.`, tone: "neutral" };
    }
    if (latest.phase === PHASE_POST_ORGASM) {
      return {
        title: "Orgasm detected",
        detail: isMilking ? `Orgasms: ${orgasmsText}. Keep going…` : "Post-orgasm stimulation, then ramping down.",
        tone: "success",
      };
    }
    if (runMode === "MANUAL") {
      return latest.motor === 0
        ? { title: "Stopped", detail: "Pick Endless or Orgasm to start, or set an intensity.", tone: "neutral" }
        : { title: "Manual control", detail: "You set the intensity.", tone: "neutral" };
    }
    if (onCooldown) {
      return aroused
        ? { title: "Edge detected", detail: "Cooling down…", tone: "danger" }
        : latest.hrWait
          ? { title: "Denied", detail: `Waiting for your heart rate to settle (at most ${latest.cooldown}s)`, tone: "danger" }
          : { title: "Denied", detail: `Resuming in ${latest.cooldown}s`, tone: "danger" };
    }
    if (runMode === "ORGASM") {
      const permit = latest.permit ?? 0;
      const limit = Number(config.max_denied);
      const remaining = limit > 0 && limit < 100 ? limit - (latest.denied ?? 0) : null;
      if (permit <= 0 || (remaining !== null && remaining <= 0)) {
        return { title: "Orgasm permitted", detail: "Let go.", tone: "success" };
      }
      const time = permit > 60 ? `${Math.ceil(permit / 60)} min` : `${permit}s`;
      return {
        title: "Edging",
        detail: `Orgasm permitted in ${time}${remaining !== null ? ` or ${remaining} more denial${remaining === 1 ? "" : "s"}` : ""}`,
        tone: "warn",
      };
    }
    return { title: "Building pleasure", detail: "Edges are detected automatically.", tone: "accent" };
  });

  // ---------------------------------------------------------------------------------------------
  // Helpers

  function showToast(text: string, tone: "info" | "error" = "info") {
    toast = { text, tone };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3500);
  }

  function pct(value: number, max: number) {
    return Math.round((value / max) * 100);
  }

  function pushReading(r: Reading) {
    if (heart?.hr && r.localTime - heart.localTime < HR_STALE_MS) r.hr = heart.hr;
    // Only against a recent reading, so (re)connecting mid-session doesn't toast.
    const recent = r.localTime - latest.localTime < 5000;
    if (recent && (r.orgasms ?? 0) > (latest.orgasms ?? 0)) showToast("Orgasm detected");
    history.push(r);
    const windowMs = Math.max(1, Number(config.chart_window_s)) * 1000;
    let drop = 0;
    while (drop < history.length - 1 && r.localTime - history[drop].localTime > windowMs) drop++;
    if (drop > 0) history.splice(0, drop);
    latest = r;
    if (Date.now() > pleasureLockedUntil) currentPleasure = r.motor;
    updateDevices(r);
    scheduleChartUpdate();
    if (connected) {
      recorder.push(r);
      recording = recorder.recording;
      sessionBaseline = recorder.sessionBaseline;
    }
  }

  function applyConfig(values: Record<string, unknown>) {
    for (const [key, raw] of Object.entries(values)) {
      const def = SETTINGS_BY_KEY[key];
      if (def) config[key] = coerce(def, raw);
    }
    configLoaded = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Sending to the device

  async function btWrite(bytes: Uint8Array) {
    if (!btDeviceId) return;
    await BleClient.write(btDeviceId, BT_SERVICE_UUID, BT_CONTROL_CHAR, new DataView(bytes.buffer));
  }

  // Resolves to false if a Bluetooth write failed. Loading a preset reports failures together, so it passes quiet.
  async function changeSetting(key: string, value: SettingValue, quiet = false): Promise<boolean> {
    const def = SETTINGS_BY_KEY[key];
    const previous = config[key];
    config[key] = value;
    if (def?.restart) restartNeeded = true;

    if (isWsConnected && socket) {
      // The firmware reads booleans with cJSON valueint, so send them as 1/0.
      const wire = typeof value === "boolean" ? (value ? 1 : 0) : value;
      socket.send(JSON.stringify({ configSet: { [key]: wire } }));
    } else if (isBtConnected) {
      const enc = new TextEncoder();
      try {
        await btWrite(new Uint8Array([BT_CMD_SET_CONFIG, ...enc.encode(key), 0x3a, ...enc.encode(toWire(value))]));
      } catch (err) {
        console.error("Error sending setting via Bluetooth:", err);
        config[key] = previous;
        if (!quiet) showToast(`Couldn't change ${def?.label ?? key}`, "error");
        return false;
      }
    }
    return true;
  }

  function sendCommand(command: "setMode" | "setMotor" | "triggerArousal" | "resetDenied", value: number | string | null = null) {
    if (isWsConnected && socket) {
      socket.send(JSON.stringify({ [command]: value }));
      return;
    }
    if (isBtConnected) {
      let bytes: Uint8Array;
      if (command === "setMotor") {
        // setMotor always implies MANUAL (matches the websocket setMotor handler). Using the last
        // reported runMode here would revert a just-sent setMode before the device reports back.
        bytes = new Uint8Array([BT_CMD_CONTROL, RUN_MODES.indexOf("MANUAL"), 0, 0, Number(value)]);
      } else {
        const mode = command === "setMode" ? RUN_MODES.indexOf(value as RunMode) : RUN_MODES.indexOf(runMode);
        bytes = new Uint8Array([BT_CMD_CONTROL, mode, command === "triggerArousal" ? 1 : 0, command === "resetDenied" ? 1 : 0]);
      }
      btWrite(bytes).catch((err) => {
        console.error(`Error sending ${command} via Bluetooth:`, err);
        showToast("Command failed — check the connection", "error");
      });
      return;
    }
    // Not connected: preview the change locally so the UI can be explored.
    if (command === "setMotor") pushReading({ ...latest, motor: Number(value), runMode: "MANUAL", localTime: Date.now() });
    if (command === "setMode") pushReading({ ...latest, runMode: String(value), localTime: Date.now() });
  }

  // Forward the O2Ring's heart rate (0 = no reading) so the firmware can use it (Config.hr_*).
  // Firmware before heart-rate support ignores it.
  function sendHeartRate(bpm: number) {
    if (isWsConnected && socket) {
      socket.send(JSON.stringify({ heartRate: bpm }));
    } else if (isBtConnected) {
      btWrite(new Uint8Array([BT_CMD_HEART_RATE, Math.max(0, Math.min(255, bpm))])).catch((err) =>
        console.warn("Couldn't send heart rate:", err),
      );
    }
  }

  // Pressure simulator, for testing without a sensor. Only firmware built with -DEOM_PRESSURE_SIM
  // acts on it; other firmware ignores the command. -1 goes back to the real sensor.
  const SIM_CLENCH = 1000; // added while "Hold to clench" is pressed
  let simPressure = $state(0);
  let simClenching = $state(false);
  function sendSimPressure(value: number) {
    if (isWsConnected && socket) {
      socket.send(JSON.stringify({ simPressure: value }));
    } else if (isBtConnected) {
      const wire = value < 0 ? 0xffff : Math.min(MAX_Y - 1, value);
      btWrite(new Uint8Array([BT_CMD_SIM_PRESSURE, wire >> 8, wire & 0xff])).catch((err) => console.error(err));
    }
  }
  function setSimClench(on: boolean) {
    if (simClenching === on) return;
    simClenching = on;
    sendSimPressure(simPressure + (on ? SIM_CLENCH : 0));
  }

  // Throttle (leading + trailing): sends at most once every THROTTLE_DELAY ms while the slider is
  // dragged, and always sends the final value when dragging stops.
  const THROTTLE_DELAY = 30;
  let motorThrottle: { lastSent: number; timer?: ReturnType<typeof setTimeout>; pending?: number } = { lastSent: 0 };
  function throttledSetMotor(value: number) {
    const s = motorThrottle;
    const wait = THROTTLE_DELAY - (Date.now() - s.lastSent);
    if (wait <= 0 && s.timer === undefined) {
      s.lastSent = Date.now();
      sendCommand("setMotor", value);
      return;
    }
    s.pending = value;
    if (s.timer === undefined) {
      s.timer = setTimeout(() => {
        s.timer = undefined;
        s.lastSent = Date.now();
        sendCommand("setMotor", s.pending!);
      }, Math.max(wait, 0));
    }
  }

  function setRunMode(mode: RunMode) {
    sendCommand("setMode", mode);
    // Enhancement has no meaning in Orgasm mode.
    if (mode === "ORGASM" && isEnhancement) changeSetting("vibration_mode", DEPLETION);
  }

  function fullStop() {
    sendCommand("setMode", "MANUAL");
    sendCommand("setMotor", 0);
    currentPleasure = 0;
    pleasureLockedUntil = Date.now() + 500;
    toys.stopAll().catch(logToyError);
  }

  // "Apply pressure": everything happens one notch faster.
  function applyPressure() {
    changeSetting("motor_ramp_time_s", Math.max(1, Number(config.motor_ramp_time_s) - 1));
    setTimeout(() => changeSetting("edge_delay", Math.max(0, Number(config.edge_delay) - 1)), 100);
    setTimeout(() => changeSetting("sensitivity_threshold", Math.min(MAX_Y, latest.threshold + prefs.pressureStep)), 200);
  }

  async function restartDevice() {
    if (!config.bt_on && !config.wifi_on) {
      showToast("Turn on Bluetooth or Wi-Fi first, or you won't be able to reconnect.", "error");
      return;
    }
    const lostLink = (isBtConnected && !config.bt_on) || (isWsConnected && !config.wifi_on);
    const message = lostLink
      ? "Restart the EOM now? With these settings you'll need the other connection type to reconnect."
      : "Restart the EOM now? You'll need to reconnect afterwards.";
    if (!confirm(message)) return;
    try {
      if (isWsConnected && socket) socket.send(JSON.stringify({ restart: null }));
      else if (isBtConnected) await btWrite(new Uint8Array([BT_CMD_RESTART]));
      restartNeeded = false;
      showToast("Restarting…");
    } catch (err) {
      console.error("Restart failed:", err);
      showToast("Couldn't restart. Older firmware can only restart over Wi-Fi.", "error");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // WebSocket

  function connectWebSocket(url: string) {
    prefs.wsUrl = url.trim();
    socket?.close();
    isWsConnected = false;
    connecting = "ws";
    lastConnection = "ws";
    socket = new WebSocket(prefs.wsUrl);
    socket.onopen = handleWsOpen;
    socket.onerror = (e) => {
      console.error("WebSocket error:", e);
      isWsConnected = false;
      if (connecting === "ws") {
        connecting = null;
        showToast(`Couldn't reach ${prefs.wsUrl}`, "error");
      }
    };
    socket.onclose = () => (isWsConnected = false);
    socket.onmessage = handleWsMessage;
  }

  function disconnectWebSocket() {
    lastConnection = "bt";
    socket?.close();
    socket = undefined;
    isWsConnected = false;
  }

  function handleWsOpen() {
    if (btDeviceId) BleClient.disconnect(btDeviceId).catch((err) => console.error("Error disconnecting BT:", err));
    isBtConnected = false;
    isWsConnected = true;
    connecting = null;
    syncDelta = 0;
    socket?.send(JSON.stringify({ configList: null }));
    socket?.send(JSON.stringify({ streamReadings: null }));
    socket?.send(JSON.stringify({ info: null }));
    connectDialog?.close();
    showToast("Connected over Wi-Fi");
  }

  function handleWsMessage(event: MessageEvent) {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
      return;
    }
    if (!msg) return;
    if (msg.configList) applyConfig(msg.configList);
    if (msg.info?.fwVersion) fwVersion = msg.info.fwVersion;
    const r = msg.readings;
    if (!r || !r.millis || r.pressure === undefined || r.arousal === undefined || r.motor === undefined) return;
    pushReading({
      arousal: r.arousal,
      cooldown: r.cooldown,
      denied: r.denied,
      millis: r.millis,
      motor: r.motor,
      pressure: r.pressure,
      runMode: r.runMode,
      permit: r.permit,
      threshold: r.threshold,
      lock: r.lock,
      safety: r.safety,
      phase: r.phase,
      orgasms: r.orgasms,
      rest: r.rest,
      baseline: r.baseline,
      hrWait: r.hrWait,
      hrZone: r.hrZone,
      raw: Array.isArray(r.raw) && typeof r.rawSeq === "number" ? { end: r.rawSeq, p: r.raw, hz: rawHz() } : undefined,
      localTime: Date.now(),
    });
  }

  // Raw pressure readings arrive at the EOM's update rate.
  function rawHz() {
    return Number(config.update_frequency_hz) || 50;
  }

  // BLE sends only the low 16 bits of the raw reading number; extend it from the last one seen.
  let btRawSeq = -1;
  function unwrapRawSeq(low16: number): number {
    if (btRawSeq < 0) return (btRawSeq = low16);
    const delta = (low16 - (btRawSeq & 0xffff)) & 0xffff;
    if (delta < 0x8000) btRawSeq += delta;
    return btRawSeq;
  }

  // ---------------------------------------------------------------------------------------------
  // Bluetooth

  function onBtDisconnected(deviceId: string) {
    console.log(`Device ${deviceId} disconnected.`);
    btDeviceId = null;
    isBtConnected = false;
    syncDelta = 0;
    btRawSeq = -1;
  }

  async function btDisconnect() {
    if (btDeviceId) await BleClient.disconnect(btDeviceId).catch((err) => console.error(err));
    onBtDisconnected(btDeviceId ?? "");
  }

  function handleBtReading(value: DataView) {
    const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const r: Reading = {
      pressure: data[0] * 16, // scale to 0-4096
      arousal: data[1] * 16,
      threshold: data[2] * 16,
      motor: data[3],
      cooldown: data[4],
      denied: data[5],
      runMode: RUN_MODES[data[6]] ?? "ENDLESS",
      permit: (data[8] << 8) | data[9],
      color: `${data[10]},${data[11]},${data[12]}`,
      millis: ((data[13] << 24) | (data[14] << 16) | (data[15] << 8) | data[16]) >>> 0,
      lock: data.length > 17 ? data[17] !== 0 : false, // added after 2.0.2
      safety: data.length > 18 ? data[18] : 0, // added after 3.1.0
      // added after 3.2.0
      orgasms: data.length > 22 ? data[19] : 0,
      phase: data.length > 22 ? data[20] : 0,
      rest: data.length > 22 ? (data[21] << 8) | data[22] : 0,
      baseline: data.length > 24 ? (data[23] << 8) | data[24] : undefined, // added after 3.3.0
      // added in 3.5.0: [25] heart rate the EOM is using, [26] flags
      hrWait: data.length > 26 ? (data[26] & 0x01) !== 0 : false,
      hrZone: data.length > 26 ? (data[26] & 0x02) !== 0 : false,
      // added in 3.6.0: [27-28] raw reading number (low 16 bits), [29] count, then that many u16
      raw: data.length > 29 && data.length >= 30 + 2 * data[29]
        ? {
            end: unwrapRawSeq((data[27] << 8) | data[28]),
            p: Array.from({ length: data[29] }, (_, i) => (data[30 + 2 * i] << 8) | data[31 + 2 * i]),
            hz: rawHz(),
          }
        : undefined,
      localTime: Date.now(),
    };
    if (!syncDelta) syncDelta = r.localTime - r.millis;
    // The device reports its algorithm in every reading, so keep it in sync even if the config
    // dump hasn't arrived yet.
    if (configLoaded && data[7] !== Number(config.vibration_mode) && [1, 2, 3].includes(data[7])) {
      config.vibration_mode = data[7];
    }
    if (BTLEDconnected && btledComponent) {
      btledComponent.writeRGB(data[10], data[11], data[12]).catch((err: any) => console.error("Failed to write RGB:", err));
    }
    pushReading(r);
  }

  function handleBtConfig(value: DataView) {
    const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let end = data.indexOf(0);
    if (end < 0) end = data.length;
    // Each notification is a slice of the config JSON without its braces.
    const json = "{" + new TextDecoder().decode(data.slice(0, end)) + "}";
    try {
      applyConfig(JSON.parse(json));
    } catch (error) {
      console.error("Error parsing config JSON:", error, json);
    }
  }

  async function btConnect() {
    connecting = "bt";
    try {
      await BleClient.initialize();
      const device = await BleClient.requestDevice({ namePrefix: "EOM", optionalServices: [BT_SERVICE_UUID] });
      btDeviceId = device.deviceId;
      await BleClient.connect(device.deviceId, onBtDisconnected);
      lastConnection = "bt";
      await BleClient.startNotifications(device.deviceId, BT_SERVICE_UUID, BT_READINGS_CHAR, handleBtReading);
      socket?.close();
      isWsConnected = false;
      isBtConnected = true;
      await BleClient.startNotifications(device.deviceId, BT_SERVICE_UUID, BT_CONFIG_CHAR, handleBtConfig);
      await btWrite(new Uint8Array([BT_CMD_GET_CONFIG]));
      connectDialog?.close();
      showToast(`Connected to ${device.name ?? "EOM"}`);
    } catch (error: any) {
      console.error("Bluetooth connection error:", error);
      isBtConnected = false;
      btDeviceId = null;
      const text = String(error?.message ?? error);
      if (!/cancel/i.test(text)) showToast(`Bluetooth: ${text}`, "error");
    } finally {
      connecting = null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Toys follow the EOM's readings

  // A new safety stop stops every toy instead.
  function updateDevices(r: Reading) {
    toys.follow(r, maxDenied).catch(logToyError);
  }

  // Losing the EOM connection stops every toy, so none is left running at its last level.
  $effect(() => {
    toys.eomConnected(connected).catch(logToyError);
  });

  // ---------------------------------------------------------------------------------------------
  // Chart

  let chartCanvas = $state<HTMLCanvasElement>();
  let chartScheduled = false;
  const CHART_LINES = [
    { key: "pleasure", label: "Pleasure", color: "--pleasure", width: 2.5 },
    { key: "arousal", label: "Arousal", color: "--arousal", width: 2.5 },
    { key: "threshold", label: "Edge threshold", color: "--arousal", width: 1.5, dash: [6, 6] },
    { key: "denied", label: "Denials", color: "--denied", width: 2 },
    { key: "pressure", label: "Pressure", color: "--pressure", width: 1.5 },
    { key: "hr", label: "Heart rate (40–200 bpm)", color: "--heart", width: 2 },
  ];
  let chartLines = $derived(CHART_LINES.filter((l) => l.key !== "hr" || ringConnected));

  function lineValue(r: Reading, key: string): number {
    switch (key) {
      case "pleasure": return (r.motor / PLEASURE_MAX) * MAX_Y;
      case "denied": return ((r.denied ?? 0) / maxDenied) * MAX_Y;
      case "hr": return hrFraction(r.hr ?? 0) * MAX_Y;
      default: return (r as any)[key] ?? 0;
    }
  }

  function scheduleChartUpdate() {
    if (chartScheduled || view !== "chart") return;
    chartScheduled = true;
    requestAnimationFrame(() => {
      chartScheduled = false;
      drawChart();
    });
  }

  function drawChart() {
    const canvas = chartCanvas;
    if (!canvas || view !== "chart") return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(canvas);
    const color = (v: string) => css.getPropertyValue(v).trim() || "#fff";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 36, r: 8, t: 8, b: 22 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const y = (v: number) => pad.t + plotH - (Math.max(0, Math.min(MAX_Y, v)) / MAX_Y) * plotH;

    // Danger tint while edging/cooling down
    if (onCooldown || aroused) {
      ctx.fillStyle = color("--danger-tint");
      ctx.fillRect(pad.l, pad.t, plotW, plotH);
    }

    // Grid
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const gy = y((MAX_Y * i) / 4);
      ctx.strokeStyle = color("--line");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(w - pad.r, gy);
      ctx.stroke();
      ctx.fillStyle = color("--muted");
      ctx.fillText(`${i * 25}%`, pad.l - 6, gy);
    }

    // Downsample to at most ~2 points per pixel
    const step = Math.max(1, Math.ceil(history.length / (plotW * 2)));
    const pts = history.filter((_, i) => i % step === 0 || i === history.length - 1);
    if (pts.length < 2) return;
    const t0 = pts[0].localTime;
    const span = Math.max(1, pts[pts.length - 1].localTime - t0);
    const x = (r: Reading) => pad.l + ((r.localTime - t0) / span) * plotW;

    // Time axis: seconds before the latest reading, with faint vertical grid lines.
    const tEnd = pts[pts.length - 1].localTime;
    const every = [1, 2, 5, 10, 15, 30, 60, 120].find((s) => span / 1000 / s <= 6) ?? 300;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let s = 0; s * 1000 <= span; s += every) {
      const gx = pad.l + ((tEnd - s * 1000 - t0) / span) * plotW;
      ctx.strokeStyle = color("--line");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, pad.t + plotH);
      ctx.stroke();
      ctx.fillStyle = color("--muted");
      const label = s === 0 ? "now" : s >= 60 && s % 60 === 0 ? `−${s / 60}m` : `−${s}s`;
      ctx.fillText(label, Math.min(gx, w - pad.r - 12), pad.t + plotH + 6);
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const line of chartLines) {
      ctx.strokeStyle = color(line.color);
      ctx.lineWidth = line.width;
      ctx.setLineDash(line.dash ?? []);
      ctx.beginPath();
      // Heart rate has gaps (finger out, ring settling): start a new segment after each one.
      let pen = false;
      for (const r of pts) {
        if (line.key === "hr" && !r.hr) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x(r), y(lineValue(r, line.key)));
        else ctx.moveTo(x(r), y(lineValue(r, line.key)));
        pen = true;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  $effect(() => {
    if (view === "chart" && chartCanvas) {
      const ro = new ResizeObserver(() => drawChart());
      ro.observe(chartCanvas);
      return () => ro.disconnect();
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Keep the screen on while connected

  let wakeLock: any = null;
  async function updateWakeLock() {
    const want = prefs.keepAwake && connected && document.visibilityState === "visible";
    try {
      if (want && !wakeLock && "wakeLock" in navigator) {
        wakeLock = await (navigator as any).wakeLock.request("screen");
        wakeLock.addEventListener("release", () => (wakeLock = null));
      } else if (!want && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (err) {
      console.warn("Wake lock unavailable:", err);
    }
  }
  $effect(() => {
    void prefs.keepAwake;
    void connected;
    updateWakeLock();
  });

  onMount(() => {
    document.addEventListener("visibilitychange", updateWakeLock);

    // Reconnect when the data goes stale.
    refreshSessions();
    const staleTimer = setInterval(() => {
      recorder.tick();
      recording = recorder.recording;
      if (!connected || Date.now() - latest.localTime < 10000) return;
      console.log("Data is stale…dropped connection?");
      if (lastConnection === "ws" && isWsConnected) {
        connectWebSocket(prefs.wsUrl);
      } else if (isBtConnected) {
        btDisconnect();
        showToast("Lost the Bluetooth connection", "error");
      }
    }, 5000);

    return () => {
      clearInterval(staleTimer);
      document.removeEventListener("visibilitychange", updateWakeLock);
    };
  });

  const SETTINGS_TABS = [
    { id: "session", label: "Session", groups: ["session"] },
    { id: "stimulation", label: "Stimulation", groups: ["stimulation"] },
    { id: "detection", label: "Detection", groups: ["detection"] },
    { id: "clench", label: "Clench", groups: ["clench"] },
    { id: "safety", label: "Safety", groups: ["safety"] },
    { id: "heartrate", label: "Heart rate", groups: ["heartrate"] },
    { id: "network", label: "Connectivity", groups: ["wifi", "bluetooth"] },
    { id: "app", label: "App", groups: [] },
    { id: "device", label: "Device", groups: [] },
  ];

  let quickKeys = $derived(
    runMode === "ORGASM" ? ["auto_edging_duration_minutes", "max_denied", "after_orgasm", ...QUICK_SETTINGS] : QUICK_SETTINGS,
  );
</script>

{#snippet settingList(keys: string[])}
  {#each keys as key (key)}
    {@const def = SETTINGS_BY_KEY[key]}
    {#if def && (!def.visible || def.visible(config))}
      <SettingControl {def} value={config[key]} disabled={locked} onchange={changeSetting} />
    {/if}
  {/each}
{/snippet}

{#snippet icon(name: string)}
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if name === "bt"}
      <path d="m7 7 10 10-5 5V2l5 5L7 17" />
    {:else if name === "wifi"}
      <path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="0.5" fill="currentColor" />
    {:else if name === "settings"}
      <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    {:else if name === "toys"}
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    {:else if name === "gauges"}
      <path d="M12 14l4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" />
    {:else if name === "chart"}
      <path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" />
    {:else if name === "stop"}
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    {:else if name === "close"}
      <path d="M18 6 6 18M6 6l12 12" />
    {:else if name === "history"}
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
    {:else if name === "lock"}
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    {/if}
  </svg>
{/snippet}

<div class="app" class:native={isNativeMobile}>
  <!-- Header -->
  <header class="topbar">
    <div class="brand">
      <span class="logo">EOM</span>
      <button
        class="chip"
        class:ok={connected}
        onclick={() => connectDialog?.showModal()}
        title="Connection"
      >
        <span class="dot"></span>
        {#if connecting}
          Connecting…
        {:else if isBtConnected}
          Bluetooth
        {:else if isWsConnected}
          Wi-Fi
        {:else}
          Not connected
        {/if}
      </button>
    </div>
    {#if toyStrip.length > 0}
      <ul class="toyStrip" aria-label="Connected toys">
        {#each toyStrip as toy (toy.key)}
          <li class="toyPill">
            <button class="toyInfo" onclick={() => toysDialog?.showModal()} title="Open Toys">
              <span class="toyName">{toy.name}</span>
              <span class="toyFollows">{followsText(toy.follows)}</span>
            </button>
            <span class="toyStrength">{toy.strength}%</span>
            <button
              class="iconBtn toyStop"
              aria-label="Stop {toy.name}"
              title="Stop {toy.name} and switch it to Manual"
              onclick={() => toys.stop(toy.key).catch(logToyError)}>{@render icon("stop")}</button
            >
          </li>
        {/each}
        {#if toyStrip.length > 1}
          <li><button class="small stopAllToys" onclick={() => toys.stopAll().catch(logToyError)}>Stop all toys</button></li>
        {/if}
      </ul>
    {/if}
    <nav class="actions">
      <button class="iconBtn" class:rec={recording} onclick={() => { refreshSessions(); historyDialog?.showModal(); }} aria-label="History" title={recording ? "History (recording)" : "History"}>
        {@render icon("history")}
      </button>
      <button class="iconBtn" onclick={() => toysDialog?.showModal()} aria-label="Toys" title="Toys">
        {@render icon("toys")}
      </button>
      <button class="iconBtn" onclick={() => settingsDialog?.showModal()} aria-label="Settings" title="Settings">
        {@render icon("settings")}
      </button>
    </nav>
  </header>

  {#if !connected && !connecting}
    <section class="card connectCard">
      <div>
        <h2>Connect to your EOM</h2>
        <p class="muted">Use Bluetooth, or Wi-Fi if the EOM hosts a network or is on yours. You can explore the controls without a connection.</p>
      </div>
      <div class="btnRow">
        <button class="primary" onclick={btConnect}>{@render icon("bt")} Bluetooth</button>
        <button onclick={() => connectDialog?.showModal()}>{@render icon("wifi")} Wi-Fi</button>
      </div>
    </section>
  {/if}

  {#if locked}
    <div class="banner warn">{@render icon("lock")} Settings are locked until this Orgasm session ends.</div>
  {/if}
  {#if safetyMessage && connected}
    <div class="banner warn">{safetyMessage}</div>
  {/if}
  {#if restartNeeded && connected}
    <div class="banner">
      Restart the EOM to apply connectivity changes.
      <button class="small" onclick={restartDevice}>Restart</button>
    </div>
  {/if}

  <main class="layout">
    <!-- Live status -->
    <section class="card live">
      <div class="statusRow">
        <div class="status tone-{status.tone}" aria-live="polite">
          <span class="statusTitle">{status.title}</span>
          <span class="statusDetail">{status.detail}</span>
        </div>
        <div class="segmented viewSwitch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "gauges"} class:active={view === "gauges"} onclick={() => (view = "gauges")} aria-label="Gauges">{@render icon("gauges")}</button>
          <button role="tab" aria-selected={view === "chart"} class:active={view === "chart"} onclick={() => { view = "chart"; scheduleChartUpdate(); }} aria-label="Chart">{@render icon("chart")}</button>
        </div>
      </div>

      {#if view === "gauges"}
        <div class="gauges">
          <Gauge
            label="Pleasure"
            color="var(--pleasure)"
            fraction={currentPleasure / PLEASURE_MAX}
            text="{pct(currentPleasure, PLEASURE_MAX)}%"
            markers={[{ at: Number(config.max_pleasure) / PLEASURE_MAX, color: "var(--text)", title: "Maximum intensity" }]}
            pulse={runMode !== "MANUAL" && !onCooldown && latest.motor > 0}
          >
            {#snippet action()}
              <button class="small" onclick={fullStop} title="Switch to manual and stop">Stop</button>
            {/snippet}
          </Gauge>
          <Gauge
            label="Arousal"
            color="var(--arousal)"
            fraction={latest.arousal / MAX_Y}
            text="{pct(latest.arousal, MAX_Y)}%"
            markers={[
              { at: Number(config.mid_threshold) / MAX_Y, color: "var(--warn)", title: "Warning threshold" },
              { at: latest.threshold / MAX_Y, color: "var(--arousal)", title: "Edge threshold" },
              ...(latest.hrZone ? [{ at: edgeThreshold / MAX_Y, color: "var(--heart)", title: "Edge threshold, lowered by heart rate" }] : []),
            ]}
            pulse={onCooldown}
          >
            {#snippet action()}
              <button class="small" onclick={() => sendCommand("triggerArousal")} title="Start a cooldown now">Trigger edge</button>
            {/snippet}
          </Gauge>
          <Gauge
            label={deniedLabel}
            color="var(--denied)"
            fraction={(latest.denied ?? 0) / maxDenied}
            text={String(latest.denied ?? 0)}
            pulse={onCooldown}
          >
            {#snippet action()}
              <button class="small" onclick={() => sendCommand("resetDenied")} title="Reset the count">Reset</button>
            {/snippet}
          </Gauge>
          <Gauge
            label="Pressure"
            color="var(--pressure)"
            fraction={latest.pressure / MAX_Y}
            text="{pct(latest.pressure, MAX_Y)}%"
          >
            {#snippet action()}
              <button class="small" onclick={applyPressure} title="Shorter ramp and cooldown, higher threshold">Apply pressure</button>
            {/snippet}
          </Gauge>
          {#if ringConnected}
            <Gauge
              label="Heart rate"
              color="var(--heart)"
              fraction={heart?.hr ? hrFraction(heart.hr) : 0}
              text={heartText}
            />
          {/if}
          {#if showOrgasms}
            <Gauge
              label="Orgasms"
              color="var(--orgasm)"
              fraction={(latest.orgasms ?? 0) / orgasmScale}
              text={orgasmsText}
              pulse={latest.phase === PHASE_POST_ORGASM}
            />
          {/if}
        </div>
      {:else}
        <div class="chartWrap">
          <canvas bind:this={chartCanvas} class="chart" aria-label="Live readings chart"></canvas>
          <ul class="legend">
            {#each chartLines as line}
              <li><span class="swatch" class:dashed={line.dash} style="--c: var({line.color})"></span>{line.key === "denied" && deniedLabel === "Orgasms" ? "Orgasms" : line.label}</li>
            {/each}
          </ul>
          <div class="chartStats">
            <button class="stat" style="--c: var(--pleasure)" onclick={fullStop}>Pleasure <b>{pct(latest.motor, PLEASURE_MAX)}%</b></button>
            <button class="stat" style="--c: var(--arousal)" onclick={() => sendCommand("triggerArousal")}>Arousal <b>{pct(latest.arousal, MAX_Y)}%</b></button>
            <button class="stat" style="--c: var(--denied)" onclick={() => sendCommand("resetDenied")}>{deniedLabel} <b>{latest.denied ?? 0}</b></button>
            <button class="stat" style="--c: var(--pressure)" onclick={applyPressure}>Pressure <b>{pct(latest.pressure, MAX_Y)}%</b></button>
            {#if showOrgasms}
              <span class="stat" style="--c: var(--orgasm)">Orgasms <b>{orgasmsText}</b></span>
            {/if}
            {#if ringConnected}
              <span class="stat" style="--c: var(--heart)">Heart rate <b>{heartText}</b></span>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <!-- Toy strip: every connected toy at a glance, while any is connected -->
    <!-- Controls -->
    <section class="card controls">
      <div class="field">
        <span class="fieldLabel">Mode</span>
        <div class="segmented" role="radiogroup" aria-label="Mode">
          {#each RUN_MODES as mode}
            <button role="radio" aria-checked={runMode === mode} class:active={runMode === mode} onclick={() => setRunMode(mode)}>
              {RUN_MODE_LABELS[mode]}
            </button>
          {/each}
        </div>
      </div>

      {#if runMode === "MANUAL"}
        <div class="field">
          <div class="fieldHead">
            <label class="fieldLabel" for="manualPleasure">Intensity</label>
            <span class="pill" style="color: var(--pleasure)">{pct(currentPleasure, PLEASURE_MAX)}%</span>
          </div>
          <input
            id="manualPleasure"
            class="bigSlider"
            type="range"
            min="0"
            max={Number(config.max_pleasure)}
            step="1"
            bind:value={currentPleasure}
            style="--fill: {(currentPleasure / Math.max(1, Number(config.max_pleasure))) * 100}%"
            oninput={() => {
              pleasureLockedUntil = Date.now() + 500;
              throttledSetMotor(currentPleasure);
            }}
          />
        </div>
      {:else}
        <div class="field">
          <span class="fieldLabel">Algorithm</span>
          <div class="segmented" role="radiogroup" aria-label="Algorithm">
            {#each SETTINGS_BY_KEY.vibration_mode.options ?? [] as opt}
              {#if runMode !== "ORGASM" || opt.value !== ENHANCEMENT}
                <button
                  role="radio"
                  aria-checked={config.vibration_mode === opt.value}
                  class:active={config.vibration_mode === opt.value}
                  disabled={locked}
                  onclick={() => changeSetting("vibration_mode", opt.value)}>{opt.label}</button
                >
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if prefs.pressureSim}
        <div class="field">
          <div class="fieldHead">
            <label class="fieldLabel" for="simPressure">Simulated pressure</label>
            <span class="pill">{pct(simPressure, MAX_Y)}%</span>
          </div>
          <input
            id="simPressure"
            class="bigSlider"
            type="range"
            min="0"
            max={MAX_Y - 1}
            step="16"
            bind:value={simPressure}
            style="--fill: {(simPressure / MAX_Y) * 100}%"
            onchange={() => sendSimPressure(simPressure)}
          />
          <button
            class:active={simClenching}
            onpointerdown={() => setSimClench(true)}
            onpointerup={() => setSimClench(false)}
            onpointerleave={() => setSimClench(false)}
            onpointercancel={() => setSimClench(false)}>Hold to clench</button
          >
        </div>
      {/if}

      <button class="stopBtn" onclick={fullStop}>{@render icon("stop")} Stop now</button>
    </section>

    <!-- Quick settings -->
    <section class="card quick">
      <div class="cardHead">
        <h2>Quick settings</h2>
        <button class="link" onclick={() => { settingsTab = "session"; settingsDialog?.showModal(); }}>All settings</button>
      </div>
      {@render settingList(quickKeys)}
    </section>
  </main>
</div>

<!-- Connection dialog -->
<dialog class="sheet narrow" bind:this={connectDialog} onclick={(e) => e.target === connectDialog && connectDialog?.close()}>
  <div class="sheetHead">
    <h2>Connection</h2>
    <button class="iconBtn" onclick={() => connectDialog?.close()} aria-label="Close">{@render icon("close")}</button>
  </div>
  <div class="sheetBody">
    <section class="group">
      <h3>{@render icon("bt")} Bluetooth</h3>
      {#if isBtConnected}
        <p class="muted">Connected.</p>
        <button onclick={btDisconnect}>Disconnect</button>
      {:else}
        <p class="muted">Finds devices whose name starts with EOM.</p>
        <button class="primary" onclick={btConnect} disabled={connecting === "bt"}>
          {connecting === "bt" ? "Connecting…" : "Connect over Bluetooth"}
        </button>
      {/if}
    </section>
    <section class="group">
      <h3>{@render icon("wifi")} Wi-Fi</h3>
      <p class="muted">
        Default is <code>ws://192.168.4.1/</code> on the EOM's own network, or <code>ws://{config.hostname || "eom"}.local/</code> on yours.
        This page is served over {location.protocol === "https:" ? "https, so it needs wss://" : "http, so ws:// works"}.
      </p>
      <form
        class="urlRow"
        onsubmit={(e) => {
          e.preventDefault();
          connectWebSocket(wsUrlDraft);
        }}
      >
        <input type="text" bind:value={wsUrlDraft} aria-label="WebSocket address" autocapitalize="off" spellcheck="false" />
        {#if isWsConnected}
          <button type="button" onclick={disconnectWebSocket}>Disconnect</button>
        {:else}
          <button class="primary" type="submit" disabled={connecting === "ws"}>{connecting === "ws" ? "…" : "Connect"}</button>
        {/if}
      </form>
    </section>
    <section class="group">
      <h3>Heart rate</h3>
      {#if ringConnected}
        <p class="muted">
          {ringName}: {heartText}{#if heart?.spo2}, SpO2 {heart.spo2}%{/if}{#if heart}, battery {heart.battery}%{/if}.
        </p>
        <button onclick={ringDisconnect}>Disconnect</button>
      {:else}
        <p class="muted">
          Optional. Connect a Wellue/Viatom O2Ring (also sold as the SleepHQ O2 Ring Pro) to show and record heart rate.
          Close the ring's own app first, then pick the ring from the list. Works with or without the EOM connected.
        </p>
        <button class="primary" onclick={ringConnect} disabled={ringConnecting}>
          {ringConnecting ? "Connecting…" : "Connect O2Ring"}
        </button>
      {/if}
    </section>
  </div>
</dialog>

<!-- Settings drawer -->
<dialog class="sheet" bind:this={settingsDialog} onclick={(e) => e.target === settingsDialog && settingsDialog?.close()}>
  <div class="sheetHead">
    <h2>Settings</h2>
    <button class="iconBtn" onclick={() => settingsDialog?.close()} aria-label="Close">{@render icon("close")}</button>
  </div>
  <div class="tabs" role="tablist">
    {#each SETTINGS_TABS as tab}
      <button role="tab" aria-selected={settingsTab === tab.id} class:active={settingsTab === tab.id} onclick={(e) => {
        settingsTab = tab.id;
        e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
      }}>{tab.label}</button>
    {/each}
  </div>
  <div class="sheetBody">
    {#if !connected}
      <div class="banner">Not connected — showing defaults. Changes apply once you connect.</div>
    {:else if !configLoaded}
      <div class="banner">Loading settings from the device…</div>
    {/if}
    {#if locked}
      <div class="banner warn">{@render icon("lock")} Locked until this Orgasm session ends.</div>
    {/if}

    {#each SETTINGS_TABS as tab}
      <!-- Inactive tabs stay mounted (hidden) so a firmware update keeps running when switching. -->
      <div role="tabpanel" hidden={settingsTab !== tab.id}>
        {#if tab.id === "session"}
          <section class="group">
            <h3>Presets</h3>
            <p class="muted">Save the Session, Stimulation, Detection, Clench and Heart rate settings under a name, and load them later. Saved in this browser only.</p>
            <PresetPicker
              {config}
              canSave={configLoaded}
              canLoad={connected && configLoaded && !locked}
              change={(key, value) => changeSetting(key, value, true)}
              notify={showToast}
            />
          </section>
        {/if}
        {#each tab.groups as groupId}
          {@const group = SETTING_GROUPS.find((g) => g.id === groupId)}
          {#if group}
            <section class="group">
              <h3>{group.title}</h3>
              {#if group.description}<p class="muted">{group.description}</p>{/if}
              {@render settingList(group.keys)}
            </section>
          {/if}
        {/each}

        {#if tab.id === "detection"}
          <section class="group">
            <h3>Calibration</h3>
            <dl class="facts">
              <dt>Resting pressure</dt>
              <dd>
                {hasBaseline ? `${pct(latest.baseline ?? 0, MAX_Y)}%` : "Needs newer firmware"}
                {#if drift !== null}<span class="muted"> ({drift >= 0 ? "+" : "−"}{pct(Math.abs(drift), MAX_Y)}% this session)</span>{/if}
              </dd>
              <dt>Edge threshold</dt><dd>{pct(latest.threshold, MAX_Y)}%</dd>
            </dl>
            <p class="muted">{suggestion.reason}</p>
            {#if suggestion.threshold !== null}
              <div class="prefRow">
                <span><b>Suggested threshold: {pct(suggestion.threshold, MAX_Y)}%</b><small>From {suggestion.sessions} recorded session{suggestion.sessions === 1 ? "" : "s"}.</small></span>
                <button class="small" disabled={locked} onclick={() => changeSetting("sensitivity_threshold", suggestion.threshold!)}>Apply</button>
              </div>
            {/if}
          </section>
        {/if}

        {#if tab.id === "heartrate"}
          <section class="group">
            <h3>Suggested from your history</h3>
            <dl class="facts">
              <dt>Heart rate now</dt>
              <dd>
                {ringConnected ? heartText : "No O2Ring connected"}
                {#if latest.hrZone}<span class="muted"> (edge zone)</span>{/if}
              </dd>
            </dl>
            {#if hrSuggestion.suggestions.length === 0}
              <p class="muted">
                {hrSuggestion.sessions === 0
                  ? "Record a few sessions with the O2Ring connected, then suggestions appear here."
                  : "Not enough edges or orgasms with a heart rate recorded yet. Keep recording sessions with the O2Ring connected."}
              </p>
            {:else}
              <p class="muted">From {hrSuggestion.sessions} recorded session{hrSuggestion.sessions === 1 ? "" : "s"} with a heart rate.</p>
              {#each hrSuggestion.suggestions as sug (sug.key)}
                <div class="prefRow">
                  <span>
                    <b>{SETTINGS_BY_KEY[sug.key].label}: {formatSetting(SETTINGS_BY_KEY[sug.key], sug.value)}</b>
                    <small>{sug.reason} Now: {formatSetting(SETTINGS_BY_KEY[sug.key], config[sug.key])}.</small>
                  </span>
                  <button class="small" disabled={locked || config[sug.key] === sug.value} onclick={() => changeSetting(sug.key, sug.value)}>Apply</button>
                </div>
              {/each}
            {/if}
          </section>
        {/if}

        {#if tab.id === "network"}
          <section class="group">
            <button onclick={restartDevice} disabled={!connected}>Restart device</button>
          </section>
        {/if}

        {#if tab.id === "app"}
          <section class="group">
            <h3>This app</h3>
            <p class="muted">Saved in this browser only.</p>
            <div class="prefRow">
              <span><b>Start in</b><small>Which view opens first.</small></span>
              <div class="segmented">
                <button class:active={prefs.defaultView === "gauges"} onclick={() => (prefs.defaultView = "gauges")}>Gauges</button>
                <button class:active={prefs.defaultView === "chart"} onclick={() => (prefs.defaultView = "chart")}>Chart</button>
              </div>
            </div>
            <label class="prefRow">
              <span><b>Keep screen on</b><small>While connected, so the screen doesn't lock mid-session.</small></span>
              <input type="checkbox" class="check" bind:checked={prefs.keepAwake} />
            </label>
            <label class="prefRow">
              <span><b>Record sessions</b><small>Keep a history of sessions in this browser, for the History view and threshold suggestions.</small></span>
              <input type="checkbox" class="check" bind:checked={prefs.recordSessions} />
            </label>
            <label class="prefRow">
              <span><b>Detailed recording</b><small>Also record the raw pressure at full speed (50 times a second) for each session, for a detailed CSV export. Needs firmware 3.6.0. Uses more storage.</small></span>
              <input type="checkbox" class="check" bind:checked={prefs.detailedRecording} disabled={!prefs.recordSessions} />
            </label>
            <label class="prefRow">
              <span><b>Pressure simulator</b><small>Test without a sensor. Needs firmware built with EOM_PRESSURE_SIM.</small></span>
              <input
                type="checkbox"
                class="check"
                bind:checked={prefs.pressureSim}
                onchange={() => sendSimPressure(prefs.pressureSim ? simPressure : -1)}
              />
            </label>
            <div class="prefRow column">
              <span><b>Apply pressure step</b><small>How much "Apply pressure" raises the edge threshold.</small></span>
              <div class="inline">
                <input type="range" class="bigSlider" min="16" max="512" step="16" bind:value={prefs.pressureStep} style="--fill: {((prefs.pressureStep - 16) / 496) * 100}%" />
                <span class="pill">+{pct(prefs.pressureStep, MAX_Y)}%</span>
              </div>
            </div>
          </section>
          <section class="group">
            <h3>Display</h3>
            {@render settingList(["chart_window_s"])}
          </section>
        {/if}

        {#if tab.id === "device"}
          <section class="group">
            <h3>About</h3>
            <dl class="facts">
              <dt>Connection</dt><dd>{isBtConnected ? "Bluetooth" : isWsConnected ? `Wi-Fi (${prefs.wsUrl})` : "None"}</dd>
              {#if fwVersion}<dt>Firmware</dt><dd>{fwVersion}</dd>{/if}
              <dt>Algorithm</dt><dd>{formatSetting(SETTINGS_BY_KEY.vibration_mode, config.vibration_mode)}</dd>
            </dl>
            <button onclick={restartDevice} disabled={!connected}>Restart device</button>
          </section>
          <section class="group">
            <h3>Advanced</h3>
            {@render settingList(SETTING_GROUPS.find((g) => g.id === "advanced")?.keys ?? [])}
          </section>
          <section class="group">
            <FirmwareUpdate link={updateLink} />
          </section>
        {/if}
      </div>
    {/each}
  </div>
</dialog>

<!-- History drawer -->
<dialog class="sheet" bind:this={historyDialog} onclick={(e) => e.target === historyDialog && historyDialog?.close()}>
  <div class="sheetHead">
    <h2>History</h2>
    <button class="iconBtn" onclick={() => historyDialog?.close()} aria-label="Close">{@render icon("close")}</button>
  </div>
  <div class="sheetBody">
    <SessionHistory {sessions} {recording} onchange={refreshSessions} />
  </div>
</dialog>

<!-- Toys drawer -->
<dialog class="sheet" bind:this={toysDialog} onclick={(e) => e.target === toysDialog && toysDialog?.close()}>
  <div class="sheetHead">
    <h2>Toys <span class="badge">Beta</span></h2>
    <button class="iconBtn" onclick={() => toysDialog?.close()} aria-label="Close">{@render icon("close")}</button>
  </div>
  <div class="sheetBody">
    <section class="group">
      <h3>Toys</h3>
      <p class="muted">Each toy control follows the EOM's pleasure, arousal, pressure or denials, or is set by hand. Stop stops every toy.</p>
      <DeviceList bind:deviceList {toys} />
    </section>
    <section class="group ossm">
      <h3>OSSM</h3>
      <OSSM bind:this={ossmComponent} bind:devices={ossmDevices} {toys} />
    </section>
    <section class="group">
      <h3>Lights</h3>
      <BTLED bind:this={btledComponent} bind:BTLEDconnected />
    </section>
  </div>
</dialog>

{#if toast}
  <!-- A popover sits in the top layer, so the toast also shows above open dialogs. -->
  <div class="toast" class:error={toast.tone === "error"} role="status" popover="manual" {@attach (el) => el.showPopover?.()}>
    {toast.text}
  </div>
{/if}

<style>
  .app {
    width: 100%;
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 16px calc(24px + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }
  .app.native {
    padding-top: 40px;
  }

  /* Header */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: calc(10px + env(safe-area-inset-top)) 0 10px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: blur(12px);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .logo {
    font-weight: 800;
    font-size: 1.3rem;
    letter-spacing: 0.06em;
    background: linear-gradient(135deg, var(--accent), var(--pleasure));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 32px;
    padding: 0 0.8rem;
    border-radius: 999px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .chip.ok {
    color: var(--text);
  }
  .chip.ok .dot {
    background: var(--pressure);
    box-shadow: 0 0 8px var(--pressure);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }

  /* Cards and layout */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  @media (min-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    }
    .live {
      grid-row: span 2;
      align-self: start;
    }
  }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 18px;
    min-width: 0;
  }
  .card h2 {
    font-size: 1.05rem;
    margin: 0;
  }
  .cardHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .connectCard {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 16px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--surface-1)), var(--surface-1));
  }
  .connectCard p {
    margin: 0.25rem 0 0;
    max-width: 52ch;
  }
  .btnRow {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  /* Live status */
  .statusRow {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 8px;
  }
  .status {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .statusTitle {
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .statusDetail {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .tone-danger .statusTitle {
    color: var(--arousal);
  }
  .tone-warn .statusTitle {
    color: var(--warn);
  }
  .tone-success .statusTitle {
    color: var(--pressure);
  }
  .tone-accent .statusTitle {
    color: var(--pleasure);
  }
  .viewSwitch {
    flex: none;
  }
  .viewSwitch button {
    min-width: 44px;
  }

  .gauges {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 12px;
    padding-top: 8px;
  }
  @media (min-width: 640px) and (max-width: 899px) {
    .gauges {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .gauges:has(> :nth-child(5)) {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }
  /* In two columns, an odd one out (the Orgasms gauge or stat) gets the whole last row. */
  @media (max-width: 639px), (min-width: 900px) {
    .gauges > :last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }
  }
  @media (max-width: 639px) {
    .chartStats > :last-child:nth-child(odd) {
      grid-column: 1 / -1;
    }
  }

  .chartWrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chart {
    width: 100%;
    height: clamp(220px, 42vh, 460px);
    display: block;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
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
  .chartStats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  @media (min-width: 640px) {
    .chartStats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .chartStats:has(> :nth-child(5)) {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }
  .stat {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-left: 3px solid var(--c);
    font-size: 0.85rem;
    color: var(--muted);
  }
  .stat b {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  /* Controls */
  .controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fieldHead {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .fieldLabel {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .stopBtn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 52px;
    font-size: 1rem;
    font-weight: 700;
    background: var(--arousal);
    border-color: transparent;
    color: #fff;
  }
  .stopBtn:hover {
    background: color-mix(in srgb, var(--arousal) 85%, #fff);
  }

  .quick {
    padding-bottom: 6px;
  }

  /* Toy strip: compact pills in the header, so toys stay in view while scrolling.
     On a phone it takes its own row under the logo and buttons. */
  .topbar:has(.toyStrip) {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .toyStrip {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  @media (max-width: 639px) {
    .toyStrip {
      order: 3;
      flex-basis: 100%;
      justify-content: flex-start;
    }
  }
  .toyStrip > li {
    flex: none;
  }
  .toyPill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 240px;
    padding: 2px 2px 2px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface-1);
  }
  .toyInfo {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: 0;
    padding: 0;
    border: none;
    background: none;
    font-size: 0.85rem;
    line-height: 1.15;
    text-align: left;
  }
  .toyStrength {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent);
  }
  .toyStop {
    flex: none;
    width: 32px;
    min-height: 32px;
    border-radius: 999px;
    color: var(--arousal);
  }
  .toyStrip .stopAllToys {
    border-radius: 999px;
    white-space: nowrap;
  }
  .toyName,
  .toyFollows {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .toyName {
    font-weight: 600;
  }
  .toyFollows {
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--muted);
  }
  .iconBtn.rec {
    position: relative;
  }
  .iconBtn.rec::after {
    content: "";
    position: absolute;
    top: 7px;
    right: 7px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--arousal);
  }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0.25rem 0;
    font-weight: 600;
  }

  /* Dialogs: a right-hand drawer on wide screens, a bottom sheet on phones */
  .sheet {
    position: fixed;
    inset: 0 0 0 auto;
    margin: 0;
    width: min(480px, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    padding: 0;
    border: none;
    border-left: 1px solid var(--line);
    background: var(--surface-1);
    color: var(--text);
    flex-direction: column;
  }
  .sheet[open] {
    display: flex;
    animation: slideIn 0.2s ease-out;
  }
  .sheet.narrow {
    width: min(420px, 100vw);
  }
  .sheet::backdrop {
    background: rgb(0 0 0 / 0.55);
    backdrop-filter: blur(2px);
  }
  @keyframes slideIn {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }
  @media (max-width: 640px) {
    .sheet,
    .sheet.narrow {
      inset: auto 0 0 0;
      width: 100vw;
      height: 92dvh;
      border-left: none;
      border-top: 1px solid var(--line);
      border-radius: 20px 20px 0 0;
    }
    @keyframes slideIn {
      from {
        transform: translateY(32px);
        opacity: 0;
      }
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet[open] {
      animation: none;
    }
  }
  .sheetHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(14px + env(safe-area-inset-top)) 16px 10px;
  }
  .sheetHead h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  .sheetBody {
    flex: 1;
    overflow-y: auto;
    padding: 4px 16px calc(24px + env(safe-area-inset-bottom));
    overscroll-behavior: contain;
  }
  .tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 0 16px 10px;
    border-bottom: 1px solid var(--line);
    scrollbar-width: none;
  }
  .tabs button {
    flex: none;
    min-height: 34px;
    border-radius: 999px;
    padding: 0 14px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    background: transparent;
    border-color: var(--line);
  }
  .tabs button.active {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .group {
    padding: 12px 0;
  }
  .group h3 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 4px;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .group > p {
    margin: 0 0 8px;
  }
  .group + .group {
    border-top: 1px solid var(--line);
  }
  .urlRow {
    display: flex;
    gap: 0.5rem;
  }
  .urlRow input {
    flex: 1;
    min-width: 0;
    min-height: 42px;
    padding: 0 0.75rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  code {
    font-size: 0.8rem;
    background: var(--surface-3);
    padding: 0.05rem 0.35rem;
    border-radius: 6px;
  }
  .prefRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .prefRow.column {
    flex-direction: column;
    align-items: stretch;
  }
  .prefRow span {
    display: flex;
    flex-direction: column;
  }
  .prefRow small {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .inline {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 0.75rem;
  }
  .check {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 8px 0 14px;
    font-size: 0.9rem;
  }
  .facts dt {
    color: var(--muted);
  }
  .facts dd {
    margin: 0;
    word-break: break-all;
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 6px;
    background: var(--surface-3);
    color: var(--muted);
    vertical-align: middle;
  }
  /* The OSSM panel is our own code now (ADR 0010). Its frame, connect button and error
     are fitted to the drawer here; restyle its inside in OSSM.svelte. */
  .ossm :global(.bluetooth-ossm-control) {
    width: auto;
    margin: 52px 0 44px;
    border-color: var(--line);
    border-radius: 14px;
    background: var(--surface-2);
  }
  .ossm :global(.bluetooth-ossm-control > div > p) {
    color: var(--muted);
  }
  .ossm :global(.bluetooth-ossm-control > div > button) {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }
  .ossm :global(.bluetooth-ossm-control > div[style*="#c00"]) {
    color: var(--arousal) !important;
    font-weight: 400 !important;
    background: var(--danger-tint) !important;
    border-color: color-mix(in srgb, var(--arousal) 40%, transparent) !important;
    border-radius: 14px !important;
    font-size: 0.9rem;
  }

  .toast {
    position: fixed;
    inset: auto;
    margin: 0;
    border: none;
    left: 50%;
    bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    max-width: calc(100vw - 32px);
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--surface-3);
    color: var(--text);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
    font-size: 0.9rem;
  }
  .toast.error {
    background: color-mix(in srgb, var(--arousal) 30%, var(--surface-2));
  }
</style>
