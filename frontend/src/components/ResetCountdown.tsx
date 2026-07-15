import { useEffect, useState } from "react";
import { msUntilNextRotation } from "../resetTime";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ResetCountdown() {
  const [remainingMs, setRemainingMs] = useState(msUntilNextRotation);

  useEffect(() => {
    const id = setInterval(() => setRemainingMs(msUntilNextRotation()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="reset-countdown" title="Time until today's puzzle rotates (4pm Eastern)">
      Resets in {formatDuration(remainingMs)}
    </div>
  );
}
