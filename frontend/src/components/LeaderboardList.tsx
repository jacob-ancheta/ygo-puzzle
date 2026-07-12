import type { LeaderboardRow } from "../useTodayLeaderboard";

export const medalEmoji = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`);

interface Props {
  rows: LeaderboardRow[];
}

// Shared between LeaderboardModal and WinModal -- today's rank/name stays
// left, each person's lifetime medal counts are anchored right on the same
// row.
export default function LeaderboardList({ rows }: Props) {
  return (
    <ul className="modal-list">
      {rows.map((row) => (
        <li key={row.rank}>
          <span>{medalEmoji(row.rank)} {row.profiles?.display_name ?? "unknown"}</span>
          {row.profiles && (
            <span className="leaderboard-row-medals" title="Lifetime 1st / 2nd / 3rd place finishes">
              🥇{row.profiles.first_count} 🥈{row.profiles.second_count} 🥉{row.profiles.third_count}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
