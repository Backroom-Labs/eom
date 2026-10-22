// Check for updates: finds the newest release for the connected EOM's board on its release channel.
// Releases are published to the Pages site (docs/adr/0011-releases-served-from-public-pages-site.md).

// Where the manifests live. Set VITE_RELEASES_URL at build time to test against a local server
// (for example `VITE_RELEASES_URL=http://localhost:8000 npm run dev`).
export const RELEASES_URL: string =
  (import.meta as any).env?.VITE_RELEASES_URL ?? "https://backroom-labs.github.io/eom/firmware";

type Version = { core: number[]; pre: (number | string)[] };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): Version {
  const match = SEMVER.exec(version);
  if (!match) throw new RangeError(`Not a version: ${version}`);
  const pre = match[4] ? match[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

// Semver precedence: negative if a is older than b, 0 if equal, positive if newer.
// Throws a RangeError if either isn't a version.
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  }
  // A release is newer than any of its prereleases.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    // Numeric identifiers sort before alphanumeric ones.
    if (typeof p === "number") return -1;
    if (typeof q === "number") return 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

// One image in a release manifest (tools/make_manifest.py writes these).
export type ManifestEntry = { env: string; version: string; url: string; sha256: string; size: number };
export type Manifest = { version: string; firmware: ManifestEntry[] };

// What the EOM reports about itself: its installed version and its board (the PlatformIO env name).
export type Installed = { version: string; board: string };

export type ReleaseChoice =
  | { kind: "offer"; entry: ManifestEntry }
  | { kind: "up-to-date" }
  | { kind: "no-release" };

function isPrerelease(version: string): boolean {
  return parseVersion(version).pre.length > 0;
}

// The release channel: an EOM on a beta is offered the newest release of either kind,
// one on a stable release only stable releases.
export function manifestUrl(installedVersion: string, baseUrl: string): string {
  return `${baseUrl}/${isPrerelease(installedVersion) ? "manifest-beta.json" : "manifest.json"}`;
}

// Picks the image for this EOM's board, offering it only if it's newer than what's installed.
export function selectRelease(installed: Installed, manifest: Manifest): ReleaseChoice {
  const entry = manifest.firmware.find((e) => e.env === installed.board);
  if (!entry) return { kind: "no-release" };
  return compareVersions(entry.version, installed.version) > 0 ? { kind: "offer", entry } : { kind: "up-to-date" };
}

export type Fetch = (url: string) => Promise<Response>;
export type ReleaseSource = { fetch: Fetch; baseUrl: string };

// Fetches url, turning a network failure or a non-200 status into a sentence for the panel.
async function get(fetch: Fetch, url: string, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("Couldn't reach the release site. Check your internet connection.");
  }
  if (!response.ok) throw new Error(`Couldn't get ${what} (HTTP ${response.status}).`);
  return response;
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && SEMVER.test(value);
}

function isEntry(value: any): value is ManifestEntry {
  return (
    typeof value?.env === "string" &&
    isVersion(value.version) &&
    typeof value.url === "string" &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    Number.isSafeInteger(value.size) &&
    value.size > 0
  );
}

// Checks the manifest's shape, so nothing later trusts a broken one.
function parseManifest(text: string): Manifest {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (!isVersion(value?.version) || !Array.isArray(value.firmware) || !value.firmware.every(isEntry)) {
    throw new Error("The release list is damaged. Try again later.");
  }
  return value;
}

// Fetches the manifest for this EOM's release channel and picks what to offer.
export async function checkForUpdate(installed: Installed, source: ReleaseSource): Promise<ReleaseChoice> {
  if (!isVersion(installed.version)) {
    throw new Error(`Can't check for updates: this EOM reports version "${installed.version}", which isn't a release version.`);
  }
  const response = await get(source.fetch, manifestUrl(installed.version, source.baseUrl), "the release list");
  return selectRelease(installed, parseManifest(await response.text()));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Downloads a release image and checks it against the manifest before anything is sent to the EOM.
export async function downloadRelease(entry: ManifestEntry, source: { fetch: Fetch }): Promise<Uint8Array> {
  const response = await get(source.fetch, entry.url, "the firmware");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== entry.size) {
    throw new Error("The downloaded firmware is damaged (wrong size), so it wasn't installed. Try again.");
  }
  if ((await sha256Hex(bytes)) !== entry.sha256) {
    throw new Error("The downloaded firmware is damaged (checksum mismatch), so it wasn't installed. Try again.");
  }
  return bytes;
}
