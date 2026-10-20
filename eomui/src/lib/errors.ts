// What went wrong, for showing to the user: an Error's message, or whatever else was thrown.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
