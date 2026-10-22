// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareVersions, firmwareWarning, isFirmwareSupported, selectRelease, manifestUrl, checkForUpdate, downloadRelease, type Manifest, type ManifestEntry } from "../src/lib/firmwareRelease.ts";

const BASE = "https://example.test/eom/firmware";

// A fetch that serves fixed bodies by URL and records what was asked for.
function fakeFetch(routes: Record<string, unknown>) {
  const requested: string[] = [];
  const fetch = async (url: string) => {
    requested.push(url);
    if (!(url in routes)) return new Response("not found", { status: 404 });
    const body = routes[url];
    return new Response(body instanceof Uint8Array || typeof body === "string" ? (body as BodyInit) : JSON.stringify(body));
  };
  return { fetch, requested };
}

function manifest(version: string, envs = ["esp32dev", "m5stack_atom_echo"]): Manifest {
  return {
    version,
    firmware: envs.map((env) => ({
      env,
      version,
      url: `${BASE}/${version}/firmware-${env}.bin`,
      sha256: "00".repeat(32),
      size: 1000,
    })),
  };
}

test("compareVersions orders prereleases numerically, below their release", () => {
  assert.ok(compareVersions("3.7.0-beta.2", "3.7.0-beta.10") < 0);
  assert.ok(compareVersions("3.7.0-beta.10", "3.7.0") < 0);
  assert.ok(compareVersions("3.7.0", "3.7.0-beta.2") > 0);
});

test("compareVersions compares each part as a number, and equal versions as 0", () => {
  assert.ok(compareVersions("3.6.0", "3.6.1") < 0);
  assert.ok(compareVersions("3.10.0", "3.9.9") > 0);
  assert.equal(compareVersions("3.7.0", "3.7.0"), 0);
  assert.equal(compareVersions("3.7.0-beta.4", "3.7.0-beta.4"), 0);
});

test("compareVersions refuses something that isn't a version", () => {
  for (const bad of ["", "v3.7.0", "3.7", "3.7.0-", "abc1234-dirty"]) {
    assert.throws(() => compareVersions(bad, "3.7.0"), RangeError, bad);
    assert.throws(() => compareVersions("3.7.0", bad), RangeError, bad);
  }
});

test("an EOM on a stable release reads the stable manifest, and one on a beta reads the beta one", () => {
  assert.equal(manifestUrl("3.6.0", BASE), `${BASE}/manifest.json`);
  assert.equal(manifestUrl("3.7.0-beta.2", BASE), `${BASE}/manifest-beta.json`);
});

test("a newer release for the EOM's board is offered", () => {
  const choice = selectRelease({ version: "3.6.0", board: "esp32dev" }, manifest("3.6.1"));
  assert.equal(choice.kind, "offer");
  assert.equal(choice.kind === "offer" && choice.entry.url, `${BASE}/3.6.1/firmware-esp32dev.bin`);
});

test("an EOM on a beta is offered the next beta or the release", () => {
  const info = { version: "3.7.0-beta.2", board: "m5stack_atom_echo" };
  assert.equal(selectRelease(info, manifest("3.7.0-beta.3")).kind, "offer");
  assert.equal(selectRelease(info, manifest("3.7.0")).kind, "offer");
});

test("an EOM on the newest release, or a newer one, is up to date and never offered a downgrade", () => {
  assert.equal(selectRelease({ version: "3.6.1", board: "esp32dev" }, manifest("3.6.1")).kind, "up-to-date");
  assert.equal(selectRelease({ version: "3.6.0", board: "esp32dev" }, manifest("3.5.2")).kind, "up-to-date");
  assert.equal(selectRelease({ version: "3.7.0", board: "esp32dev" }, manifest("3.7.0-beta.4")).kind, "up-to-date");
});

test("a board missing from the manifest has no release", () => {
  assert.equal(selectRelease({ version: "3.6.0", board: "my_custom_board" }, manifest("3.6.1")).kind, "no-release");
});

test("checkForUpdate reads the channel's manifest and offers a newer release", async () => {
  const { fetch, requested } = fakeFetch({ [`${BASE}/manifest-beta.json`]: manifest("3.7.0-beta.4") });
  const choice = await checkForUpdate({ version: "3.7.0-beta.3", board: "esp32dev" }, { fetch, baseUrl: BASE });
  assert.deepEqual(requested, [`${BASE}/manifest-beta.json`]);
  assert.equal(choice.kind === "offer" && choice.entry.version, "3.7.0-beta.4");
});

test("checkForUpdate says so plainly when the network fails or the manifest is missing", async () => {
  const installed = { version: "3.6.0", board: "esp32dev" };
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(checkForUpdate(installed, { fetch: offline, baseUrl: BASE }), {
    message: "Couldn't reach the release site. Check your internet connection.",
  });
  await assert.rejects(checkForUpdate(installed, { fetch: fakeFetch({}).fetch, baseUrl: BASE }), {
    message: "Couldn't get the release list (HTTP 404).",
  });
});

