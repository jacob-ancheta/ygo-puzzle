import type { MouseEvent } from "react";
import type { BoardState, ZoneCard } from "../boardState";
import { LOC, POS, zoneKey } from "../boardState";
import type { CardRef } from "../protocol";
import { hiddenZoneGroups, idleBattleOptionsFor, matchCardIndex, matchZoneIndex, type Loc } from "../interaction";
import CardTile from "./CardTile";
import PileStack from "./PileStack";
import SelectionOverlay from "./SelectionOverlay";

interface Props {
  board: BoardState;
  prompt: Record<string, unknown> | null;
  selection: number[];
  onCardMenu: (card: CardRef, options: ReturnType<typeof idleBattleOptionsFor>, x: number, y: number) => void;
  onSelectToggle: (idx: number) => void;
  onUnselectChoice: (idx: number) => void;
  onPlaceChoice: (idx: number) => void;
  onPhaseClick: (x: number, y: number) => void;
  canChangePhase: boolean;
  onCardDetail: (card: CardRef) => void;
}

const MONSTER_SEQS = [0, 1, 2, 3, 4];
const SPELL_SEQS = [0, 1, 2, 3, 4];
const EMZ_SEQS = [5, 6];

export default function Board({ board, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onPlaceChoice, onPhaseClick, canChangePhase, onCardDetail }: Props) {
  function renderZone(controller: number, locationId: number, sequence: number, extraClass = "") {
    const loc: Loc = { controller, location_id: locationId, sequence };
    const card = board.zones[zoneKey(controller, locationId, sequence)];

    if (!card) {
      const zoneIdx = matchZoneIndex(prompt, loc);
      const selectable = zoneIdx !== null;
      const selected = selectable && selection.includes(zoneIdx as number);
      return (
        <div
          key={sequence}
          className={`card-slot empty ${extraClass} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`}
          onClick={selectable ? () => onPlaceChoice(zoneIdx as number) : undefined}
        />
      );
    }

    return (
      <ZoneCardSlot
        key={sequence}
        card={card}
        loc={loc}
        prompt={prompt}
        selection={selection}
        onCardMenu={onCardMenu}
        onSelectToggle={onSelectToggle}
        onUnselectChoice={onUnselectChoice}
        onCardDetail={onCardDetail}
      />
    );
  }

  // Extra Monster Zones are a physically shared strip between the two
  // fields: the engine still books them per-controller (MZONE seq 5/6 on
  // whichever side placed a monster there), so a slot can show up under
  // either controller depending on who's using it.
  function renderEMZ(sequence: number) {
    const cardOwn = board.zones[zoneKey(0, LOC.MZONE, sequence)];
    const cardOpp = board.zones[zoneKey(1, LOC.MZONE, sequence)];
    const controller = cardOwn ? 0 : cardOpp ? 1 : null;
    const card = cardOwn ?? cardOpp;

    if (!card) {
      const idxOwn = matchZoneIndex(prompt, { controller: 0, location_id: LOC.MZONE, sequence });
      const idxOpp = matchZoneIndex(prompt, { controller: 1, location_id: LOC.MZONE, sequence });
      const zoneIdx = idxOwn ?? idxOpp;
      const selectable = zoneIdx !== null;
      const selected = selectable && selection.includes(zoneIdx as number);
      return (
        <div
          key={sequence}
          className={`card-slot empty emz ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`}
          onClick={selectable ? () => onPlaceChoice(zoneIdx as number) : undefined}
        />
      );
    }

    const loc: Loc = { controller: controller as number, location_id: LOC.MZONE, sequence };
    return (
      <ZoneCardSlot
        key={sequence}
        card={card}
        loc={loc}
        prompt={prompt}
        selection={selection}
        onCardMenu={onCardMenu}
        onSelectToggle={onSelectToggle}
        onUnselectChoice={onUnselectChoice}
        onCardDetail={onCardDetail}
      />
    );
  }

  function renderPiles(controller: 0 | 1) {
    const deck = board.deck[controller];
    const extra = board.extra[controller];
    const deckCount = typeof deck === "number" ? deck : deck.length;
    const deckCards = typeof deck === "number" ? undefined : deck;
    const extraCount = typeof extra === "number" ? extra : extra.length;
    const extraCards = typeof extra === "number" ? undefined : extra;
    return (
      <div className="piles-cluster">
        <PileStack label="Deck" shape="well" count={deckCount} cards={deckCards} onCardClick={onCardDetail} />
        <PileStack label="Extra" shape="well" count={extraCount} cards={extraCards} onCardClick={onCardDetail} />
        <PileStack label="GY" shape="well" count={board.gy[controller].length} cards={board.gy[controller]} onCardClick={onCardDetail} />
        <PileStack label="Banish" shape="well" count={board.banished[controller].length} cards={board.banished[controller]} onCardClick={onCardDetail} />
      </div>
    );
  }

  const handCards = board.hand[0];
  const overlayGroups = hiddenZoneGroups(prompt);
  const isUnselectPrompt = prompt?.prompt === "select_unselect";

  return (
    <div className="board">
      <div className="board-main">
        <div className="piles-column">
          {renderPiles(1)}
          <div className="lp-strip">
            <div className="lp-badge">
              <span className="lp-label">Opponent</span>
              <span className="lp-value">{board.lp[1]}</span>
            </div>
            <span className="hand-count">Hand: {board.hand[1].length}</span>
          </div>
          <div className="lp-strip">
            <div className="lp-badge">
              <span className="lp-label">You</span>
              <span className="lp-value">{board.lp[0]}</span>
            </div>
          </div>
          {renderPiles(0)}
        </div>

        <div className="field-center">
          <div className="zone-row spell-row">{SPELL_SEQS.map((s) => renderZone(1, LOC.SZONE, s))}</div>
          <div className="zone-row monster-row">{MONSTER_SEQS.map((s) => renderZone(1, LOC.MZONE, s))}</div>

          <div className="zone-row emz-row">
            <div className="card-slot invisible" />
            {renderEMZ(EMZ_SEQS[0])}
            <div className="card-slot invisible" />
            {renderEMZ(EMZ_SEQS[1])}
            <div className="card-slot invisible" />
          </div>

          <div className="center-divider">
            <span className="turn-indicator">{board.turnPlayer === 0 ? "Your turn" : "Opponent's turn"}</span>
            <button
              className={`phase-button ${canChangePhase ? "active" : ""}`}
              disabled={!canChangePhase}
              onClick={(e) => onPhaseClick(e.clientX, e.clientY)}
            >
              {board.phase}
            </button>
          </div>

          <div className="zone-row monster-row">{MONSTER_SEQS.map((s) => renderZone(0, LOC.MZONE, s))}</div>
          <div className="zone-row spell-row">{SPELL_SEQS.map((s) => renderZone(0, LOC.SZONE, s))}</div>
        </div>
      </div>

      <div className="hand-area">
        <div className="hand-row">
          {handCards.map((card, i) => {
            const loc: Loc = { controller: 0, location_id: LOC.HAND, sequence: i };
            return (
              <ZoneCardSlot
                key={`${card.code}-${i}`}
                card={card}
                loc={loc}
                prompt={prompt}
                selection={selection}
                onCardMenu={onCardMenu}
                onSelectToggle={onSelectToggle}
                onUnselectChoice={onUnselectChoice}
                onCardDetail={onCardDetail}
              />
            );
          })}
        </div>
        <SelectionOverlay
          groups={overlayGroups}
          selection={selection}
          isUnselectPrompt={isUnselectPrompt}
          onToggle={isUnselectPrompt ? onUnselectChoice : onSelectToggle}
        />
      </div>
    </div>
  );
}

