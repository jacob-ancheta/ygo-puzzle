import { useEffect, useRef, useState } from "react";
import type { ZoneCard } from "../boardState";

interface Props {
  label: string;
  count: number;
  cards?: ZoneCard[];
  shape?: "well" | "tile";
  onCardClick?: (card: ZoneCard) => void;
}

export default function PileStack({ label, count, cards, shape = "tile", onCardClick }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasCards = Boolean(cards && cards.length > 0);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className={`pile pile-${shape}`} ref={ref}>
      <div
        className={`pile-stack ${hasCards ? "clickable" : ""}`}
        onClick={hasCards ? () => setOpen((v) => !v) : undefined}
      >
        <div className="pile-count">{count}</div>
      </div>
      <div className="pile-label">{label}</div>
      {open && hasCards && (
        <div className="pile-cards">
          {cards!.map((c, i) => (
            <div
              key={i}
              className="pile-card"
              onClick={() => { onCardClick?.(c); setOpen(false); }}
              title={c.name}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