test("checkForUpdate refuses a malformed manifest", async () => {
  const installed = { version: "3.6.0", board: "esp32dev" };
  const good = manifest("3.6.1").firmware[0];
  const bad: unknown[] = [
    "not json {",
    { version: "3.6.1" },
    { version: "3.6.1", firmware: "nope" },
    { version: "3.6.1", firmware: [{ ...good, version: "latest" }] },
    { version: "3.6.1", firmware: [{ ...good, sha256: "abc" }] },
    { version: "3.6.1", firmware: [{ ...good, size: -1 }] },
    { version: "3.6.1", firmware: [{ ...good, url: 42 }] },
  ];
  for (const body of bad) {
    const { fetch } = fakeFetch({ [`${BASE}/manifest.json`]: body });
    await assert.rejects(
      checkForUpdate(installed, { fetch, baseUrl: BASE }),
      { message: "The release list is damaged. Try again later." },
      JSON.stringify(body),
    );
  }
});

test("checkForUpdate can't compare against an EOM whose version isn't a release version", async () => {
  const { fetch } = fakeFetch({ [`${BASE}/manifest.json`]: manifest("3.6.1") });
  await assert.rejects(checkForUpdate({ version: "abc1234-dirty", board: "esp32dev" }, { fetch, baseUrl: BASE }), {
    message: "Can't check for updates: this EOM reports version \"abc1234-dirty\", which isn't a release version.",
  });
});

const IMAGE = new Uint8Array(4096).map((_, i) => (i * 7) % 256);
const IMAGE_URL = `${BASE}/3.6.1/firmware-esp32dev.bin`;
const imageEntry = (changes: Partial<ManifestEntry> = {}): ManifestEntry => ({
  env: "esp32dev",
  version: "3.6.1",
  url: IMAGE_URL,
  sha256: createHash("sha256").update(IMAGE).digest("hex"),
  size: IMAGE.length,
  ...changes,
});

test("downloadRelease returns the image when its size and SHA-256 match the manifest", async () => {
  const { fetch } = fakeFetch({ [IMAGE_URL]: IMAGE });
  assert.deepEqual(await downloadRelease(imageEntry(), { fetch }), IMAGE);
});

test("downloadRelease refuses an image whose size or SHA-256 doesn't match", async () => {
  const { fetch } = fakeFetch({ [IMAGE_URL]: IMAGE });
  await assert.rejects(downloadRelease(imageEntry({ size: IMAGE.length + 1 }), { fetch }), {
    message: "The downloaded firmware is damaged (wrong size), so it wasn't installed. Try again.",
  });
  await assert.rejects(downloadRelease(imageEntry({ sha256: "ab".repeat(32) }), { fetch }), {
    message: "The downloaded firmware is damaged (checksum mismatch), so it wasn't installed. Try again.",
  });
});

test("downloadRelease says so plainly when the image can't be fetched", async () => {
  await assert.rejects(downloadRelease(imageEntry(), { fetch: fakeFetch({}).fetch }), {
    message: "Couldn't get the firmware (HTTP 404).",
  });
});

test("a connection that drops partway through still gets a plain sentence", async () => {
  // A response whose body fails after the headers arrived.
  const dropping = async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new TypeError("network error"));
        },
      }),
    );
  const offline = { message: "Couldn't reach the release site. Check your internet connection." };
  await assert.rejects(checkForUpdate({ version: "3.6.0", board: "esp32dev" }, { fetch: dropping, baseUrl: BASE }), offline);
  await assert.rejects(downloadRelease(imageEntry(), { fetch: dropping }), offline);
});

test("isFirmwareSupported accepts the minimum version and newer, and refuses older", () => {
  assert.equal(isFirmwareSupported("3.8.0", "3.8.0"), true);
  assert.equal(isFirmwareSupported("3.9.1", "3.8.0"), true);
  assert.equal(isFirmwareSupported("3.7.4", "3.8.0"), false);
});

test("isFirmwareSupported counts a prerelease of the minimum as older", () => {
  assert.equal(isFirmwareSupported("3.8.0-beta.1", "3.8.0"), false);
});

test("isFirmwareSupported treats an unknown version as unsupported", () => {
  assert.equal(isFirmwareSupported(null, "3.8.0"), false);
  assert.equal(isFirmwareSupported("my-build", "3.8.0"), false);
});

test("firmwareWarning names the old or unknown version, and is null for supported firmware", () => {
  assert.equal(firmwareWarning("3.5.0", "3.8.0"), "This EOM's firmware (3.5.0) is older than this app supports (3.8.0).");
  assert.equal(firmwareWarning(null, "3.8.0"), "This EOM didn't report its firmware version, so it may be older than this app supports (3.8.0).");
  assert.equal(firmwareWarning("3.8.0", "3.8.0"), null);
});
