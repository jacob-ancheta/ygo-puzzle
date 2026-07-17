import type { ZoneCard } from "../boardState";
import { imageUrl } from "../config";
import type { CardRef } from "../protocol";

interface Props {
  label: string;
  count: number;
  // Deck/Extra Deck are always face-down (their contents are hidden info
  // even when the client happens to know them, e.g. the player's own deck
  // in a puzzle) -- everything else shows its most recently added card
  // face-up once populated, matching how a real GY/Banished/Field pile
  // reads at a glance.
  hidden?: boolean;
  topCard?: ZoneCard;
  clickable?: boolean;
  onOpen?: () => void;
  onCardDetail?: (card: CardRef) => void;
  /** Brief scale-up pulse -- see CardTile's identical prop. Used here when
   * the pile's activating card isn't otherwise the one shown (topCard is
   * overridden to match for the same window -- see Board.tsx). */
  enlarged?: boolean;
  /** Chain link number to flash on top of the pile while `enlarged`. */
  chainLinkBadge?: number;
}

export default function PileCell({ label, count, hidden, topCard, clickable, onOpen, onCardDetail, enlarged, chainLinkBadge }: Props) {
  if (count === 0) {
    return (
      <div className="card-slot pile-cell empty">
        <span className="pile-cell-label">{label}</span>
      </div>
    );
  }

  const showFace = !hidden && Boolean(topCard);
  const art = showFace ? imageUrl(topCard!.image_cropped) : undefined;

  return (
    <div
      className={`card-slot card-tile pile-cell ${clickable ? "selectable" : ""} ${enlarged ? "enlarged" : ""}`}
      onClick={clickable ? () => { onOpen?.(); if (showFace) onCardDetail?.(topCard!); } : undefined}
      title={showFace ? topCard!.name : label}
    >
      {enlarged && chainLinkBadge !== undefined && (
        <span className="chain-link-badge">{chainLinkBadge}</span>
      )}
      {showFace ? (
        art ? <img src={art} alt="" draggable={false} /> : <div className="card-art-fallback">{topCard!.name}</div>
      ) : (
        <div className="card-back" />
      )}
      <span className="pile-cell-count">{count}</span>
    </div>
  );
}
