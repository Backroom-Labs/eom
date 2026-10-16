"""
Lets "Build Filesystem Image" work while data/config.json is also embedded in the firmware
(PlatformIO post-script, see platformio.ini).

PlatformIO's ESP-IDF builder turns each embed_txtfiles entry into assembly with a SCons builder that
first names its target after the source minus its extension (data/config) before redirecting it to
the build directory. That leaves a phantom data/config node behind, and because it sits in the data
directory, building spiffs.bin fails with:

    Implicit dependency `data/config' not found, needed by target `.pio/build/<env>/spiffs.bin'.

This removes those phantom nodes.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

data_dir = env.Dir("$PROJECT_DATA_DIR")  # noqa: F821
for name in list(data_dir.entries):
    node = data_dir.entries[name]
    if name in (".", "..") or node.exists() or node.has_builder():
        continue
    # Only drop the leftovers of embedded files: <name>.<ext> exists next to it.
    if any(other.startswith(name + ".") for other in data_dir.entries):
        del data_dir.entries[name]
