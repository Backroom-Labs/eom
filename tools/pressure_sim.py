"""
Adds the pressure simulator (-DEOM_PRESSURE_SIM) to every build that isn't a release (PlatformIO
pre-script, see platformio.ini).

A release is a build with EOM_RELEASE=1 in the environment: CI sets it on v* tag builds, and you can
set it by hand for a release-like build, e.g. `EOM_RELEASE=1 pio run -e m5stack_atom_echo`.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

if os.environ.get("EOM_RELEASE") == "1":
    print("Release build: no pressure simulator")
else:
    print("Dev build: with the pressure simulator (set EOM_RELEASE=1 for a release build)")
    env.Append(SRC_BUILD_FLAGS=["-DEOM_PRESSURE_SIM"])  # noqa: F821
