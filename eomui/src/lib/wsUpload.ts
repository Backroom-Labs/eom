// Firmware updates over Wi-Fi: the protocol in otaProtocol.ts on the EOM's WebSocket.
// The EOM's side is src/include/system/ws_ota.h (firmware).
import { OtaEvent, pushImage, type DeviceInfo, type FirmwareUploader, type OtaChannel } from "./otaProtocol.ts";

// The parts of a WebSocket the update uses.
export type OtaSocket = {
  send(data: string | ArrayBufferView): void;
  addEventListener(type: "message" | "close", listener: (event: any) => void): void;
  removeEventListener(type: "message" | "close", listener: (event: any) => void): void;
};

const CHUNK_SIZE = 4096; // OTA_MAX_CHUNK
const INFO_TIMEOUT_MS = 5000;

const EVENTS: Record<string, number> = {
  ready: OtaEvent.READY,
  progress: OtaEvent.PROGRESS,
  resend: OtaEvent.RESEND,
  result: OtaEvent.RESULT,
};

function parse(event: MessageEvent): any {
  if (typeof event.data !== "string") return null;
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

// Asks the EOM what it runs. Resolves with null if its firmware predates Wi-Fi updates.
export function readWsDeviceInfo(socket: OtaSocket): Promise<DeviceInfo | null> {
  return new Promise((resolve) => {
    const done = (info: DeviceInfo | null) => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(info);
    };
    const onMessage = (event: MessageEvent) => {
      const reply = parse(event)?.otaInfo;
      // Older firmware answers {"otaInfo": {"error": "NOT IMPLEMENTED"}}.
      if (reply) done(typeof reply.board === "string" ? reply : null);
    };
    const timer = setTimeout(() => done(null), INFO_TIMEOUT_MS);
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ otaInfo: null }));
  });
}

function wsChannel(socket: OtaSocket): OtaChannel {
  return {
    chunkSize: CHUNK_SIZE,
    async listen(onEvent, onLost) {
      const onMessage = (event: MessageEvent) => {
        const ota = parse(event)?.ota;
        if (ota && ota.event in EVENTS) onEvent({ event: EVENTS[ota.event], error: ota.error, value: ota.value });
      };
      const onClose = () => onLost(new Error("The connection to the EOM was lost."));
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      return async () => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
      };
    },
    async begin(size, allowDowngrade) {
      socket.send(JSON.stringify({ otaBegin: { size, allowDowngrade } }));
    },
    async sendChunk(offset, data) {
      const frame = new Uint8Array(4 + data.length);
      new DataView(frame.buffer).setUint32(0, offset, true);
      frame.set(data, 4);
      socket.send(frame);
    },
    async abort() {
      socket.send(JSON.stringify({ otaAbort: null }));
    },
  };
}

export function wsUploader(socket: OtaSocket): FirmwareUploader {
  return { upload: (image, options) => pushImage(wsChannel(socket), image, options) };
}
