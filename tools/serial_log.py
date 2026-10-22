"""
Resets the board (RTS) and prints its serial output for a while. For hardware tests on the Echo.

    ~/.platformio/penv/bin/python tools/serial_log.py <port> <seconds> [--no-reset]

--no-reset attaches without resetting the board, e.g. to watch an update that's already running.
"""

import argparse
import time

import serial


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("port", help="e.g. /dev/cu.usbserial-515264F73F")
    parser.add_argument("seconds", type=float)
    parser.add_argument("--no-reset", action="store_true", help="don't reset the board first")
    args = parser.parse_args()

    port = serial.Serial(args.port, 115200, timeout=0.2)
    if not args.no_reset:
        # DTR high keeps GPIO0 up (normal boot); pulsing RTS pulls EN low.
        port.dtr = False
        port.rts = True
        time.sleep(0.1)
        port.rts = False

    end = time.monotonic() + args.seconds
    while time.monotonic() < end:
        line = port.readline()
        if line:
            print(line.decode(errors="replace").rstrip(), flush=True)


if __name__ == "__main__":
    main()
