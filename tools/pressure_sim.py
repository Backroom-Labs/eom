"""
Adds the pressure simulator (-DEOM_PRESSURE_SIM) to every build except stable releases (PlatformIO
pre-script, see platformio.ini). Betas have it, so a beta installed from the app can be tested without a sensor.

EOM_STABLE_RELEASE=1 in the environment leaves it out. CI sets it on stable release tags (v3.8.0, not
v3.8.0-beta.4); set it by hand to build like one, e.g. `EOM_STABLE_RELEASE=1 pio run -e m5stack_atom_echo`.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

if os.environ.get("EOM_STABLE_RELEASE") == "1":
    print("EOM_STABLE_RELEASE=1: no pressure simulator")
else:
    print("With the pressure simulator (EOM_STABLE_RELEASE=1 leaves it out, as stable releases do)")
    env.Append(SRC_BUILD_FLAGS=["-DEOM_PRESSURE_SIM"])  # noqa: F821
