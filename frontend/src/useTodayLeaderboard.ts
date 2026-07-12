import { useEffect, useState } from "react";
import { API_URL } from "./config";

export interface LeaderboardRow {
  rank: number;
  solved_at: string;
  profiles: {
    display_name: string;
    first_count: number;
    second_count: number;
    third_count: number;
  } | null;
}

export function useTodayLeaderboard() {
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

  return { rows, puzzleDate, error };
}
