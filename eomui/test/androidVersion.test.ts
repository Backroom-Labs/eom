// Run from eomui/: node --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { androidVersion } from "../scripts/android-version.mjs";

test("a release tag gives its version and a code ending in 99", () => {
  assert.deepEqual(androidVersion("v3.5.0"), { versionName: "3.5.0", versionCode: 3050099 });
});

test("a prerelease uses its number, so it installs under the release it leads to", () => {
  assert.deepEqual(androidVersion("v3.6.0-beta.2"), { versionName: "3.6.0-beta.2", versionCode: 3060002 });
  assert.ok(androidVersion("v3.6.0-rc.3").versionCode < androidVersion("v3.6.0").versionCode);
  assert.ok(androidVersion("v3.6.0-beta.1").versionCode > androidVersion("v3.5.9").versionCode);
});

test("tags that can't give an increasing code are refused with the reason", () => {
  assert.throws(() => androidVersion("3.5.0"), /v1\.2\.3/);
  assert.throws(() => androidVersion("v3.100.0"), /minor and patch/);
  assert.throws(() => androidVersion("v3.6.0-beta"), /prerelease/);
  assert.throws(() => androidVersion("v3.6.0-beta.99"), /prerelease/);
  assert.throws(() => androidVersion("v3.6.0-beta;rm.1"), /v1\.2\.3/);
});
