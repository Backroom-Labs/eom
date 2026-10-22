<script lang="ts">
  // Firmware update over BLE: a release found by Check for updates, or a firmware.bin chosen by hand.
  import { bleUploader, readDeviceInfo, OtaResult, type DeviceInfo, type UploadStage } from './lib/firmwareUpload';
  import { checkForUpdate, downloadRelease, RELEASES_URL, type ManifestEntry } from './lib/firmwareRelease';

  interface Props {
    deviceId: string | null;
    connected: boolean;
  }
  let { deviceId, connected }: Props = $props();

  // Layout of the signed firmware.bin (see src/system/ota.c and tools/sign_firmware.py)
  const APP_DESC_OFFSET = 32; // esp_image_header_t + esp_image_segment_header_t
  const APP_DESC_MAGIC = 0xabcd5432;
  const EOM_DESC_OFFSET = APP_DESC_OFFSET + 256; // right after esp_app_desc_t
  const EOM_DESC_MAGIC = 0x314d4f45;
  const SIG_TRAILER_LEN = 128;
  const SIG_MAGIC = "EOMSIG1";

  type ImageInfo = { version: string; board: string; signed: boolean };

  let info = $state(null) as DeviceInfo | null;
  let image = $state(null) as Uint8Array | null; // a hand-picked file that passed the checks
  let imageInfo = $state(null) as ImageInfo | null;
  let offer = $state(null) as ManifestEntry | null; // a newer release found by Check for updates
  let allowDowngrade = $state(false);
  let checking = $state(false);
  let busy = $state(false);
  let progress = $state(0); // 0..1
  let status = $state("");
  let checkGeneration = 0; // bumped when the EOM changes, so a check still running for the old one is dropped

  const errors: Record<number, string> = {
    [OtaResult.BUSY]: "The EOM is busy, or still checking the firmware it last installed. Try again in 30 seconds.",
    [OtaResult.WRONG_SIZE]: "This file is the wrong size for the EOM.",
    [OtaResult.TIMEOUT]: "The transfer timed out.",
    [OtaResult.OLDER]: "This is older than the installed firmware. Tick \"Allow downgrade\" to install it anyway.",
    [OtaResult.NOT_SIGNED_FOR_BOARD]: "The EOM rejected this file: it isn't signed firmware for this board.",
  };

  // A release is signed with the release key, so an EOM that refuses one was built and signed by someone else.
  const releaseErrors: Record<number, string> = {
    [OtaResult.NOT_SIGNED_FOR_BOARD]:
      "This EOM runs its own build, so it only accepts firmware signed with the same key. Install your own build, or flash a release over USB once.",
  };

  const stages: Record<UploadStage, string> = {
    preparing: "Preparing the EOM…",
    sending: "Sending firmware…",
    verifying: "Verifying…",
  };

  $effect(() => {
    checkGeneration++;
    offer = null;
    if (connected && deviceId) {
      readDeviceInfo(deviceId).then((value) => (info = value));
    } else {
      info = null;
    }
  });

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

  // The checks every image gets before it goes to the EOM, wherever it came from.
  // Returns why the EOM can't take it, or null if it can.
  function imageProblem(parsed: ImageInfo | null, bytes: Uint8Array): string | null {
    if (!parsed) return "That isn't an EOM firmware file (firmware.bin from the build).";
    if (!parsed.signed) return "This firmware isn't signed, so the EOM won't install it.";
    if (info && parsed.board !== info.board) return `This firmware is for ${parsed.board}, but this EOM is ${info.board}.`;
    if (info && bytes.length > info.maxSize) return "This firmware is too big for the EOM.";
    return null;
  }

  async function chooseFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    status = "";
    image = null;
    imageInfo = null;
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    imageInfo = parseImage(bytes);
    const problem = imageProblem(imageInfo, bytes);
    if (problem) {
      status = problem;
    } else {
      image = bytes;
    }
  }

  async function check() {
    if (!info) return;
    const installed = info;
    const generation = checkGeneration;
    checking = true;
    offer = null;
    status = "Checking for updates…";
    try {
      const choice = await checkForUpdate(installed, { fetch: (url) => fetch(url, { cache: "no-cache" }), baseUrl: RELEASES_URL });
      if (generation !== checkGeneration) return;
      if (choice.kind === "offer") {
        offer = choice.entry;
        status = `${choice.entry.version} is available.`;
      } else if (choice.kind === "up-to-date") {
        status = `This EOM is up to date (${installed.version}).`;
      } else {
        status = `There's no release for this EOM's board (${installed.board}).`;
      }
    } catch (error: any) {
      console.error("Check for updates failed:", error);
      if (generation === checkGeneration) status = error?.message ?? String(error);
    } finally {
      checking = false;
    }
  }

  type InstallOptions = {
    allowDowngrade: boolean;
    messages: Record<number, string>; // overrides for the EOM's result codes
  };

  // Sends the image to the EOM, reporting progress in the panel. Leaves the panel idle whatever happens.
  async function install(getImage: () => Promise<Uint8Array>, options: InstallOptions) {
    if (!deviceId || !info) return;
    const uploader = bleUploader(deviceId, info);
    busy = true;
    progress = 0;
    try {
      const bytes = await getImage();
      const result = await uploader.upload(bytes, {
        allowDowngrade: options.allowDowngrade,
        onProgress: (fraction, stage) => {
          progress = fraction;
          status = stages[stage];
        },
      });
      if (result !== OtaResult.OK) {
        const message = options.messages[result] ?? errors[result];
        throw new Error(message ?? `The update failed (error 0x${(result >>> 0).toString(16)}).`);
      }
      progress = 1;
      status = "Firmware installed. The EOM is restarting; reconnect in a few seconds.";
      image = null;
      imageInfo = null;
      offer = null;
    } catch (error: any) {
      console.error("Firmware update failed:", error);
      status = error?.message ?? String(error);
    } finally {
      busy = false;
    }
  }

  function installFile() {
    const bytes = image;
    if (bytes) install(async () => bytes, { allowDowngrade, messages: {} });
  }

  function installRelease() {
    const entry = offer;
    if (!entry) return;
    install(async () => {
      status = `Downloading ${entry.version}…`;
      const bytes = await downloadRelease(entry, { fetch: (url) => fetch(url) });
      const problem = imageProblem(parseImage(bytes), bytes);
      if (problem) throw new Error(problem);
      return bytes;
    }, { allowDowngrade: false, messages: releaseErrors });
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
  <button onclick={check} disabled={busy || checking}>Check for updates</button>
  {#if offer}
    <button onclick={installRelease} disabled={busy || checking || !info.confirmed}>Install {offer.version}</button>
  {/if}
  <input type="file" accept=".bin" disabled={busy || checking} onchange={chooseFile} />
  {#if imageInfo}
    <p>File: {imageInfo.version} ({imageInfo.board})</p>
  {/if}
  <label>
    <input type="checkbox" bind:checked={allowDowngrade} disabled={busy} />
    Allow downgrade
  </label>
  <button onclick={installFile} disabled={busy || checking || !image || !info.confirmed}>Install</button>
  {#if busy || progress > 0}
    <progress value={progress} max="1" style="width: 100%;"></progress>
  {/if}
{/if}
{#if status}
  <p>{status}</p>
{/if}
