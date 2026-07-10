import type { MouseEvent } from "react";
import type { ZoneCard } from "../boardState";
import type { CardRef } from "../protocol";
import { idleBattleOptionsFor } from "../interaction";
import CardTile from "./CardTile";

interface Props {
  label: string;
  cards: ZoneCard[];
  prompt: Record<string, unknown> | null;
  onCardDetail: (card: CardRef) => void;
  onCardMenu: (card: CardRef, options: ReturnType<typeof idleBattleOptionsFor>, x: number, y: number) => void;
  onClose: () => void;
}

export default function PileViewOverlay({ label, cards, prompt, onCardDetail, onCardMenu, onClose }: Props) {
  return (
    <div className="pile-view-overlay">
      <button className="pile-view-close" onClick={onClose} aria-label="Close">×</button>
      <div className="pile-view-label">{label}</div>
      <div className="pile-view-row">
        {cards.map((card, i) => {
          const options = idleBattleOptionsFor(prompt, card.code);
          const actionable = options.length > 0;
          const handleClick = (e: MouseEvent) => {
            onCardDetail(card);
            if (actionable) onCardMenu(card, options, e.clientX, e.clientY);
          };
          return (
            <CardTile key={`${card.code}-${i}`} card={card} actionable={actionable} onClick={handleClick} />
          );
        })}
      </div>
    </div>
  );
}
