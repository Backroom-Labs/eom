# Firmware is signed with our own ECDSA trailer, not ESP-IDF signed apps

Each `firmware.bin` gets an ECDSA P-256 signature appended by `tools/sign_firmware.py`, and `ota.c` checks it before switching the boot partition. ESP-IDF's own signed-app support wasn't used because PlatformIO doesn't pass the signing key to the bootloader build.

## Consequences

- A device only accepts updates signed with the key its current firmware was built with. A device running a release only accepts releases, and one running your own build only accepts your builds.
- `keys/` is git-ignored and must be backed up. Losing it means updating devices over USB once more.
