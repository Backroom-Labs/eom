# Leave the pressure ambient as a uint8_t

`pressure_ambient` in `eom-hal-esp32.c` is a `uint8_t`, so the boot ambient is the mean raw ADC value mod 256 and analog readings are effectively raw ADC. This looks like a bug but is left alone (decided 2026-10-17): everything downstream is relative (arousal is peak-to-peak, the clench threshold adapts, resting pressure is followed), so nothing depends on the ambient being right.

## Considered options

- **Change only the type.** Breaks setup: the ambient is averaged from readings that already subtract it, and any reading below it re-runs setup, so it would oscillate.
- **Fix it properly.** Resting pressure would sit at 0, which trips the "same value for 30 s" safety stop, and readings could no longer reach `EOM_HAL_PRESSURE_MAX`, so the "pinned at max" check stops working.

Revisit only when an MPR board is built. MPR needs an `int32_t` ambient from the raw 24-bit data and a real sensor to test; the pressure simulator skips this code.
