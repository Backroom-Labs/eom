// Firmware updates over BLE: the protocol in otaProtocol.ts on two characteristics of the EOM
// service. The EOM's side is src/include/system/ble_ota.h (firmware).
import { Capacitor } from "@capacitor/core";
import { BleClient, ConnectionPriority } from "@capacitor-community/bluetooth-le";
import { pushImage, type DeviceInfo, type FirmwareUploader, type OtaChannel } from "./otaProtocol.ts";

const SERVICE_UUID = "00006969-0000-1000-8000-00805f9b34fb";
const CONTROL_CHAR = "0000696d-0000-1000-8000-00805f9b34fb";
const DATA_CHAR = "0000696e-0000-1000-8000-00805f9b34fb";

const CMD_BEGIN = 0x01;
const CMD_ABORT = 0x02;

// Reads the EOM's DeviceInfo, or null if its firmware predates BLE updates.
export async function readBleDeviceInfo(deviceId: string): Promise<DeviceInfo | null> {
  try {
    const value = await BleClient.read(deviceId, SERVICE_UUID, CONTROL_CHAR);
    return JSON.parse(new TextDecoder().decode(value));
  } catch (error) {
    // Firmware from before BLE updates has no control characteristic.
    console.log("No firmware update support:", error);
    return null;
  }
}

function bleChannel(deviceId: string, mtu: number): OtaChannel {
  const write = (bytes: Uint8Array) => BleClient.write(deviceId, SERVICE_UUID, CONTROL_CHAR, new DataView(bytes.buffer));
  return {
    chunkSize: mtu - 3 - 4, // ATT header, offset
    async listen(onEvent) {
      // A dropped connection shows up as failed writes or a timeout.
      await BleClient.startNotifications(deviceId, SERVICE_UUID, CONTROL_CHAR, (value) =>
        onEvent({ event: value.getUint8(0), error: value.getInt32(1, true), value: value.getUint32(5, true) }),
      );
      if (Capacitor.getPlatform() === "android") {
        await BleClient.requestConnectionPriority(deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH).catch(() => {});
      }
      return () => BleClient.stopNotifications(deviceId, SERVICE_UUID, CONTROL_CHAR);
    },
    async begin(size, allowDowngrade) {
      const begin = new Uint8Array(6);
      const view = new DataView(begin.buffer);
      view.setUint8(0, CMD_BEGIN);
      view.setUint32(1, size, true);
      view.setUint8(5, allowDowngrade ? 0x01 : 0x00);
      await write(begin);
    },
    async sendChunk(offset, data) {
      const packet = new Uint8Array(4 + data.length);
      new DataView(packet.buffer).setUint32(0, offset, true);
      packet.set(data, 4);
      await BleClient.writeWithoutResponse(deviceId, SERVICE_UUID, DATA_CHAR, new DataView(packet.buffer));
    },
    abort: () => write(new Uint8Array([CMD_ABORT])),
  };
}

export function bleUploader(deviceId: string, info: DeviceInfo): FirmwareUploader {
  return { upload: (image, options) => pushImage(bleChannel(deviceId, info.mtu ?? 23), image, options) };
}
