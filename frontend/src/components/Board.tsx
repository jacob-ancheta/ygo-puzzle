import { useEffect, type MouseEvent } from "react";
import type { BoardState, ZoneCard } from "../boardState";
import { LOC, POS, zoneKey } from "../boardState";
import type { CardRef } from "../protocol";
import { hiddenZoneGroups, idleBattleOptionsFor, matchCardIndex, matchZoneIndex, type Loc } from "../interaction";
import CardTile from "./CardTile";
import ChainOverlay from "./ChainOverlay";
import PileCell from "./PileCell";
import PileViewOverlay from "./PileViewOverlay";
import SelectionOverlay from "./SelectionOverlay";

export interface PileView { label: string; cards: ZoneCard[] }

interface Props {
  board: BoardState;
  prompt: Record<string, unknown> | null;
  selection: number[];
  onCardMenu: (card: CardRef, options: ReturnType<typeof idleBattleOptionsFor>, x: number, y: number) => void;
  onSelectToggle: (idx: number) => void;
  onUnselectChoice: (idx: number) => void;
  onPlaceChoice: (idx: number) => void;
  onChainChoice: (idx: number) => void;
  onChainPass: () => void;
  onPhaseClick: (x: number, y: number) => void;
  canChangePhase: boolean;
  onCardDetail: (card: CardRef) => void;
  pileView: PileView | null;
  setPileView: (view: PileView | null) => void;
  // Index (into the current select_unselect prompt's items) of a card held
  // pending confirmation rather than already sent to the server -- see
  // App.tsx's handleUnselectChoice. Forces that one card to glow as
  // "selected" even though the server doesn't know about it yet.
  pendingFinalChoice: number | null;
  // Client-side fallback for board.placingCard -- Extra Deck summons never
  // emit a "summoning"/"spsummoning" event before their "place" prompt, so
  // this is whichever card's Summon/Set/Special Summon choice was just
  // committed (see App.tsx's committedCard).
  placingCardFallback: CardRef | null;
}

const MONSTER_SEQS = [0, 1, 2, 3, 4];
const SPELL_SEQS = [0, 1, 2, 3, 4];
const EMZ_SEQS = [5, 6];
// Field Spell Zone -- SZONE sequence 5 (0-4 are the regular Spell/Trap
// zones, 6/7 are the Pendulum zones; see duel_engine.py's LOCATION_SZONE
// pendulum-zone comments for the same numbering).
const FIELD_SEQ = 5;

