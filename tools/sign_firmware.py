"""
Appends an OTA signature trailer to firmware.bin (PlatformIO post-script, see platformio.ini).

    [ app image ][ trailer: 128 bytes ]
    trailer = "EOMSIG1\\0" | signature length (uint16 LE) | DER ECDSA P-256 signature | zero padding

The signature covers the SHA-256 of the app image. src/system/ota.c checks it against the public key
compiled into the running firmware before it will boot an update. The bootloader ignores the
trailer, so the same file can still be flashed over USB.

Keys come from tools/gen_signing_keys.py.
"""

import os
import struct
import subprocess

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

PRIVATE_KEY = os.path.join(env["PROJECT_DIR"], "keys", "ota_signing_key.pem")  # noqa: F821

# Must match OTA_SIG_MAGIC / OTA_SIG_TRAILER_LEN in src/system/ota.c
SIG_MAGIC = b"EOMSIG1\0"
TRAILER_LEN = 128


def sign_firmware(target, source, env):
    path = str(target[0])
    with open(path, "rb") as f:
        image = f.read()
    if len(image) >= TRAILER_LEN and image[-TRAILER_LEN:].startswith(SIG_MAGIC):
        image = image[:-TRAILER_LEN]

    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", PRIVATE_KEY],
        input=image,
        stdout=subprocess.PIPE,
        check=True,
    ).stdout

    trailer = SIG_MAGIC + struct.pack("<H", len(signature)) + signature
    trailer += b"\0" * (TRAILER_LEN - len(trailer))
    with open(path, "wb") as f:
        f.write(image + trailer)

    print("Signed %s for OTA (%d byte image)" % (os.path.basename(path), len(image)))


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", sign_firmware)  # noqa: F821
