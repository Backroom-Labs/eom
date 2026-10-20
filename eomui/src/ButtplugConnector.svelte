<script lang="ts">
  import { onMount } from "svelte";
  import { ButtplugWasmClientConnector } from "buttplug-wasm";
  import { ButtplugClient, ButtplugClientDevice, OutputType, InputType } from "buttplug";
  import { BleClient } from "@capacitor-community/bluetooth-le";
  import { DEFAULT_MIN, DEFAULT_MAX, disconnectToy, toyLevels, type ToyFeature } from "./lib/toyOutput";
  import { buttplugToy, type ButtplugToy, type ToyList } from "./lib/toyList";
  import { FOLLOWS, percent255, setRangeEnd, toyControlHelp, toyLevelPercent } from "./lib/toyControlView";
  import SettingControl from "./lib/SettingControl.svelte";
  import type { SettingDef } from "./lib/settings";

  const isCapacitorNative =
    typeof window !== "undefined" &&
    typeof (window as any).Capacitor?.isNativePlatform === "function" &&
    (window as any).Capacitor.isNativePlatform();

  const hasWebBluetoothRequestDevice = () =>
    typeof navigator !== "undefined" &&
    typeof (navigator as any).bluetooth?.requestDevice === "function";

  // Capacitor Bluetooth LE wrapper classes
  const normalizeUuid = (uuid: string) => `${uuid}`.toLowerCase();

  class CapacitorBluetoothRemoteGattCharacteristic extends EventTarget {
    deviceId: string;
    service: { uuid: string };
    uuid: string;
    value: any;
    oncharacteristicvaluechanged: ((evt: MessageEvent) => void) | null;
    private _notifying: boolean;

    constructor(deviceId: string, serviceUuid: string, characteristicUuid: string) {
      super();
      this.deviceId = deviceId;
      this.service = { uuid: serviceUuid };
      this.uuid = characteristicUuid;
      this.value = null;
      this.oncharacteristicvaluechanged = null;
      this._notifying = false;
    }

    async writeValue(value: any) {
      const array = value instanceof Uint8Array ? value : new Uint8Array(value);
      const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
      await BleClient.write(this.deviceId, this.service.uuid, this.uuid, view);
    }

    async readValue() {
      const view = await BleClient.read(this.deviceId, this.service.uuid, this.uuid);
      this.value = view;
      return view;
    }

    async startNotifications() {
      if (this._notifying) {
        return this;
      }
      await BleClient.startNotifications(
        this.deviceId,
        this.service.uuid,
        this.uuid,
        (value: any) => {
          this.value = value;
          const evt = new MessageEvent("characteristicvaluechanged");
          this.dispatchEvent(evt);
          if (typeof this.oncharacteristicvaluechanged === "function") {
            this.oncharacteristicvaluechanged(evt);
          }
        },
      );
      this._notifying = true;
      return this;
    }

    async stopNotifications() {
      if (!this._notifying) {
        return this;
      }
      await BleClient.stopNotifications(this.deviceId, this.service.uuid, this.uuid);
      this._notifying = false;
      return this;
    }
  }

  class CapacitorBluetoothRemoteGattService {
    deviceId: string;
    uuid: string;
    private _characteristics: Map<string, CapacitorBluetoothRemoteGattCharacteristic>;
    private _reportedCharacteristics: Set<string>;

    constructor(deviceId: string, serviceUuid: string, characteristics: any[] = []) {
      this.deviceId = deviceId;
      this.uuid = serviceUuid;
      this._characteristics = new Map();
      this._reportedCharacteristics = new Set(
        (characteristics || []).map((c: any) => normalizeUuid(c?.uuid ?? c)),
      );
    }

    async getCharacteristic(characteristicUuid: string) {
      const key = normalizeUuid(characteristicUuid);
      if (
        this._reportedCharacteristics.size > 0 &&
        !this._reportedCharacteristics.has(key)
      ) {
        throw new Error(
          `Characteristic ${key} not reported by service ${this.uuid} on device ${this.deviceId}`,
        );
      }
      if (!this._characteristics.has(key)) {
        this._characteristics.set(
          key,
          new CapacitorBluetoothRemoteGattCharacteristic(this.deviceId, this.uuid, key),
        );
      }
      return this._characteristics.get(key)!;
    }
  }

  class CapacitorBluetoothRemoteGattServer {
    deviceId: string;
    connected: boolean;
    private _services: Map<string, CapacitorBluetoothRemoteGattService>;

    constructor(deviceId: string, services: any[] = []) {
      this.deviceId = deviceId;
      this.connected = true;
      this._services = new Map();
      for (const service of services || []) {
        const serviceUuid = normalizeUuid(service?.uuid ?? service);
        this._services.set(
          serviceUuid,
          new CapacitorBluetoothRemoteGattService(
            this.deviceId,
            serviceUuid,
            service?.characteristics || [],
          ),
        );
      }
    }

    async getPrimaryService(serviceUuid: string) {
      const key = normalizeUuid(serviceUuid);
      if (!this._services.has(key)) {
        throw new Error(`Service ${key} not reported by device ${this.deviceId}`);
      }
      return this._services.get(key)!;
    }
  }

  class CapacitorBluetoothRemoteGatt {
    private _device: any;
    connected: boolean;
    private _server: CapacitorBluetoothRemoteGattServer | null;

    constructor(device: any) {
      this._device = device;
      this.connected = false;
      this._server = null;
    }

    async connect() {
      await BleClient.connect(this._device.id, () => this._device._emitDisconnected());
      const services = await BleClient.getServices(this._device.id);
      this.connected = true;
      this._server = new CapacitorBluetoothRemoteGattServer(this._device.id, services || []);
      return this._server;
    }

    get server() {
      return this._server;
    }
  }

  class CapacitorBluetoothDevice extends EventTarget {
    id: string;
    name: string;
    gatt: CapacitorBluetoothRemoteGatt;
    ongattserverdisconnected: ((evt: Event) => void) | null;

    constructor(id: string, name?: string) {
      super();
      this.id = id;
      this.name = name || "Unknown Device";
      this.gatt = new CapacitorBluetoothRemoteGatt(this);
      this.ongattserverdisconnected = null;
    }

    _emitDisconnected() {
      const evt = new Event("gattserverdisconnected");
      this.dispatchEvent(evt);
      if (typeof this.ongattserverdisconnected === "function") {
        this.ongattserverdisconnected(evt);
      }
    }
  }

  function extractRequestDeviceFilterCriteria(options: any = {}) {
    const filters = Array.isArray(options.filters) ? options.filters : [];
    const names = new Set<string>();
    const namePrefixes = new Set<string>();
    const services = new Set<string>();
    const optionalServices = new Set<string>();

    if (typeof options.name === "string" && options.name.length > 0) {
      names.add(options.name);
    }
    if (typeof options.namePrefix === "string" && options.namePrefix.length > 0) {
      namePrefixes.add(options.namePrefix);
    }
    if (Array.isArray(options.services)) {
      for (const service of options.services) {
        services.add(normalizeUuid(service));
      }
    }
    if (Array.isArray(options.optionalServices)) {
      for (const service of options.optionalServices) {
        optionalServices.add(normalizeUuid(service));
      }
    }

    for (const filter of filters) {
      if (typeof filter?.name === "string" && filter.name.length > 0) {
        names.add(filter.name);
      }
      if (typeof filter?.namePrefix === "string" && filter.namePrefix.length > 0) {
        namePrefixes.add(filter.namePrefix);
      }
      if (Array.isArray(filter?.services)) {
        for (const service of filter.services) {
          const normalized = normalizeUuid(service);
          services.add(normalized);
          optionalServices.add(normalized);
        }
      }
    }

    return {
      names: Array.from(names),
      namePrefixes: Array.from(namePrefixes),
      services: Array.from(services),
      optionalServices: Array.from(optionalServices),
    };
  }

  function matchesPostSelectionFilters(
    deviceName: string,
    discoveredServices: string[],
    criteria: {
      names: string[];
      namePrefixes: string[];
      services: string[];
    },
  ): boolean {
    const normalizedName = (deviceName || "").toLowerCase();
    const normalizedServices = new Set((discoveredServices || []).map(normalizeUuid));

    const hasNameFilters = criteria.names.length > 0 || criteria.namePrefixes.length > 0;
    const hasServiceFilters = criteria.services.length > 0;

    const nameMatched = hasNameFilters
      ? criteria.names.some((name) => normalizedName === name.toLowerCase()) ||
        criteria.namePrefixes.some((prefix) => normalizedName.startsWith(prefix.toLowerCase()))
      : false;

    const serviceMatched = hasServiceFilters
      ? criteria.services.some((service) => normalizedServices.has(normalizeUuid(service)))
      : false;

    // Requested behavior: accept if name OR service filters match.
    if (hasNameFilters && hasServiceFilters) {
      return nameMatched || serviceMatched;
    }
    if (hasNameFilters) {
      return nameMatched;
    }
    if (hasServiceFilters) {
      return serviceMatched;
    }
    return true;
  }

  async function ensureCapacitorBluetoothBridge() {
    if (!isCapacitorNative) {
      return false;
    }

    await BleClient.initialize();

    const bridge = {
      requestDevice: async (options: any) => {
        console.log("Requesting Bluetooth device with options:", options);
        const criteria = extractRequestDeviceFilterCriteria(options);
        console.log("Extracted post-selection filter criteria:", criteria);

        const device = await BleClient.requestDevice({
          // Intentionally request ANY device and filter after selection.
          optionalServices: criteria.optionalServices,
        }).catch((err) => {
          console.error("Error during device selection:", err);
          throw err;
        }).finally(() => {
          console.log("Device selection process completed (success or failure)");
        });
        console.log("Device obtained:", device.deviceId, device.name, device.uuids);
        const deviceId = (device as any).deviceId ?? (device as any).id;
        if (!deviceId) {
          throw new Error("Capacitor requestDevice returned no device id");
        }
        const deviceName = (device as any).name ?? (device as any).localName ?? "Unknown Device";

        // Prefer advertisement UUIDs when available, otherwise temporarily
        // connect and discover services for post-selection filtering.
        let discoveredServices: string[] = Array.isArray((device as any).uuids)
          ? (device as any).uuids.map((uuid: string) => normalizeUuid(uuid))
          : [];

        if (discoveredServices.length === 0 && criteria.services.length > 0) {
          let connectedForDiscovery = false;
          try {
            await BleClient.connect(deviceId);
            connectedForDiscovery = true;
            const services = await BleClient.getServices(deviceId);
            discoveredServices = (services || []).map((service: any) => normalizeUuid(service?.uuid));
            console.log(`Discovered services for device '${deviceName}' (${deviceId}):`, discoveredServices);
          } catch (e) {
            console.warn("Service discovery failed during post-selection filtering:", e);
          } finally {
            if (connectedForDiscovery) {
              try {
                await BleClient.disconnect(deviceId);
              } catch {
                // Ignore disconnect failures in best-effort filter probing.
              }
            }
          }
        }

        const accepted = matchesPostSelectionFilters(deviceName, discoveredServices, {
          names: criteria.names,
          namePrefixes: criteria.namePrefixes,
          services: criteria.services,
        });

        if (!accepted) {
          throw new Error(
            `Selected device '${deviceName}' did not match requested name/service filters`,
          );
        }

        console.log(`Device '${deviceName}' accepted by post-selection filters, creating BluetoothDevice wrapper`);

        return new CapacitorBluetoothDevice(deviceId, deviceName);
      },
    };

    // On Capacitor native platforms, always use the plugin-backed bridge.
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: bridge,
    });

    return true;
  }

  async function initializeBluetoothTransport() {
    if (isCapacitorNative) {
      const bridged = await ensureCapacitorBluetoothBridge();
      if (bridged) {
        console.log("Capacitor BLE bridge active");
        return true;
      }
      return false;
    }

    if (hasWebBluetoothRequestDevice()) {
      console.log("Using Web Bluetooth (native browser requestDevice)");
      return true;
    }

    console.error("Bluetooth unavailable: missing Web Bluetooth requestDevice");
    return false;
  }


  // Extend the ButtplugClientDevice type with custom properties
  export interface EOMButtplugClientDeviceControl {
    type?: OutputType;
    index: number;
    feature: ToyFeature;

    mode?: string;
    invert?: boolean;
    min?: number;
    max?: number;
    slider: number; // 0-255, where the live slider is
    levels?: number; // how many toy levels the toy has for this output, if it says
  }

  export interface EOMButtplugClientDevice extends ButtplugClientDevice {
    controls?: EOMButtplugClientDeviceControl[];
    toy?: ButtplugToy<EOMButtplugClientDeviceControl>; // every command to the toy goes through here
  }


  interface Props {
    deviceList?: EOMButtplugClientDevice[];
    toys?: ToyList; // the app's list of every connected toy, which follows readings and stops them
  }

  let { deviceList = $bindable([]), toys }: Props = $props();

  let client = new ButtplugClient("EOM Client");
  let bluetoothReady = false;
  let error = $state<string | null>(null);
  // Battery level in % for each toy that reports one, by device index
  let batteries = $state<Record<number, number>>({});
  const BATTERY_REFRESH_MS = 60_000;

  async function initialize_buttplug() {
    // Split transport strategy:
    // - Capacitor BLE bridge on native mobile
    // - Web Bluetooth on web/desktop when available
    try {
      bluetoothReady = await initializeBluetoothTransport();
    } catch (e) {
      console.error("Bluetooth transport initialization error:", e);
      bluetoothReady = false;
      return;
    }

    if (!bluetoothReady) {
      return;
    }

    client.addListener("deviceadded", async (device: ButtplugClientDevice) => {
      console.log(`Device added: ${device.name}`, device);
      let eomDevice = device as EOMButtplugClientDevice;
      // Reactive, so the drawer shows each control's mode and live level as the toy changes them.
      const controls = $state(initDeviceControls(eomDevice));
      eomDevice.controls = controls;
      eomDevice.toy = buttplugToy(eomDevice, showControl);
      toys?.add(eomDevice.toy);
      deviceList = [...deviceList, eomDevice];
      readBattery(eomDevice);
    });


    client.addListener("deviceremoved", (device: ButtplugClientDevice) => {
      console.log(`Device removed: ${device.name}`,device);
      toys?.remove(device);
      // device.emitDisconnected();
      //client.disconnect();
      deviceList = deviceList.filter(d => d !== device);
      delete batteries[device.index];
    });
    const connector = new ButtplugWasmClientConnector();
    await client.connect(connector);
  }

  async function connect_to_device() {
    error = null;
    if (!bluetoothReady) {
      console.error("Bluetooth is not ready");
      error = "Bluetooth isn't available here. Try Chrome or Edge, or the EOM app.";
      return;
    }
    try {
      await client.startScanning();
    } catch (e) {
      console.error("Couldn't scan for toys:", e);
      error = `Couldn't look for toys: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function disconnect(device: EOMButtplugClientDevice) {
    toys?.remove(device);
    await disconnectToy(device);
    device.removeAllListeners();
    deviceList = deviceList.filter(d => d !== device);
    delete batteries[device.index];
  }

  // Reads the toy's battery level, if it reports one.
  async function readBattery(device: ButtplugClientDevice) {
    if (!device.hasInput(InputType.Battery)) return;
    try {
      const level = await device.battery();
      batteries[device.index] = Math.round(level * 100);
    } catch (e) {
      console.error(`Couldn't read the battery of toy ${device.name}:`, e);
    }
  }

  onMount(() => {
    initialize_buttplug().catch(err => {
      console.error(err);
      error = `Couldn't start Buttplug: ${err instanceof Error ? err.message : String(err)}`;
    });
    const batteryTimer = setInterval(() => deviceList.forEach(readBattery), BATTERY_REFRESH_MS);
    return () => clearInterval(batteryTimer);
  });

  export function initDeviceControls(device: ButtplugClientDevice): EOMButtplugClientDeviceControl[] {
    const controls: EOMButtplugClientDeviceControl[] = [];
    for (const [idx, feature] of device.features) {
        const control: EOMButtplugClientDeviceControl = {
          index: idx,
          feature,
          mode: "manual",
          invert: false,
          min: DEFAULT_MIN,
          max: DEFAULT_MAX,
          slider: 0,
        };

        // Vibrate = 'Vibrate',
        // Rotate = 'Rotate',
        // Oscillate = 'Oscillate',
        // Constrict = 'Constrict',
        // Inflate = 'Inflate',
        // Position = 'Position',
        // HwPositionWithDuration = 'HwPositionWithDuration',
        // Temperature = 'Temperature',
        // Spray = 'Spray',
        // Led = 'Led',

        if (feature.hasOutput(OutputType.Vibrate)) {
          control.type = OutputType.Vibrate;
        } else if (feature.hasOutput(OutputType.Rotate)) {
          control.type = OutputType.Rotate;
        } else if (feature.hasOutput(OutputType.Oscillate)) {
          control.type = OutputType.Oscillate;
        } else if (feature.hasOutput(OutputType.Constrict)) {
          control.type = OutputType.Constrict;
        } else if (feature.hasOutput(OutputType.Inflate)) {
          control.type = OutputType.Inflate;
        } else if (feature.hasOutput(OutputType.Position)) {
          control.type = OutputType.Position;
        } else if (feature.hasOutput(OutputType.HwPositionWithDuration)) {
          control.type = OutputType.HwPositionWithDuration;
        } else if (feature.hasOutput(OutputType.Temperature)) {
          control.type = OutputType.Temperature;
        } else if (feature.hasOutput(OutputType.Spray)) {
          control.type = OutputType.Spray;
        } else if (feature.hasOutput(OutputType.Led)) {
          control.type = OutputType.Led;
        }

        if (control.type) {
          control.levels = toyLevels(feature, control.type);
          controls.push(control);
        }
        console.log("New feature:",control)
    }
    return controls;
  }

  // The slider was moved by hand. value is 0-1. The toy gets it once its command gap allows.
  export function handleDeviceChange(device: EOMButtplugClientDevice, control: EOMButtplugClientDeviceControl, value: number) {
    device.toy?.setByHand(control, value);
  }

  // Shows a toy control's slider position after the toy changed it (following, or stopped).
  // A stop also switched its mode to Manual, which shows by itself: the control is reactive.
  function showControl(control: EOMButtplugClientDeviceControl, sliderValue: number) {
    control.slider = sliderValue;
  }

  const invertDef = (id: string): SettingDef => ({
    key: `${id}-invert`,
    label: "Invert",
    description: "Runs the toy from the top of its range down.",
    kind: "toggle",
    default: false,
  });
