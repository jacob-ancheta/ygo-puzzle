import type { CardRef } from "../protocol";
import { LOC } from "../boardState";
import type { HiddenZoneGroup } from "../interaction";
import CardTile from "./CardTile";

const ZONE_LABELS: Record<number, string> = {
  [LOC.DECK]: "Deck",
  [LOC.EXTRA]: "Extra Deck",
  [LOC.GY]: "Graveyard",
  [LOC.BANISHED]: "Banished Cards",
  [LOC.HAND]: "Hand",
  [LOC.OVERLAY]: "Materials",
};

interface Props {
  groups: HiddenZoneGroup[];
  selection: number[];
  isUnselectPrompt: boolean;
  onToggle: (idx: number) => void;
  onCardDetail: (card: CardRef) => void;
  pendingFinalChoice?: number | null;
}

export default function SelectionOverlay({ groups, selection, isUnselectPrompt, onToggle, onCardDetail, pendingFinalChoice }: Props) {
  if (groups.length === 0) return null;

  return (
    <div className="selection-overlay">
      {groups.map((group) => (
        <div className="selection-overlay-group" key={`${group.controller}:${group.locationId}`}>
          <div className="selection-overlay-label">
            {group.controller === 1 ? "Opponent's " : ""}
            {ZONE_LABELS[group.locationId] ?? "Choose a card"}
          </div>
          <div className="selection-overlay-row">
            {group.entries.map(({ idx, item }) => {
              const selected = isUnselectPrompt
                ? Boolean(item.already_selected) || idx === pendingFinalChoice
                : selection.includes(idx);
              return (
                <CardTile
                  key={`${item.code}-${idx}`}
                  card={item as CardRef}
                  selectable
                  selected={selected}
                  onClick={() => { onCardDetail(item as CardRef); onToggle(idx); }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
