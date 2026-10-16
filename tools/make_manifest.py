"""
Writes manifest.json for a firmware release (run by .github/workflows/release.yml).

    python3 tools/make_manifest.py <dist dir> --base-url <url> --version <x.y.z>

<dist dir> holds one firmware-<env>.bin per PlatformIO environment. Each image is checked before it
goes in the manifest: it must be signed, built for <env>, and carry <version> in its app descriptor.

    {
      "version": "2.0.1",
      "firmware": [
        {"env": "esp32dev", "version": "2.0.1", "url": "<base url>/firmware-esp32dev.bin",
         "sha256": "<hex>", "size": 1234567},
        ...
      ]
    }

Every OTA path (BLE from the app, later WiFi) picks its entry by matching "env" against the board
name the device reports, so this file is the one source of truth for what a release contains.
"""

import argparse
import hashlib
import json
import os
import re
import struct
import sys

# Image layout; must match src/system/ota.c, tools/sign_firmware.py and eomui/src/FirmwareUpdate.svelte
APP_DESC_OFFSET = 32  # esp_image_header_t + esp_image_segment_header_t
APP_DESC_MAGIC = 0xABCD5432
EOM_DESC_OFFSET = APP_DESC_OFFSET + 256  # right after esp_app_desc_t
EOM_DESC_MAGIC = 0x314D4F45
SIG_MAGIC = b"EOMSIG1\0"
SIG_TRAILER_LEN = 128

NAME_RE = re.compile(r"^firmware-(.+)\.bin$")


def c_string(data, offset, length):
    return data[offset : offset + length].split(b"\0", 1)[0].decode("utf-8", "replace")


def describe(path, env, version, url):
    with open(path, "rb") as f:
        data = f.read()

    if len(data) < EOM_DESC_OFFSET + 36 + SIG_TRAILER_LEN or data[0] != 0xE9:
        raise ValueError("not an ESP32 app image")
    if struct.unpack_from("<I", data, APP_DESC_OFFSET)[0] != APP_DESC_MAGIC:
        raise ValueError("no app descriptor")
    if struct.unpack_from("<I", data, EOM_DESC_OFFSET)[0] != EOM_DESC_MAGIC:
        raise ValueError("no EOM descriptor (board name)")
    if not data[-SIG_TRAILER_LEN:].startswith(SIG_MAGIC):
        raise ValueError("not signed")

    image_version = c_string(data, APP_DESC_OFFSET + 16, 32)
    board = c_string(data, EOM_DESC_OFFSET + 4, 32)
    if board != env:
        raise ValueError("built for board %r, not %r" % (board, env))
    if image_version != version:
        raise ValueError("version %r, expected %r" % (image_version, version))

    return {
        "env": env,
        "version": image_version,
        "url": url,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("dist", help="directory containing firmware-<env>.bin files")
    parser.add_argument("--base-url", required=True, help="URL the .bin files are published under")
    parser.add_argument("--version", required=True, help="release version every image must carry")
    parser.add_argument("--output", help="manifest path (default: <dist>/manifest.json)")
    args = parser.parse_args()

    firmware = []
    errors = []
    for name in sorted(os.listdir(args.dist)):
        match = NAME_RE.match(name)
        if not match:
            continue
        try:
            url = "%s/%s" % (args.base_url.rstrip("/"), name)
            entry = describe(os.path.join(args.dist, name), match.group(1), args.version, url)
        except ValueError as e:
            errors.append("%s: %s" % (name, e))
            continue
        firmware.append(entry)

    if errors:
        sys.exit("make_manifest: refusing to publish:\n  " + "\n  ".join(errors))
    if not firmware:
        sys.exit("make_manifest: no firmware-<env>.bin files in %s" % args.dist)

    output = args.output or os.path.join(args.dist, "manifest.json")
    with open(output, "w") as f:
        json.dump({"version": args.version, "firmware": firmware}, f, indent=2)
        f.write("\n")

    for entry in firmware:
        print("%-32s %s  %8d bytes" % (entry["env"], entry["sha256"][:12], entry["size"]))
    print("make_manifest: wrote %s (%d images)" % (output, len(firmware)))


if __name__ == "__main__":
    main()
