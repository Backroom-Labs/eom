<script lang="ts">
  // Firmware update over BLE. The protocol is described in src/include/system/ble_ota.h.
  import { Capacitor } from '@capacitor/core';
  import { BleClient, ConnectionPriority } from '@capacitor-community/bluetooth-le';

  interface Props {
    deviceId: string | null;
    connected: boolean;
  }
  let { deviceId, connected }: Props = $props();

  const SERVICE_UUID = "00006969-0000-1000-8000-00805f9b34fb";
  const CONTROL_CHAR = "0000696d-0000-1000-8000-00805f9b34fb";
  const DATA_CHAR = "0000696e-0000-1000-8000-00805f9b34fb";

  const CMD_BEGIN = 0x01;
  const CMD_ABORT = 0x02;
  const EVT_READY = 0x01;
  const EVT_PROGRESS = 0x02;
  const EVT_RESEND = 0x03;
  const EVT_RESULT = 0x04;

  const WINDOW = 16 * 1024; // BLE_OTA_WINDOW
  const ERASE_TIMEOUT_MS = 90_000;
  const EVENT_TIMEOUT_MS = 30_000;

  // Layout of the signed firmware.bin (see src/system/ota.c and tools/sign_firmware.py)
  const APP_DESC_OFFSET = 32; // esp_image_header_t + esp_image_segment_header_t
  const APP_DESC_MAGIC = 0xabcd5432;
  const EOM_DESC_OFFSET = APP_DESC_OFFSET + 256; // right after esp_app_desc_t
  const EOM_DESC_MAGIC = 0x314d4f45;
  const SIG_TRAILER_LEN = 128;
  const SIG_MAGIC = "EOMSIG1";

  type DeviceInfo = { version: string; board: string; mtu: number; maxSize: number; confirmed: boolean };
  type ImageInfo = { version: string; board: string; signed: boolean };

  let info = $state(null) as DeviceInfo | null;
  let image = $state(null) as Uint8Array | null;
  let imageInfo = $state(null) as ImageInfo | null;
  let allowDowngrade = $state(false);
  let busy = $state(false);
  let progress = $state(0); // 0..1
  let status = $state("");

  let sent = 0;
  let acked = 0;
  let resends = 0; // bumped on every RESEND, so an in-flight write knows its chunk was dropped
  let result: number | null = null;
  let wake: (() => void) | null = null;

  const errors: Record<number, string> = {
    0x103: "The EOM is busy, or still checking the firmware it last installed. Try again in 30 seconds.",
    0x104: "This file is the wrong size for the EOM.",
    0x107: "The transfer timed out.",
    0x10a: "This is older than the installed firmware. Tick \"Allow downgrade\" to install it anyway.",
    0x1503: "The EOM rejected this file: it isn't signed firmware for this board.",
  };

  $effect(() => {
    if (connected && deviceId) {
      readInfo(deviceId);
    } else {
      info = null;
    }
  });

  async function readInfo(id: string) {
    try {
      const value = await BleClient.read(id, SERVICE_UUID, CONTROL_CHAR);
      info = JSON.parse(new TextDecoder().decode(value));
    } catch (error) {
      // Firmware from before BLE updates has no control characteristic.
      console.log("No firmware update support:", error);
      info = null;
    }
  }

  function cString(bytes: Uint8Array, offset: number, length: number): string {
    const slice = bytes.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return new TextDecoder().decode(end >= 0 ? slice.subarray(0, end) : slice);
  }

  function parseImage(bytes: Uint8Array): ImageInfo | null {
    if (bytes.length < EOM_DESC_OFFSET + 36 + SIG_TRAILER_LEN) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] !== 0xe9 || view.getUint32(APP_DESC_OFFSET, true) !== APP_DESC_MAGIC) return null;
    const hasEomDesc = view.getUint32(EOM_DESC_OFFSET, true) === EOM_DESC_MAGIC;
    return {
      version: cString(bytes, APP_DESC_OFFSET + 16, 32),
      board: hasEomDesc ? cString(bytes, EOM_DESC_OFFSET + 4, 32) : "unknown",
      signed: cString(bytes, bytes.length - SIG_TRAILER_LEN, 8) === SIG_MAGIC,
    };
  }

  async function chooseFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    status = "";
    image = null;
    imageInfo = null;
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    imageInfo = parseImage(bytes);
    if (!imageInfo) {
      status = "That isn't an EOM firmware file (firmware.bin from the build).";
    } else if (!imageInfo.signed) {
      status = "This firmware isn't signed, so the EOM won't install it.";
    } else if (info && imageInfo.board !== info.board) {
      status = `This firmware is for ${imageInfo.board}, but this EOM is ${info.board}.`;
    } else if (info && bytes.length > info.maxSize) {
      status = "This firmware is too big for the EOM.";
    } else {
      image = bytes;
    }
  }

  function onEvent(value: DataView) {
    const event = value.getUint8(0);
    const err = value.getInt32(1, true);
    const arg = value.getUint32(5, true);
    if (event === EVT_PROGRESS) {
      acked = arg;
      progress = image ? arg / image.length : 0;
    } else if (event === EVT_RESEND) {
      console.log(`Firmware update: resending from ${arg}`);
      sent = arg;
      resends++;
    } else if (event === EVT_RESULT) {
      result = err;
    }
    // EVT_READY needs no handling beyond waking the sender.
    wake?.();
  }

  function waitForEvent(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wake = null;
        reject(new Error("timeout"));
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  function errorMessage(err: number): string {
    return errors[err] ?? `The update failed (error 0x${(err >>> 0).toString(16)}).`;
  }

  async function startUpdate() {
    if (!deviceId || !image || !info) return;
    const id = deviceId;
    const bytes = image;
    busy = true;
    progress = 0;
    sent = 0;
    acked = 0;
    result = null;

    try {
      await BleClient.startNotifications(id, SERVICE_UUID, CONTROL_CHAR, onEvent);
      if (Capacitor.getPlatform() === "android") {
        await BleClient.requestConnectionPriority(id, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {});
      }

      status = "Preparing the EOM…";
      const begin = new DataView(new ArrayBuffer(6));
      begin.setUint8(0, CMD_BEGIN);
      begin.setUint32(1, bytes.length, true);
      begin.setUint8(5, allowDowngrade ? 0x01 : 0x00);
      // Listen before writing: a refusal can arrive as soon as the write is acknowledged.
      const ready = waitForEvent(ERASE_TIMEOUT_MS);
      await BleClient.write(id, SERVICE_UUID, CONTROL_CHAR, begin);
      await ready;
      if (result !== null) throw new Error(errorMessage(result));

      // Runs until the RESULT event: a RESEND can still rewind after the last chunk went out.
      const chunkSize = info.mtu - 3 - 4; // ATT header, offset
      while (result === null) {
        if (sent >= bytes.length || sent - acked >= WINDOW) {
          status = acked >= bytes.length ? "Verifying…" : "Sending firmware…";
          await waitForEvent(EVENT_TIMEOUT_MS);
          continue;
        }
        status = "Sending firmware…";
        const offset = sent;
        const n = Math.min(chunkSize, bytes.length - offset);
        const packet = new Uint8Array(4 + n);
        new DataView(packet.buffer).setUint32(0, offset, true);
        packet.set(bytes.subarray(offset, offset + n), 4);
        const generation = resends;
        await BleClient.writeWithoutResponse(id, SERVICE_UUID, DATA_CHAR, new DataView(packet.buffer));
        if (generation === resends) sent = offset + n;
      }
      if (result !== 0) throw new Error(errorMessage(result));

      progress = 1;
      status = "Firmware installed. The EOM is restarting; reconnect in a few seconds.";
      image = null;
      imageInfo = null;
    } catch (error: any) {
      console.error("Firmware update failed:", error);
      status = error?.message === "timeout" ? errorMessage(0x107) : (error?.message ?? String(error));
      if (connected) {
        const abort = new DataView(new Uint8Array([CMD_ABORT]).buffer);
        await BleClient.write(id, SERVICE_UUID, CONTROL_CHAR, abort).catch(() => {});
      }
    } finally {
      await BleClient.stopNotifications(id, SERVICE_UUID, CONTROL_CHAR).catch(() => {});
      wake = null;
      busy = false;
    }
  }
</script>

<h3>Firmware update</h3>
{#if !connected}
  <p>Connect over Bluetooth to update the firmware.</p>
{:else if !info}
  <p>This EOM's firmware can't be updated over Bluetooth. Flash it over USB once to enable updates.</p>
{:else}
  <p>Installed: {info.version} ({info.board})</p>
  {#if !info.confirmed}
    <p>The EOM is still checking its new firmware. Updates are possible in about 30 seconds.</p>
  {/if}
  <input type="file" accept=".bin" disabled={busy} onchange={chooseFile} />
  {#if imageInfo}
    <p>File: {imageInfo.version} ({imageInfo.board})</p>
  {/if}
  <label>
    <input type="checkbox" bind:checked={allowDowngrade} disabled={busy} />
    Allow downgrade
  </label>
  <button onclick={startUpdate} disabled={busy || !image || !info.confirmed}>Install</button>
  {#if busy || progress > 0}
    <progress value={progress} max="1" style="width: 100%;"></progress>
  {/if}
{/if}
{#if status}
  <p>{status}</p>
{/if}
