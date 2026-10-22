// The pressure simulator, for testing without a sensor. Only firmware that isn't a release has it,
// and it says so in the info it reports at connect (WebSocket `info`, Bluetooth update info).

// Whether that info reports the simulator. Firmware without the field has none.
export function reportsPressureSim(info: unknown): boolean {
  return typeof info === "object" && info !== null && (info as { pressureSim?: unknown }).pressureSim === true;
}

// The simPressure value to send when the toggle changes or the EOM connects, or null to send
// nothing. -1 sends the EOM back to the real sensor.
export function simPressureToSend(available: boolean, enabled: boolean, pressure: number): number | null {
  if (!available) return null;
  return enabled ? pressure : -1;
}
