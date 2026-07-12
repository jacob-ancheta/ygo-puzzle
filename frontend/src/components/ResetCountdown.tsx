import { useEffect, useState } from "react";

// Puzzles rotate at midnight America/New_York (see backend/puzzle_registry.py's
// ROTATION_TZ) -- this mirrors that in JS via the standard "round-trip
// through a locale string" trick rather than pulling in a timezone library
// for one countdown display. Good enough for a cosmetic timer; a day-of-DST
// transition may be off by up to an hour, which self-corrects the moment
// the tick after rollover runs.
function msUntilNextEasternMidnight(): number {
  const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const next = new Date(nowEastern);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - nowEastern.getTime();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ResetCountdown() {
  const [remainingMs, setRemainingMs] = useState(msUntilNextEasternMidnight);

  useEffect(() => {
    const id = setInterval(() => setRemainingMs(msUntilNextEasternMidnight()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="reset-countdown" title="Time until today's puzzle rotates (midnight Eastern)">
      Resets in {formatDuration(remainingMs)}
    </div>
  );
}
