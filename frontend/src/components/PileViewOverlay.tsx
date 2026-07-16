import type { MouseEvent } from "react";
import type { ZoneCard } from "../boardState";
import type { CardRef } from "../protocol";
import { idleBattleOptionsFor, type Loc } from "../interaction";
import CardTile from "./CardTile";

interface Props {
  label: string;
  cards: ZoneCard[];
  prompt: Record<string, unknown> | null;
  // Present only for piles where a card can genuinely be acted on directly
  // from here (the player's own Extra Deck and GY) -- see Board.tsx's
  // renderPileCell. Builds the real {controller, location_id, sequence} for
  // the card at that index, which is what lets idleBattleOptionsFor match
  // it exactly instead of falling back to matching by card code alone (the
  // bug that let clicking a Deck card surface a same-named HAND card's
  // Summon option). Omitted entirely for every other pile (Deck, Banished,
  // Materials, opponent's hand), which stay pure browse-only.
  locFor?: (index: number) => Loc;
  onCardDetail: (card: CardRef) => void;
  onCardMenu: (card: CardRef, options: ReturnType<typeof idleBattleOptionsFor>, x: number, y: number) => void;
  onClose: () => void;
}

export default function PileViewOverlay({ label, cards, prompt, locFor, onCardDetail, onCardMenu, onClose }: Props) {
  return (
    <div className="pile-view-overlay">
      <button className="pile-view-close" onClick={onClose} aria-label="Close">×</button>
      <div className="pile-view-label">{label}</div>
      <div className="pile-view-row">
        {cards.map((card, i) => {
          const options = locFor ? idleBattleOptionsFor(prompt, card.code, locFor(i)) : [];
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
