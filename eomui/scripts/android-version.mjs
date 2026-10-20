// Turns a release tag (v3.5.0, v3.6.0-beta.2) into the Android app's versionName and versionCode.
// The code must go up with every release, or Android won't install it over the last one, so it's
//   major·1000000 + minor·10000 + patch·100 + (prerelease number, or 99 for a release)
// which puts v3.6.0-beta.2 (3060002) above v3.5.0 (3050099) and below v3.6.0 (3060099).
// Prereleases of one version must be numbered upwards across labels: beta.1, beta.2, rc.3.
//
// CI: node scripts/android-version.mjs "$GITHUB_REF_NAME" >> "$GITHUB_OUTPUT"
import { fileURLToPath } from "node:url";

export function androidVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!match) throw new Error(`"${tag}" isn't a version tag like v1.2.3 or v1.2.3-beta.1`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const pre = match[4];
  if (minor > 99 || patch > 99) throw new Error(`"${tag}": minor and patch must be 99 or less`);
  let last = 99;
  if (pre) {
    const number = /(\d+)$/.exec(pre);
    if (!number || Number(number[1]) > 98) {
      throw new Error(`"${tag}": a prerelease must end in a number from 0 to 98, like -beta.1`);
    }
    last = Number(number[1]);
  }
  return { versionName: tag.slice(1), versionCode: major * 1_000_000 + minor * 10_000 + patch * 100 + last };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { versionName, versionCode } = androidVersion(process.argv[2] ?? "");
    console.log(`versionName=${versionName}\nversionCode=${versionCode}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
