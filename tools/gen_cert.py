"""
Generates a self-signed TLS certificate and key for the EOM's wss:// server.

Runs automatically as a PlatformIO pre-script (see platformio.ini), or standalone:
    python3 tools/gen_cert.py

The files are written to data/server.crt and data/server.key so they're included in the SPIFFS
image ("Build Filesystem Image" / "Upload Filesystem Image"). They are git-ignored: every build
machine gets its own key. Delete them to regenerate.

The key names the P-256 curve: mbedTLS rejects explicit curve parameters, which LibreSSL (macOS's
openssl) writes by default, so a pair that has them is regenerated.

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


def uses_explicit_ec_params(cert_path):
    """True if the cert's EC key spells out the curve (prime, A, B, ...) instead of naming it."""
    result = subprocess.run(
        ["openssl", "x509", "-noout", "-text", "-in", cert_path],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and "Field Type: prime-field" in result.stdout


def generate():
    have_pair = os.path.exists(CERT_PATH) and os.path.exists(KEY_PATH)
    if shutil.which("openssl") is None:
        if not have_pair:
            print("gen_cert: openssl not found; skipping certificate generation (wss:// disabled)")
        return

    if have_pair:
        if not uses_explicit_ec_params(CERT_PATH):
            return
        print("gen_cert: data/server.crt uses explicit EC parameters, which mbedTLS can't parse; regenerating")
    else:
        print("gen_cert: generating self-signed certificate in data/")

    # EC P-256 keeps the TLS handshake fast and the heap usage low on the ESP32. ec_param_enc
    # makes LibreSSL name the curve as OpenSSL 3 does by default.
    subprocess.run(
        [
            "openssl", "req", "-x509", "-nodes",
            "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
            "-pkeyopt", "ec_param_enc:named_curve",
            "-days", "3650",
            "-subj", "/CN=eom.local",
            "-addext", "subjectAltName=DNS:eom.local,DNS:eom,IP:192.168.4.1",
            "-keyout", KEY_PATH,
            "-out", CERT_PATH,
        ],
        check=True,
    )


generate()
