import type { CardRef } from "../protocol";
import CardTile from "./CardTile";

interface ChainOption {
  card: CardRef;
  desc: number;
  forced: boolean;
}

interface Props {
  options: ChainOption[];
  canPass: boolean;
  onChoose: (idx: number) => void;
  onPass: () => void;
  onCardDetail: (card: CardRef) => void;
}

export default function ChainOverlay({ options, canPass, onChoose, onPass, onCardDetail }: Props) {
  return (
    <div className="selection-overlay chain-overlay">
      <div className="selection-overlay-group">
        <div className="selection-overlay-label">Activate?</div>
        <div className="selection-overlay-row">
          {options.map((opt, i) => (
            <CardTile
              key={i}
              card={opt.card}
              actionable
              onClick={() => { onCardDetail(opt.card); onChoose(i); }}
            />
          ))}
        </div>
      </div>
      {canPass && (
        <button className="btn chain-pass-btn" onClick={onPass}>Pass</button>
      )}
    </div>
  );
}
