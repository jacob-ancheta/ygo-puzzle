import type { CardRef } from "../protocol";
import { imageUrl } from "../config";
import { ACTION_LABELS, idleBattleOptionsFor } from "../interaction";

const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;

function kindLabel(type?: number): string {
  if (type === undefined) return "";
  if (type & TYPE_MONSTER) return "Monster";
  if (type & TYPE_TRAP) return "Trap";
  if (type & TYPE_SPELL) return "Spell";
  return "";
}

interface Props {
  card: CardRef | null;
  prompt: Record<string, unknown> | null;
  onAction: (idx: number) => void;
}

export default function CardDetailPanel({ card, prompt, onAction }: Props) {
  if (!card) {
    return (
      <div className="card-detail empty">
        <p>Click a card to see its details.</p>
      </div>
    );
  }

  const art = imageUrl(card.image_full);
  // Cards viewed from a pile list (GY, Deck, Extra, Banished) have no fixed
  // on-board position for a floating ActionMenu to anchor to, so if this
  // card currently has a legal action (most commonly a GY/field ignition
  // effect), offer it here instead.
  const actions = idleBattleOptionsFor(prompt, card.code);

  return (
    <div className="card-detail">
      {art && <img className="card-detail-image" src={art} alt={card.name} draggable={false} />}
      <h2 className="card-detail-name">{card.name}</h2>
      <div className="card-detail-meta">
        {kindLabel(card.type)}
        {card.level !== undefined ? ` · Level/Rank ${card.level}` : ""}
        {card.attack !== undefined ? ` · ATK ${card.attack}` : ""}
        {card.defense !== undefined && card.defense >= 0 ? ` / DEF ${card.defense}` : ""}
      </div>
      {card.desc && <p className="card-detail-desc">{card.desc}</p>}
      {actions.length > 0 && (
        <div className="card-detail-actions">
          {actions.map(({ option, idx }) => (
            <button key={idx} className="btn primary" onClick={() => onAction(idx)}>
              {ACTION_LABELS[option.action] ?? option.action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
