import { useEffect, useState } from "react";
import { API_URL } from "../config";

interface LeaderboardRow {
  rank: number;
  solved_at: string;
  profiles: { display_name: string } | null;
}

interface Props {
  onClose: () => void;
}

export default function LeaderboardModal({ onClose }: Props) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [puzzleDate, setPuzzleDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/leaderboard/today`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRows(data.results ?? []);
        setPuzzleDate(data.puzzle_date ?? null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load the leaderboard."); });
    return () => { cancelled = true; };
  }, []);

  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`);

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Today's top solvers{puzzleDate ? ` (${puzzleDate})` : ""}</h3>
        {error && <p className="error-banner">{error}</p>}
        {!error && rows === null && <p>Loading...</p>}
        {!error && rows !== null && rows.length === 0 && <p>Nobody's solved today's puzzle yet -- be the first!</p>}
        {!error && rows !== null && rows.length > 0 && (
          <ul className="modal-list">
            {rows.map((row) => (
              <li key={row.rank}>
                {medal(row.rank)} {row.profiles?.display_name ?? "unknown"}
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
