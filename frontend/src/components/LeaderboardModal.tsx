import { useTodayLeaderboard } from "../useTodayLeaderboard";

interface Props {
  onClose: () => void;
}

export default function LeaderboardModal({ onClose }: Props) {
  const { rows, puzzleDate, error } = useTodayLeaderboard();

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
