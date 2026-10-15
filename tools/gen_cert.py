"""
Generates a self-signed TLS certificate and key for the EOM's wss:// server.

Runs automatically as a PlatformIO pre-script (see platformio.ini), or standalone:
    python3 tools/gen_cert.py

The files are written to data/server.crt and data/server.key so they're included in the SPIFFS
image ("Build Filesystem Image" / "Upload Filesystem Image"). They are git-ignored: every build
machine gets its own key. Delete them to regenerate.

After flashing, visit https://<device-ip>/ once in your browser and accept the certificate so the
web UI can connect over wss://.
"""

import os
import shutil
import subprocess

try:
    Import("env")  # noqa: F821 - provided by PlatformIO/SCons
    PROJECT_DIR = env["PROJECT_DIR"]  # noqa: F821
except NameError:
    PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DATA_DIR = os.path.join(PROJECT_DIR, "data")
CERT_PATH = os.path.join(DATA_DIR, "server.crt")
KEY_PATH = os.path.join(DATA_DIR, "server.key")


def generate():
    if os.path.exists(CERT_PATH) and os.path.exists(KEY_PATH):
        return

    if shutil.which("openssl") is None:
        print("gen_cert: openssl not found; skipping certificate generation (wss:// disabled)")
        return

    print("gen_cert: generating self-signed certificate in data/")
    # EC P-256 keeps the TLS handshake fast and the heap usage low on the ESP32.
    subprocess.run(
        [
            "openssl", "req", "-x509", "-nodes",
            "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-days", "3650",
            "-subj", "/CN=eom.local",
            "-addext", "subjectAltName=DNS:eom.local,DNS:eom,IP:192.168.4.1",
            "-keyout", KEY_PATH,
            "-out", CERT_PATH,
        ],
        check=True,
    )


generate()
