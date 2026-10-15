"""
Generates the ECDSA P-256 key pair used to sign firmware for OTA updates.

Runs automatically as a PlatformIO pre-script (see platformio.ini), or standalone:
    python3 tools/gen_signing_keys.py

    keys/ota_signing_key.pem   private key, used by tools/sign_firmware.py
    keys/ota_signing_pub.pem   public key, compiled into the firmware to verify updates

The keys are git-ignored. A device only accepts OTA updates signed with the key its current
firmware was built with; anything else has to be installed over USB. Back these files up, and
give release builds (CI) the same keys.
"""

import os
import shutil
import subprocess
import sys

try:
    Import("env")  # noqa: F821 - provided by PlatformIO/SCons
    PROJECT_DIR = env["PROJECT_DIR"]  # noqa: F821
except NameError:
    PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KEYS_DIR = os.path.join(PROJECT_DIR, "keys")
PRIVATE_KEY = os.path.join(KEYS_DIR, "ota_signing_key.pem")
PUBLIC_KEY = os.path.join(KEYS_DIR, "ota_signing_pub.pem")


def generate():
    if shutil.which("openssl") is None:
        sys.stderr.write("gen_signing_keys: openssl not found; it's needed to sign OTA firmware\n")
        sys.exit(1)

    os.makedirs(KEYS_DIR, exist_ok=True)

    if not os.path.exists(PRIVATE_KEY):
        subprocess.run(
            ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", PRIVATE_KEY],
            check=True,
        )
        print("gen_signing_keys: generated a new OTA signing key in keys/. BACK IT UP: devices only")
        print("                  accept OTA updates signed with the key their firmware was built with.")

    if not os.path.exists(PUBLIC_KEY) or os.path.getmtime(PUBLIC_KEY) < os.path.getmtime(PRIVATE_KEY):
        subprocess.run(
            ["openssl", "ec", "-in", PRIVATE_KEY, "-pubout", "-out", PUBLIC_KEY],
            check=True,
            stderr=subprocess.DEVNULL,
        )


generate()
