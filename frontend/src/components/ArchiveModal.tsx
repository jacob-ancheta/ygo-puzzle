import { useEffect, useState } from "react";
import { API_URL } from "../config";

interface PuzzleEntry {
  date: string;
  title: string | null;
}

interface Props {
  currentDate: string | null; // null = today
  onSelect: (date: string | null) => void;
  onClose: () => void;
}

export default function ArchiveModal({ currentDate, onSelect, onClose }: Props) {
  const [puzzles, setPuzzles] = useState<PuzzleEntry[] | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/puzzles`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setPuzzles(data.puzzles ?? []);
        setToday(data.today ?? null);
      })
      .catch(() => { if (!cancelled) setError("Couldn't load past puzzles."); });
    return () => { cancelled = true; };
  }, []);

  // Most recent (today) first -- /puzzles returns ascending by date.
  const ordered = puzzles ? [...puzzles].reverse() : null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Past puzzles</h3>
        {error && <p className="error-banner">{error}</p>}
        {!error && ordered === null && <p>Loading...</p>}
        {!error && ordered !== null && ordered.length === 0 && <p>No puzzles yet.</p>}
        {!error && ordered !== null && ordered.length > 0 && (
          <div className="modal-list">
            {ordered.map(({ date, title }) => {
              const isToday = date === today;
              // currentDate is null while viewing today's live puzzle -- so
              // "today" is the active entry exactly when nothing else is.
              const isActive = isToday ? currentDate === null : currentDate === date;
              return (
                <button
                  key={date}
                  className={`btn list-item archive-entry ${isActive ? "active" : ""}`}
                  onClick={() => onSelect(isToday ? null : date)}
                >
                  <span className="archive-entry-date">{date}</span>
                  <span className="archive-entry-title">{title ?? "Untitled"}</span>
                  {isToday && <span className="archive-entry-today">Today</span>}
                </button>
              );
            })}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