export default function Board({ board, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onPlaceChoice, onChainChoice, onChainPass, onPhaseClick, canChangePhase, onCardDetail, pileView, setPileView, pendingFinalChoice, placingCardFallback }: Props) {
  // Close the pile browser whenever a new prompt comes in -- most obviously
  // so it gets out of the way for a selection overlay that needs the same
  // spot, but also so it doesn't linger stale once the prompt resolves.
  useEffect(() => {
    setPileView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  function renderZone(controller: number, locationId: number, sequence: number, extraClass = "", emptyLabel?: string) {
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
        >
          {emptyLabel && <span className="pile-cell-label">{emptyLabel}</span>}
        </div>
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
        pendingFinalChoice={pendingFinalChoice}
        showStats
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
        pendingFinalChoice={pendingFinalChoice}
        showStats
      />
    );
  }

  // Deck/Extra Deck are always face-down (hidden info); GY/Banished show
  // whatever was most recently added to them, face-up, once populated --
  // see PileCell.
  function renderPileCell(kind: "deck" | "extra" | "gy" | "banished", controller: 0 | 1) {
    const label = { deck: "DECK", extra: "ED", gy: "GY", banished: "BANISH" }[kind];

    if (kind === "deck" || kind === "extra") {
      const pile = kind === "deck" ? board.deck[controller] : board.extra[controller];
      const count = typeof pile === "number" ? pile : pile.length;
      const cards = typeof pile === "number" ? undefined : pile;
      const openLabel = kind === "deck" ? "Deck" : "Extra Deck";
      return (
        <PileCell
          key={`${kind}-${controller}`}
          label={label}
          count={count}
          hidden
          clickable={Boolean(cards && cards.length > 0)}
          onOpen={cards ? () => setPileView({ label: openLabel, cards }) : undefined}
        />
      );
    }

    const list = kind === "gy" ? board.gy[controller] : board.banished[controller];
    const openLabel = kind === "gy" ? "Graveyard" : "Banished Cards";
    return (
      <PileCell
        key={`${kind}-${controller}`}
        label={label}
        count={list.length}
        topCard={list[list.length - 1]}
        clickable={list.length > 0}
        onOpen={list.length > 0 ? () => setPileView({ label: openLabel, cards: list }) : undefined}
        onCardDetail={onCardDetail}
      />
    );
  }

  const handCards = board.hand[0];
  const overlayGroups = hiddenZoneGroups(prompt);
  const isUnselectPrompt = prompt?.prompt === "select_unselect";
  const isChainPrompt = prompt?.prompt === "chain";
  const chainOptions = isChainPrompt
    ? (prompt!.options as { card: CardRef; desc: number; forced: boolean }[])
    : [];
  // While choosing where to place a card (from hand, banished, GY, or the
  // Extra Deck), show just that card alone in the hand row instead of the
  // player's actual hand -- it's the only thing relevant to the decision.
  const placingCard = board.placingCard ?? placingCardFallback ?? undefined;
  const isPlacing = prompt?.prompt === "place" && Boolean(placingCard);

  return (
    <div className="board">
      <div className="board-main">
        <div className="piles-column">
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
        </div>

        <div className="field-center">
          <div className="zone-row spell-row">
            {renderPileCell("deck", 1)}
            {SPELL_SEQS.map((s) => renderZone(1, LOC.SZONE, s))}
            {renderPileCell("extra", 1)}
          </div>
          <div className="zone-row monster-row">
            {renderPileCell("gy", 1)}
            {MONSTER_SEQS.map((s) => renderZone(1, LOC.MZONE, s))}
            {renderZone(1, LOC.SZONE, FIELD_SEQ, "", "FIELD")}
          </div>

          <div className="zone-row emz-row">
            {renderPileCell("banished", 1)}
            <div className="card-slot invisible" />
            {renderEMZ(EMZ_SEQS[0])}
            <div className="card-slot invisible" />
            {renderEMZ(EMZ_SEQS[1])}
            <div className="card-slot invisible" />
            {renderPileCell("banished", 0)}
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

          <div className="zone-row monster-row">
            {renderZone(0, LOC.SZONE, FIELD_SEQ, "", "FIELD")}
            {MONSTER_SEQS.map((s) => renderZone(0, LOC.MZONE, s))}
            {renderPileCell("gy", 0)}
          </div>
          <div className="zone-row spell-row">
            {renderPileCell("extra", 0)}
            {SPELL_SEQS.map((s) => renderZone(0, LOC.SZONE, s))}
            {renderPileCell("deck", 0)}
          </div>
        </div>
      </div>

      <div className="hand-area">
        <div className="hand-row">
          {isPlacing ? (
            <CardTile card={placingCard} />
          ) : (
            handCards.map((card, i) => {
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
                  pendingFinalChoice={pendingFinalChoice}
                />
              );
            })
          )}
        </div>
        {pileView && (
          <PileViewOverlay
            label={pileView.label}
            cards={pileView.cards}
            prompt={prompt}
            onCardDetail={onCardDetail}
            onCardMenu={onCardMenu}
            onClose={() => setPileView(null)}
          />
        )}
        <SelectionOverlay
          groups={overlayGroups}
          selection={selection}
          isUnselectPrompt={isUnselectPrompt}
          onToggle={isUnselectPrompt ? onUnselectChoice : onSelectToggle}
          onCardDetail={onCardDetail}
          pendingFinalChoice={pendingFinalChoice}
        />
        {isChainPrompt && (
          <ChainOverlay
            options={chainOptions}
            canPass={Boolean(prompt!.can_pass)}
            onChoose={onChainChoice}
            onPass={onChainPass}
            onCardDetail={onCardDetail}
          />
        )}
      </div>
    </div>
  );
}

function ZoneCardSlot({
  card, loc, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onCardDetail, showStats, pendingFinalChoice,
}: {
  card: ZoneCard;
  loc: Loc;
  prompt: Record<string, unknown> | null;
  selection: number[];
  onCardMenu: Props["onCardMenu"];
  onSelectToggle: Props["onSelectToggle"];
  onUnselectChoice: Props["onUnselectChoice"];
  onCardDetail: Props["onCardDetail"];
  showStats?: boolean;
  pendingFinalChoice?: number | null;
}) {
  const idleBattleOptions = idleBattleOptionsFor(prompt, card.code);
  const actionable = idleBattleOptions.length > 0;

  const selectIdx = matchCardIndex(prompt, card.code, loc);
  const isUnselectPrompt = prompt?.prompt === "select_unselect";
  const alreadySelected = isUnselectPrompt && selectIdx !== null
    ? Boolean((prompt!.items as { already_selected?: boolean }[])[selectIdx as number]?.already_selected) || selectIdx === pendingFinalChoice
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
      selectable={selectable}
      selected={selected}
      onClick={handleClick}
      showStats={showStats}
    />
  );
}
