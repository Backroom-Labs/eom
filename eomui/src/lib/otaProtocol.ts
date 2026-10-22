// Sending a firmware image to the EOM, the same over BLE (bleUpload.ts) and Wi-Fi (wsUpload.ts).
// The EOM's side is src/include/system/ota_transfer.h (firmware).

export type UploadStage = "preparing" | "sending" | "verifying";

export type UploadOptions = {
  allowDowngrade: boolean;
  onProgress: (fraction: number, stage: UploadStage) => void;
};

// The result codes the EOM sends back (esp_err_t values from src/system/ota.c and ota_transfer.c).
export const OtaResult = {
  OK: 0,
  BUSY: 0x103, // ESP_ERR_INVALID_STATE: busy (an update is running, over either transport), or still checking the last update
  WRONG_SIZE: 0x104, // ESP_ERR_INVALID_SIZE
  TIMEOUT: 0x107, // ESP_ERR_TIMEOUT
  OLDER: 0x10a, // ESP_ERR_INVALID_VERSION: older than installed, and downgrade not allowed
  NOT_SIGNED_FOR_BOARD: 0x1503, // ESP_ERR_OTA_VALIDATE_FAILED: not signed with this EOM's key
} as const;

// Sends image and resolves with an OtaResult code: OK when the EOM installed it, otherwise why not.
// The app's own wait for the EOM timing out also resolves with TIMEOUT, as the EOM's does.
// Throws if the transport fails or the connection is lost.
export interface FirmwareUploader {
  upload(image: Uint8Array, options: UploadOptions): Promise<number>;
}

// What the EOM reports about itself before an update. mtu is BLE only; pressureSim is absent in stable releases.
export type DeviceInfo = { version: string; board: string; maxSize: number; confirmed: boolean; mtu?: number; pressureSim?: boolean };

export const OTA_WINDOW = 16 * 1024;

// A chunk as it goes on the wire, over either transport: its u32 little-endian offset, then the bytes.
export function offsetChunk(offset: number, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(4 + data.length);
  new DataView(frame.buffer).setUint32(0, offset, true);
  frame.set(data, 4);
  return frame;
}

export const OtaEvent = { READY: 0x01, PROGRESS: 0x02, RESEND: 0x03, RESULT: 0x04 } as const;
export type OtaEventMessage = { event: number; error: number; value: number };

// One transport's way of carrying the protocol.
export interface OtaChannel {
  chunkSize: number;
  // Starts delivering the EOM's events; onLost is called if the connection drops. Resolves with
  // a function that stops listening.
  listen(onEvent: (event: OtaEventMessage) => void, onLost: (error: Error) => void): Promise<() => Promise<void>>;
  begin(size: number, allowDowngrade: boolean): Promise<void>;
  sendChunk(offset: number, data: Uint8Array): Promise<void>;
  abort(): Promise<void>;
}

const ERASE_TIMEOUT_MS = 90_000;
const EVENT_TIMEOUT_MS = 30_000;

class Timeout extends Error {}

// Runs one update over channel: BEGIN, wait for READY, then the image in chunks tagged with their
// offset, no more than OTA_WINDOW beyond the last PROGRESS in flight, rewinding on RESEND, until RESULT.
export async function pushImage(channel: OtaChannel, bytes: Uint8Array, { allowDowngrade, onProgress }: UploadOptions): Promise<number> {
  let sent = 0;
  let acked = 0;
  let resends = 0; // bumped on every RESEND, so an in-flight send knows its chunk was dropped
  let result: number | null = null;
  let lost: Error | null = null;
  let wake: (() => void) | null = null;

  function onEvent({ event, error, value }: OtaEventMessage) {
    if (event === OtaEvent.PROGRESS) {
      acked = value;
      onProgress(value / bytes.length, value >= bytes.length ? "verifying" : "sending");
    } else if (event === OtaEvent.RESEND) {
      console.log(`Firmware update: resending from ${value}`);
      sent = value;
      resends++;
    } else if (event === OtaEvent.RESULT) {
      result = error;
    }
    // READY needs no handling beyond waking the sender.
    wake?.();
  }

  function onLost(error: Error) {
    lost = error;
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
        if (lost) reject(lost);
        else resolve();
      };
    });
  }

  const stop = await channel.listen(onEvent, onLost);
  try {
    onProgress(0, "preparing");
    // Listen before sending: a refusal can arrive as soon as BEGIN does.
    const ready = waitForEvent(ERASE_TIMEOUT_MS);
    await channel.begin(bytes.length, allowDowngrade);
    await ready;

    // Runs until RESULT: a RESEND can still rewind after the last chunk went out.
    if (result === null) onProgress(0, "sending");
    while (result === null) {
      if (lost) throw lost;
      if (sent >= bytes.length || sent - acked >= OTA_WINDOW) {
        await waitForEvent(EVENT_TIMEOUT_MS);
        continue;
      }
      const offset = sent;
      const n = Math.min(channel.chunkSize, bytes.length - offset);
      const generation = resends;
      await channel.sendChunk(offset, bytes.subarray(offset, offset + n));
      if (generation === resends) sent = offset + n;
    }
    if (result !== OtaResult.OK) await channel.abort().catch(() => {});
    return result;
  } catch (error) {
    await channel.abort().catch(() => {});
    if (error instanceof Timeout) return OtaResult.TIMEOUT;
    throw error;
  } finally {
    await stop().catch(() => {});
  }
}
