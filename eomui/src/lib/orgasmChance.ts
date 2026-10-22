// Orgasm chance: in Orgasm mode the EOM rolls when a round's edging time or denial target is
// reached, and a lost roll is a denial that starts another full round. The status snapshot carries
// the session's lost rolls (chanceDenials) and its total denials, not the round's, so the app
// follows where the round started.

type Counts = { denied?: number; chanceDenials?: number };

export function deniedByChance(prev: Counts, next: Counts): boolean {
  return (next.chanceDenials ?? 0) > (prev.chanceDenials ?? 0);
}

// The session's denied count when the current round started, or null if the app missed it.
// `continuous` is false when prev isn't the reading just before next (connecting, reconnecting).
export function nextRoundStart(start: number | null, prev: Counts, next: Counts, continuous: boolean): number | null {
  const denied = next.denied ?? 0;
  if ((next.chanceDenials ?? 0) === 0) return 0;
  if (continuous && denied < (prev.denied ?? 0)) return 0;
  if (deniedByChance(prev, next)) {
    // The lost roll is the new round's first denial; more than one since prev can't be placed.
    return continuous && (next.chanceDenials ?? 0) - (prev.chanceDenials ?? 0) === 1 ? denied - 1 : null;
  }
  return start;
}

// Denials left before the EOM permits an orgasm this round, or null when there's no denial target
// (Denials before orgasm 0 or 100+) or the round's start is unknown. The EOM permits once a round has
// more denials than maxDenied.
export function denialsUntilPermitted(maxDenied: number, denied: number, start: number | null): number | null {
  if (start === null || maxDenied <= 0 || maxDenied >= 100) return null;
  const left = maxDenied + 1 - (denied - start);
  return left > 0 ? left : null;
}