function ZoneCardSlot({
  card, loc, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onCardDetail,
}: {
  card: ZoneCard;
  loc: Loc;
  prompt: Record<string, unknown> | null;
  selection: number[];
  onCardMenu: Props["onCardMenu"];
  onSelectToggle: Props["onSelectToggle"];
  onUnselectChoice: Props["onUnselectChoice"];
  onCardDetail: Props["onCardDetail"];
}) {
  const idleBattleOptions = idleBattleOptionsFor(prompt, card.code);
  const actionable = idleBattleOptions.length > 0;

  const selectIdx = matchCardIndex(prompt, card.code, loc);
  const isUnselectPrompt = prompt?.prompt === "select_unselect";
  const alreadySelected = isUnselectPrompt && selectIdx !== null
    ? Boolean((prompt!.items as { already_selected?: boolean }[])[selectIdx as number]?.already_selected)
    : false;
  const selected = isUnselectPrompt ? alreadySelected : (selectIdx !== null && selection.includes(selectIdx));
  const selectable = selectIdx !== null;

  const isFaceDown = Boolean(card.position && (card.position & POS.FACEDOWN_ATTACK || card.position & POS.FACEDOWN_DEFENSE));

  const handleClick = (e: MouseEvent) => {
    if (!isFaceDown) onCardDetail(card);
    if (actionable) {
      onCardMenu(card, idleBattleOptions, e.clientX, e.clientY);
    } else if (selectable) {
      if (isUnselectPrompt) onUnselectChoice(selectIdx as number);
      else onSelectToggle(selectIdx as number);
    }
  };

  return (
    <CardTile
      card={card}
      position={card.position}
      actionable={actionable}
      selectable={selectable && !isUnselectPrompt}
      selected={selected}
      onClick={handleClick}
    />
  );
}