</script>

{#snippet toyControl(device: EOMButtplugClientDevice, control: EOMButtplugClientDeviceControl)}
  {@const id = `toy-${device.index}-${control.index}`}
  {@const min = control.min ?? DEFAULT_MIN}
  {@const max = control.max ?? DEFAULT_MAX}
  <div class="toyControl">
    <div class="row">
      <label class="title" for="{id}-level">{control.type}</label>
      <output class="pill" for="{id}-level">{toyLevelPercent(control, control.slider, control.levels)}%</output>
    </div>
    <p class="desc">{toyControlHelp(control)}</p>

    <div class="field">
      <span class="label" id="{id}-follows">Follows</span>
      <div class="chips" role="radiogroup" aria-labelledby="{id}-follows">
        {#each FOLLOWS as f}
          <button
            type="button"
            role="radio"
            aria-checked={control.mode === f.mode}
            class:active={control.mode === f.mode}
            onclick={() => (control.mode = f.mode)}>{f.label}</button
          >
        {/each}
      </div>
    </div>

    <input
      id="{id}-level"
      type="range"
      class="slider"
      min="0"
      max="255"
      value={control.slider}
      disabled={control.mode !== "manual"}
      title={control.mode === "manual" ? undefined : "Switch to Manual to set it by hand"}
      style="--fill: {(control.slider / 255) * 100}%"
      oninput={(e) => {
        control.slider = Number(e.currentTarget.value);
        handleDeviceChange(device, control, control.slider / 255);
      }}
    />

    <div class="field">
      <div class="row">
        <span class="label">Range</span>
        <span class="pill">{percent255(min)}% – {percent255(max)}%</span>
      </div>
      <div class="dualRange" style="--lo: {min / 255}; --hi: {max / 255}">
        <!-- At the top end only the min thumb can move, so it goes on top there. -->
        <input
          type="range"
          class="slider"
          min="0"
          max="255"
          value={min}
          aria-label="{control.type} range minimum"
          style:z-index={min > 127 ? 2 : 1}
          oninput={(e) => (e.currentTarget.value = String(setRangeEnd(control, "min", Number(e.currentTarget.value))))}
        />
        <input
          type="range"
          class="slider"
          min="0"
          max="255"
          value={max}
          aria-label="{control.type} range maximum"
          oninput={(e) => (e.currentTarget.value = String(setRangeEnd(control, "max", Number(e.currentTarget.value))))}
        />
      </div>
    </div>

    <SettingControl def={invertDef(id)} value={control.invert ?? false} onchange={(_, v) => (control.invert = Boolean(v))} />
  </div>
{/snippet}

<div class="toyList">
  {#if error}
    <div class="banner error" role="alert">
      <span>{error}</span>
      <button class="small" onclick={() => (error = null)}>Dismiss</button>
    </div>
  {/if}

  {#each deviceList as device (device)}
    <div class="toy">
      <div class="toyHead">
        <span class="toyName">{device.name}</span>
        {#if batteries[device.index] !== undefined}
          <span class="battery" class:low={batteries[device.index] <= 15} title="Battery">{batteries[device.index]}% battery</span>
        {/if}
        <button class="small" onclick={() => disconnect(device)}>Disconnect</button>
      </div>
      {#each device.controls ?? [] as control (control)}
        {@render toyControl(device, control)}
      {/each}
    </div>
  {:else}
    <p class="muted">
      No toys connected. Supported toys are listed
      <a href="https://iostindex.com/?filter0Availability=Available,DIY&filter1Connection=Bluetooth%204%20LE&filter2ButtplugSupport=4&filter3Features=OutputsVibrators" target="_blank">by IoST Index</a>.
    </p>
  {/each}

  <div class="connectRow">
    <button class="primary" onclick={connect_to_device}>{deviceList.length > 0 ? "Connect another toy" : "Connect a toy"}</button>
    <span class="muted">Powered by <a href="https://buttplug.io/" target="_blank">Buttplug</a></span>
  </div>
</div>

<style>
  .toyList {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .toyList > p,
  .toyList > .banner {
    margin: 0;
  }
  .toy {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toyHead {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .toyName {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .battery {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    white-space: nowrap;
  }
  .battery.low {
    color: var(--arousal);
  }
  .toyControl {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 14px 14px 0;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .title {
    font-weight: 700;
    font-size: 1rem;
  }
  .label {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .desc {
    margin: -0.3rem 0 0;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.35;
  }
  .connectRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
</style>
