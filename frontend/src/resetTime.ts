// Puzzles rotate at 4pm America/New_York (see backend/puzzle_registry.py's
// ROTATION_HOUR) -- mirrored here via the standard "round-trip through a
// locale string" trick rather than pulling in a timezone library for this.
// Shared by ResetCountdown (cosmetic display) and App.tsx's actual
// auto-reconnect-at-rotation effect, so both ever only agree on one
// definition of "when".
const ROTATION_HOUR = 16;

export function msUntilNextRotation(): number {
  const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const next = new Date(nowEastern);
  next.setHours(ROTATION_HOUR, 0, 0, 0);
  if (next.getTime() <= nowEastern.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - nowEastern.getTime();
}
