import type { CardRef } from "../protocol";
import CardTile from "./CardTile";

interface Props {
  card: CardRef;
  label: string;
  onCancel: () => void;
}

/** Shown while a Summon/Set's target zone is a client-side guess (see
 * App.tsx's pendingPlacement / boardState.ts's guessOpenZones) -- nothing
 * has been sent to the server yet at this point, so Cancel here is free. */
export default function PlacementOverlay({ card, label, onCancel }: Props) {
  return (
    <div className="selection-overlay chain-overlay">
      <div className="selection-overlay-group">
        <div className="selection-overlay-label">{label}</div>
        <div className="selection-overlay-row">
          <CardTile card={card} />
        </div>
      </div>
      <button className="btn chain-pass-btn" onClick={onCancel}>Cancel</button>
    </div>
  );
}
