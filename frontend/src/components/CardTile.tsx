import { useState, type MouseEvent } from "react";
import type { CardRef } from "../protocol";
import { POS } from "../boardState";
import { imageUrl } from "../config";

const TYPE_MONSTER = 0x1;
const TYPE_SPELL = 0x2;
const TYPE_TRAP = 0x4;

function kindClass(type?: number): string {
  if (type === undefined) return "kind-unknown";
  if (type & TYPE_MONSTER) return "kind-monster";
  if (type & TYPE_TRAP) return "kind-trap";
  if (type & TYPE_SPELL) return "kind-spell";
  return "kind-unknown";
}

interface Props {
  card?: CardRef;
  position?: number;
  selectable?: boolean;
  selected?: boolean;
  actionable?: boolean;
  faceDownHint?: boolean;
  onClick?: (e: MouseEvent) => void;
  small?: boolean;
  /** Show the ATK/DEF line -- only used for cards on the field. Hand/pile/
   * search views show just the artwork. */
  showStats?: boolean;
}

export default function CardTile({ card, position, selectable, selected, actionable, faceDownHint, onClick, small, showStats }: Props) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!card) return <div className="card-slot empty" />;

  const faceDown = faceDownHint || (position !== undefined && (position & POS.FACEDOWN_ATTACK || position & POS.FACEDOWN_DEFENSE));
  // Only monsters have an attack/defense orientation -- a set Spell/Trap
  // still carries the FACEDOWN_DEFENSE bit from the engine, but it should
  // never be rotated like a set monster.
  const isMonster = Boolean(card.type !== undefined && card.type & TYPE_MONSTER);
  const defense = isMonster && position !== undefined && (position & POS.FACEUP_DEFENSE || position & POS.FACEDOWN_DEFENSE);

  const classes = [
    "card-slot",
    "card-tile",
    kindClass(card.type),
    faceDown ? "face-down" : "",
    defense ? "defense" : "",
    selectable ? "selectable" : "",
    selected ? "selected" : "",
    actionable ? "actionable" : "",
    small ? "small" : "",
  ].filter(Boolean).join(" ");

  const kind = kindClass(card.type);
  const badge = kind === "kind-spell" ? "S" : kind === "kind-trap" ? "T" : null;
  const art = imageUrl(card.image_cropped);

  return (
    <div className={classes} onClick={onClick} title={faceDown ? undefined : card.name}>
      {faceDown ? (
        <div className="card-back" />
      ) : (
        <div className="card-face">
          <div className="card-art">
            {badge && <span className="type-badge">{badge}</span>}
            {art && !imageFailed ? (
              <img src={art} alt="" draggable={false} onError={() => setImageFailed(true)} />
            ) : (
              <div className="card-art-fallback">{card.name}</div>
            )}
            {showStats && card.attack !== undefined && (
              <div className="card-stats">
                <span>{card.attack}</span>
                {card.defense !== undefined && card.defense >= 0 ? <span>/ {card.defense}</span> : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
