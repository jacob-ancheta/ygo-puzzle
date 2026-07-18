import type { CardRef } from "../protocol";
import { imageUrl } from "../config";

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
}

export default function CardDetailPanel({ card }: Props) {
  if (!card) {
    return (
      <div className="card-detail empty">
        <p>Click a card to see its details.</p>
      </div>
    );
  }

  const art = imageUrl(card.image_full);
  const kind = kindLabel(card.type);
  const tags = card.type_tags?.join("/");

  return (
    <div className="card-detail">
      {art && <img className="card-detail-image" src={art} alt={card.name} draggable={false} />}
      <h2 className="card-detail-name">{card.name}</h2>
      <div className="card-detail-meta">
        {kind}
        {tags ? ` (${tags})` : ""}
        {card.attribute ? ` · ${card.attribute}` : ""}
        {card.race ? ` · ${card.race}` : ""}
        {card.level !== undefined ? ` · Level/Rank ${card.level}` : ""}
        {card.attack !== undefined ? ` · ATK ${card.attack}` : ""}
        {card.defense !== undefined && card.defense >= 0 ? ` / DEF ${card.defense}` : ""}
      </div>
      {card.desc && <p className="card-detail-desc">{card.desc}</p>}
    </div>
  );
}
