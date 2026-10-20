<script lang="ts">
  import { BleClient } from '@capacitor-community/bluetooth-le';
  import { errorMessage } from './lib/errors';

  let BTLEDdeviceId: string | null = $state(null);
  let deviceConfig: LEDdevice | undefined = $state(undefined);
  let isWriting = false;

  interface Props {
    BTLEDconnected?: boolean;
  }

  interface LEDdevice {
    name: string;
    prefix: string;
    service: string;
    tx: string;
    keepalive?: string;
    startup?: string;
  }

  let lastRBGValues: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 };

  const devices: LEDdevice[] = [
    { name: "LotusLampX", prefix: "ELK-", service: "0000fff0-0000-1000-8000-00805f9b34fb", tx: "0000fff3-0000-1000-8000-00805f9b34fb" },
    { name: "Govee", prefix: "Govee_H", service: "00010203-0405-0607-0809-0a0b0c0d1910", tx: "00010203-0405-0607-0809-0a0b0c0d2b11", keepalive: "aa010000000000000000000000000000000000ab", startup: "3301010000000000000000000000000000000033" }
  ];
  
  let { BTLEDconnected = $bindable(false) }: Props = $props();
  let connecting = $state(false);
  let lightName = $state("");
  let error = $state<string | null>(null);
  let keepAliveInterval: NodeJS.Timeout | null = null;

  async function connectBluetooth() {
    try {
      connecting = true;
      error = null;
      
      // Initialize BLE client
      await BleClient.initialize();
      
      // Request device with multiple name prefixes
      const device = await BleClient.requestDevice({
        namePrefix: devices[0].prefix, // Start with first prefix
        optionalServices: devices.map(d => d.service),
      });

      BTLEDdeviceId = device.deviceId;
      const deviceName = device.name || "";
      console.log("Connected to device:", deviceName);
      
      // Determine brand from device name
      deviceConfig = devices.find(d => deviceName?.startsWith(d.prefix));
      if (!deviceConfig) {
        throw new Error("Unknown device type");
      }

      console.log("Detected brand:", deviceConfig.name);

      // Connect to device with disconnect callback and timeout
      await BleClient.connect(
        device.deviceId, 
        (deviceId) => {
          console.log(`Device ${deviceId} disconnected`);
          BTLEDconnected = false;
          BTLEDdeviceId = null;
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
          }
        },
        { timeout: 15000 } // 15 second timeout
      );
      
      console.log("Connected successfully");
      BTLEDconnected = true;
      lightName = deviceName || deviceConfig.name;

      console.log(deviceConfig.keepalive);
      if (deviceConfig.keepalive) {
        console.log("Starting keepalive interval");
        keepAliveInterval = setInterval(async () => {
          if (BTLEDconnected && BTLEDdeviceId) {
            const keepaliveData = new Uint8Array(deviceConfig!.keepalive!.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            try {
              const dataView = new DataView(keepaliveData.buffer);
              await BleClient.writeWithoutResponse(BTLEDdeviceId, deviceConfig!.service, deviceConfig!.tx, dataView);
              console.log("Sent keepalive");
            } catch (error) {
              console.error("Failed to send keepalive:", error);
            }
          } else {
            console.log("Not connected, skipping keepalive");
            clearInterval(keepAliveInterval!);
            keepAliveInterval = null;
          }
        }, 2000);  // Send keepalive every 2 seconds
      }

      if (deviceConfig.startup) {
        console.log("Sending startup sequence");
        const startupData = new Uint8Array(deviceConfig!.startup!.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        try {
          const dataView = new DataView(startupData.buffer);
          await BleClient.writeWithoutResponse(device.deviceId, deviceConfig.service, deviceConfig.tx, dataView);
          console.log("Sent startup sequence");
        } catch (error) {
          console.error("Failed to send startup sequence:", error);
        }
      }

    } catch (err) {
      console.error("Bluetooth connection failed:", err);
      const text = errorMessage(err);
      // Closing the device picker isn't an error worth showing.
      if (!/cancel/i.test(text)) error = `Couldn't connect to the light: ${text}`;
      BTLEDconnected = false;
      BTLEDdeviceId = null;
    } finally {
      connecting = false;
    }
  }

  async function disconnect() {
    if (BTLEDdeviceId) {
      try {
        await BleClient.disconnect(BTLEDdeviceId);
      } catch (error) {
        console.error("Error disconnecting:", error);
      }
    }
    BTLEDdeviceId = null;
    BTLEDconnected = false;
    if (keepAliveInterval) {
      console.log("Clearing keepalive interval");
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }

  function RGBdata(brand: string | null, r: number, g: number, b: number): Uint8Array<ArrayBuffer> {
    if (brand === "LotusLampX") {
      return new Uint8Array([0x7E, 0x07, 0x05, 0x03, r, g, b, 0x10, 0xEF]);
    } else if (brand === "Govee") {
      const XOR = (0x33 ^ 0x05 ^ 0x02 ^ r ^ g ^ b) && 0xFF // ^ 0xFF ^ 0xAE ^ 0x54);
      const data = new Uint8Array([0x33, 0x05, 0x02, r, g, b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, XOR]);
      return data;
    } else {
      throw new Error(`Unsupported brand: ${brand}`);
    }
  }

  export async function writeRGB(r: number, g: number, b: number) {
    if (!BTLEDdeviceId || !deviceConfig) {
      throw new Error("Not connected to Bluetooth device");
    }
    
    if (isWriting) {
      //console.log("GATT write already in progress, skipping");
      return;
    }

    if (lastRBGValues.r === r && lastRBGValues.g === g && lastRBGValues.b === b) {
      //console.log("RGB values unchanged, skipping write",r,g,b,lastRBGValues);
      return;
    }
    lastRBGValues = { r, g, b };
    
    console.log(`Preparing to write RGB: ${r}, ${g}, ${b}`);


    // Ensure values are in 0-255 range
    r = Math.max(0, Math.min(255, Math.floor(r)));
    g = Math.max(0, Math.min(255, Math.floor(g)));
    b = Math.max(0, Math.min(255, Math.floor(b)));

    let data: Uint8Array<ArrayBuffer> = RGBdata(deviceConfig?.name || null, r, g, b);
      
    isWriting = true;
    console.log(`Writing RGB to ${deviceConfig?.name || "unknown device"}: ${r}, ${g}, ${b}: `, data);
    try {
      const dataView = new DataView(data.buffer);
      await BleClient.writeWithoutResponse(BTLEDdeviceId, deviceConfig.service, deviceConfig.tx, dataView);
    } catch (error) {
      console.error("Failed writing RGB value:", error);
      throw error;
    } finally {
      isWriting = false;
    }
  }
</script>

<div class="lights">
  {#if error}
    <div class="banner error" role="alert">
      <span>{error}</span>
      <button class="small" onclick={() => (error = null)}>Dismiss</button>
    </div>
  {/if}
  {#if BTLEDconnected}
    <div class="lightRow">
      <span class="lightName">{lightName}</span>
      <button class="small" onclick={disconnect}>Disconnect</button>
    </div>
    <p class="muted">Mirrors the EOM's LED colour.</p>
  {:else}
    <p class="muted">
      No light connected. A light mirrors the EOM's LED colour. Works with off-brand lights that use the
      LotusLampX app, <a target="_blank" href="https://www.amazon.com/dp/B0CCBH8R6K">like this strip</a>.
    </p>
    <div>
      <button class="primary" onclick={connectBluetooth} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect a light"}
      </button>
    </div>
  {/if}
</div>

<style>
  .lights {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lights p {
    margin: 0;
  }
  .lights .banner {
    margin: 0;
  }
  .lightRow {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .lightName {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
</style>
