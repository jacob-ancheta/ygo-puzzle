import { useEffect, useRef } from "react";
import type { IdleBattleOption } from "../protocol";
import { ACTION_LABELS } from "../interaction";

interface Props {
  x: number;
  y: number;
  items: { option: IdleBattleOption; idx: number }[];
  onChoose: (idx: number) => void;
  onClose: () => void;
}

export default function ActionMenu({ x, y, items, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div className="action-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map(({ option, idx }) => (
        <button key={idx} className="action-menu-item" onClick={() => onChoose(idx)}>
          {ACTION_LABELS[option.action] ?? option.action}
          {option.can_attack_directly ? " (direct ok)" : ""}
        </button>
      ))}
    </div>
  );
}
