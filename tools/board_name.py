"""
Defines EOM_BOARD as the PlatformIO environment name (PlatformIO pre-script, see platformio.ini).

It's stored in the app image (src/system/ota.c) so an OTA update built for another board is refused.
"""

Import("env")  # noqa: F821 - provided by PlatformIO/SCons

env.Append(SRC_BUILD_FLAGS=['-DEOM_BOARD=\\"%s\\"' % env["PIOENV"]])  # noqa: F821
