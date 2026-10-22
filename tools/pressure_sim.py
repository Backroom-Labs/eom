"""
Adds the pressure simulator (-DEOM_PRESSURE_SIM) to every build that isn't a release (PlatformIO
pre-script, see platformio.ini).

EOM_RELEASE=1 in the environment leaves it out. CI sets it on v* tag builds (releases); set it by hand
for a release-like build, e.g. `EOM_RELEASE=1 pio run -e m5stack_atom_echo`.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

if os.environ.get("EOM_RELEASE") == "1":
    print("EOM_RELEASE=1: no pressure simulator")
else:
    print("With the pressure simulator (EOM_RELEASE=1 leaves it out, as releases do)")
    env.Append(SRC_BUILD_FLAGS=["-DEOM_PRESSURE_SIM"])  # noqa: F821
