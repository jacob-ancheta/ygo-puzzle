import { useTodayLeaderboard } from "../useTodayLeaderboard";
import LeaderboardList from "./LeaderboardList";

interface Props {
  onClose: () => void;
}

export default function LeaderboardModal({ onClose }: Props) {
  const { rows, puzzleDate, error } = useTodayLeaderboard();

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Today's top solvers{puzzleDate ? ` (${puzzleDate})` : ""}</h3>
        {error && <p className="error-banner">{error}</p>}
        {!error && rows === null && <p>Loading...</p>}
        {!error && rows !== null && rows.length === 0 && <p>Nobody's solved today's puzzle yet -- be the first!</p>}
        {!error && rows !== null && rows.length > 0 && <LeaderboardList rows={rows} />}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
