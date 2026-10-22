// Sending a firmware image to the EOM. BLE is the only transport for now; Wi-Fi (#29) adds a second one.
// The BLE protocol is described in src/include/system/ble_ota.h (firmware).
import { Capacitor } from "@capacitor/core";
import { BleClient, ConnectionPriority } from "@capacitor-community/bluetooth-le";

export type UploadStage = "preparing" | "sending" | "verifying";

export type UploadOptions = {
  allowDowngrade: boolean;
  onProgress: (fraction: number, stage: UploadStage) => void;
};

// The result codes the EOM sends back (esp_err_t values from src/system/ota.c and ble_ota.c).
export const OtaResult = {
  OK: 0,
  BUSY: 0x103, // ESP_ERR_INVALID_STATE: busy, or still checking the last update
  WRONG_SIZE: 0x104, // ESP_ERR_INVALID_SIZE
  TIMEOUT: 0x107, // ESP_ERR_TIMEOUT
  OLDER: 0x10a, // ESP_ERR_INVALID_VERSION: older than installed, and downgrade not allowed
  NOT_SIGNED_FOR_BOARD: 0x1503, // ESP_ERR_OTA_VALIDATE_FAILED: not signed with this EOM's key
} as const;

// Sends image and resolves with an OtaResult code: OK when the EOM installed it, otherwise why not.
// The app's own wait for the EOM timing out also resolves with TIMEOUT, as the EOM's does.
// Throws if a call to the transport itself fails.
export interface FirmwareUploader {
  upload(image: Uint8Array, options: UploadOptions): Promise<number>;
}

const SERVICE_UUID = "00006969-0000-1000-8000-00805f9b34fb";
const CONTROL_CHAR = "0000696d-0000-1000-8000-00805f9b34fb";
const DATA_CHAR = "0000696e-0000-1000-8000-00805f9b34fb";

const CMD_BEGIN = 0x01;
const CMD_ABORT = 0x02;
const EVT_PROGRESS = 0x02;
const EVT_RESEND = 0x03;
const EVT_RESULT = 0x04;

const WINDOW = 16 * 1024; // BLE_OTA_WINDOW
const ERASE_TIMEOUT_MS = 90_000;
const EVENT_TIMEOUT_MS = 30_000;

// What the EOM reports on the control characteristic.
export type DeviceInfo = { version: string; board: string; mtu: number; maxSize: number; confirmed: boolean };

// Reads the EOM's DeviceInfo, or null if its firmware predates BLE updates.
export async function readDeviceInfo(deviceId: string): Promise<DeviceInfo | null> {
  try {
    const value = await BleClient.read(deviceId, SERVICE_UUID, CONTROL_CHAR);
    return JSON.parse(new TextDecoder().decode(value));
  } catch (error) {
    // Firmware from before BLE updates has no control characteristic.
    console.log("No firmware update support:", error);
    return null;
  }
}

class Timeout extends Error {}

export function bleUploader(deviceId: string, info: DeviceInfo): FirmwareUploader {
  return {
    async upload(bytes, { allowDowngrade, onProgress }) {
      let sent = 0;
      let acked = 0;
      let resends = 0; // bumped on every RESEND, so an in-flight write knows its chunk was dropped
      let result: number | null = null;
      let wake: (() => void) | null = null;

      function onEvent(value: DataView) {
        const event = value.getUint8(0);
        const err = value.getInt32(1, true);
        const arg = value.getUint32(5, true);
        if (event === EVT_PROGRESS) {
          acked = arg;
          onProgress(arg / bytes.length, arg >= bytes.length ? "verifying" : "sending");
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
            reject(new Timeout());
          }, ms);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }

      const abort = () =>
        BleClient.write(deviceId, SERVICE_UUID, CONTROL_CHAR, new DataView(new Uint8Array([CMD_ABORT]).buffer)).catch(() => {});

      try {
        await BleClient.startNotifications(deviceId, SERVICE_UUID, CONTROL_CHAR, onEvent);
        if (Capacitor.getPlatform() === "android") {
          await BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {});
        }

        onProgress(0, "preparing");
        const begin = new DataView(new ArrayBuffer(6));
        begin.setUint8(0, CMD_BEGIN);
        begin.setUint32(1, bytes.length, true);
        begin.setUint8(5, allowDowngrade ? 0x01 : 0x00);
        // Listen before writing: a refusal can arrive as soon as the write is acknowledged.
        const ready = waitForEvent(ERASE_TIMEOUT_MS);
        await BleClient.write(deviceId, SERVICE_UUID, CONTROL_CHAR, begin);
        await ready;

        // Runs until the RESULT event: a RESEND can still rewind after the last chunk went out.
        const chunkSize = info.mtu - 3 - 4; // ATT header, offset
        if (result === null) onProgress(0, "sending");
        while (result === null) {
          if (sent >= bytes.length || sent - acked >= WINDOW) {
            await waitForEvent(EVENT_TIMEOUT_MS);
            continue;
          }
          const offset = sent;
          const n = Math.min(chunkSize, bytes.length - offset);
          const packet = new Uint8Array(4 + n);
          new DataView(packet.buffer).setUint32(0, offset, true);
          packet.set(bytes.subarray(offset, offset + n), 4);
          const generation = resends;
          await BleClient.writeWithoutResponse(deviceId, SERVICE_UUID, DATA_CHAR, new DataView(packet.buffer));
          if (generation === resends) sent = offset + n;
        }
        if (result !== 0) await abort();
        return result;
      } catch (error) {
        await abort();
        if (error instanceof Timeout) return OtaResult.TIMEOUT;
        throw error;
      } finally {
        await BleClient.stopNotifications(deviceId, SERVICE_UUID, CONTROL_CHAR).catch(() => {});
      }
    },
  };
}
