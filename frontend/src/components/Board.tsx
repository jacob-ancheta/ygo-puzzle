import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { BoardState, ZoneCard } from "../boardState";
import { LOC, zoneKey } from "../boardState";
import type { CardRef } from "../protocol";
import { hiddenZoneGroups, idleBattleOptionsFor, isSumOptionSelectable, matchCardIndex, matchZoneIndex, type Loc } from "../interaction";
import CardTile from "./CardTile";
import ChainOverlay from "./ChainOverlay";
import PileCell from "./PileCell";
import PileViewOverlay from "./PileViewOverlay";
import PlacementOverlay from "./PlacementOverlay";
import SelectionOverlay from "./SelectionOverlay";

export interface PileView {
  label: string;
  cards: ZoneCard[];
  // Only the player's own Extra Deck needs this: unlike every other pile
  // (Deck, GY, Banished, Materials, opponent's hand -- none of which are
  // ever directly actionable), an Extra Deck monster genuinely can offer a
  // real Special Summon option, and the player picks *which* card by
  // clicking it here. Building the real {controller, location_id, sequence}
  // per card is what lets idleBattleOptionsFor match it exactly -- omitting
  // this (as every other pile does) is what keeps those piles inert instead
  // of falling back to matching by card code alone, which previously let a
  // deck card sharing a name with a hand card surface the HAND copy's
  // Summon option (reproduced live: "summoning" a monster while browsing
  // the Deck pile).
  locFor?: (index: number) => Loc;
}

// A Summon/Set action whose target zone is still a client-side guess (see
// boardState.ts's guessOpenZones) -- nothing has been sent to the server
// for it yet, so App.tsx can offer a free Cancel while this is active.
export interface PendingPlacementView {
  card: CardRef;
  label: string;
  locationId: number;
  openSequences: number[];
}

interface Props {
  board: BoardState;
  // App.tsx substitutes null here (regardless of what the server actually
  // sent) while an opponent-activation notice is still pending its own 2s
  // glow-and-reveal or "Resolving X" acknowledgment -- so every
  // prompt-driven affordance in this component (selectable/actionable
  // cards, ChainOverlay, ...) naturally goes quiet for that whole window
  // instead of layering on top of the notice.
  prompt: Record<string, unknown> | null;
  selection: number[];
  onCardMenu: (
    card: CardRef,
    options: ReturnType<typeof idleBattleOptionsFor>,
    x: number,
    y: number,
    materials?: CardRef[],
  ) => void;
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
  // See PendingPlacementView -- non-null only while the zone-glow for a
  // Summon/Set is still a local guess, i.e. before the player has clicked
  // one (once they do, App.tsx passes null here and the normal "place"
  // prompt/placingCardFallback flow takes over for the real server round trip).
  pendingPlacement: PendingPlacementView | null;
  onGuessedZoneClick: (sequence: number) => void;
  onCancelPlacement: () => void;
}

const MONSTER_SEQS = [0, 1, 2, 3, 4];
const SPELL_SEQS = [0, 1, 2, 3, 4];
const EMZ_SEQS = [5, 6];
// Field Spell Zone -- SZONE sequence 5 (0-4 are the regular Spell/Trap
// zones, 6/7 are the Pendulum zones; see duel_engine.py's LOCATION_SZONE
// pendulum-zone comments for the same numbering).
const FIELD_SEQ = 5;

export default function Board({ board, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onPlaceChoice, onChainChoice, onChainPass, onPhaseClick, canChangePhase, onCardDetail, pileView, setPileView, pendingFinalChoice, placingCardFallback, pendingPlacement, onGuessedZoneClick, onCancelPlacement }: Props) {
  // Close the pile browser whenever a new prompt comes in -- most obviously
  // so it gets out of the way for a selection overlay that needs the same
  // spot, but also so it doesn't linger stale once the prompt resolves.
  useEffect(() => {
    setPileView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  // Brief scale-up pulse (with the chain link number flashed on top) on
  // whichever card the opponent just activated -- see App.css's
  // .card-tile.enlarged / .chain-link-badge. Only the opponent's own
  // activations get this treatment; the player already gets plenty of
  // feedback (menus, confirm modals) for their own actions.
  const [enlargedKey, setEnlargedKey] = useState<string | null>(null);
  const [enlargedChainLink, setEnlargedChainLink] = useState<number | null>(null);
  // An opponent *hand* activation (a hand trap like Maxx "C") has no board
  // slot for enlargedKey to match -- capture the activating card itself so
  // the hand cell in the lp-strip can display it face-up with the same
  // pulse + chain-link badge for the glow window. Snapshotted here rather
  // than read live from board.currentChainCard at render time, since the
  // chain can fully resolve (clearing currentChainCard) before the 2s glow
  // is done.
  const [enlargedHandCard, setEnlargedHandCard] = useState<CardRef | null>(null);
  const glowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const loc = board.currentChainLocation;
    if (!loc || loc.controller !== 1) return;
    // Cancel-and-restart (rather than a per-effect cleanup keyed on this
    // same dependency) so the glow reliably runs for its full 2s even if
    // the chain fully resolves (chain_end) faster than that -- only a
    // genuinely new opponent activation, handled here, should cut an
    // in-flight glow short.
    if (glowTimerRef.current) clearTimeout(glowTimerRef.current);
    const key = zoneKey(loc.controller, loc.location_id, loc.sequence);
    setEnlargedKey(key);
    setEnlargedChainLink(board.currentChainLink ?? null);
    setEnlargedHandCard(loc.location_id === LOC.HAND ? board.currentChainCard ?? null : null);
    glowTimerRef.current = setTimeout(() => {
      setEnlargedKey(null);
      setEnlargedChainLink(null);
      setEnlargedHandCard(null);
      glowTimerRef.current = null;
    }, 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.currentChainLocation]);

  // Only for real unmount, not every board update -- see the note above.
  useEffect(() => {
    return () => { if (glowTimerRef.current) clearTimeout(glowTimerRef.current); };
  }, []);

  function chainLinkBadgeFor(key: string): number | undefined {
    return enlargedKey === key ? (enlargedChainLink ?? undefined) : undefined;
  }

  function renderZone(controller: number, locationId: number, sequence: number, extraClass = "", emptyLabel?: string) {
    const loc: Loc = { controller, location_id: locationId, sequence };
    const card = board.zones[zoneKey(controller, locationId, sequence)];

    if (!card) {
      const zoneIdx = matchZoneIndex(prompt, loc);
      const guessed = pendingPlacement !== null && controller === 0
        && locationId === pendingPlacement.locationId
        && pendingPlacement.openSequences.includes(sequence);
      const selectable = zoneIdx !== null || guessed;
      const selected = zoneIdx !== null && selection.includes(zoneIdx);
      return (
        <div
          key={sequence}
          className={`card-slot empty ${extraClass} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`}
          onClick={
            zoneIdx !== null ? () => onPlaceChoice(zoneIdx)
              : guessed ? () => onGuessedZoneClick(sequence)
                : undefined
          }
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
        enlarged={enlargedKey === zoneKey(controller, locationId, sequence)}
        chainLinkBadge={chainLinkBadgeFor(zoneKey(controller, locationId, sequence))}
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
        enlarged={enlargedKey === zoneKey(controller as number, LOC.MZONE, sequence)}
        chainLinkBadge={chainLinkBadgeFor(zoneKey(controller as number, LOC.MZONE, sequence))}
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
      // Both the player's own Deck and Extra Deck can offer a real Special
      // Summon option -- normally only Extra Deck monsters do, but a card
      // that's been shuffled OUT of the Extra Deck and into the Deck by an
      // effect (e.g. an effect that returns a Synchro/Xyz monster to a
      // player's Deck) can still be a legal Synchro/Xyz material target,
      // and the engine reports that option with location_id = LOC.EXTRA
      // regardless of where the card actually sits (ygopro-core's own
      // convention: every such Special Summon is tagged "from the Extra
      // Deck" for protocol purposes, not the card's literal current zone).
      // Without this, that option is offered by the engine but has no
      // corresponding clickable card anywhere in the UI at all -- the
      // Extra Deck pile view only lists what's actually still in
      // board.extra, so a card the engine has already moved to the Deck
      // (and is offering as a summon target from there) was completely
      // unreachable to click on (reproduced live: Gungnir shuffled into
      // the Deck by The Transmigration Prophecy, later legitimately
      // offered as a Synchro Summon target, with no way to select it).
      // Never the plain, ordinary case for either player's Deck contents
      // that aren't offered as anything -- idleBattleOptionsFor only ever
      // returns options the engine actually offered at this exact
      // location, so this is inert unless the engine says otherwise.
      const locFor = controller === 0
        ? (i: number) => ({ controller: 0, location_id: LOC.EXTRA, sequence: i })
        : undefined;
      return (
        <PileCell
          key={`${kind}-${controller}`}
          label={label}
          count={count}
          hidden
          clickable={Boolean(cards && cards.length > 0)}
          onOpen={cards ? () => setPileView({ label: openLabel, cards, locFor }) : undefined}
        />
      );
    }

    const list = kind === "gy" ? board.gy[controller] : board.banished[controller];
    const openLabel = kind === "gy" ? "Graveyard" : "Banished Cards";
    // The player's own GY can hold a genuinely GY-activatable card (e.g. a
    // monster/trap with "you can activate this effect while it's in your
    // GY") -- same reasoning as the Extra Deck above. Banished stays
    // browse-only: nothing in this app's card pool activates from there,
    // and real targeting of a banished card (an effect that reborns one)
    // goes through SelectionOverlay, not this viewer.
    const locFor = kind === "gy" && controller === 0
      ? (i: number) => ({ controller: 0, location_id: LOC.GY, sequence: i })
      : undefined;
    return (
      <PileCell
        key={`${kind}-${controller}`}
        label={label}
        count={list.length}
        topCard={list[list.length - 1]}
        clickable={list.length > 0}
        onOpen={list.length > 0 ? () => setPileView({ label: openLabel, cards: list, locFor }) : undefined}
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
  if (prompt?.prompt === "place") {
    console.log("[DEBUG place]", { promptPrompt: prompt?.prompt, boardPlacingCard: board.placingCard, placingCardFallback, placingCard, isPlacing, promptOptions: prompt?.options });
  }

  return (
    <div className="board">
      <div className="board-main">
        <div className="piles-column">
          <div className="lp-strip">
            <div className="lp-strip-row">
              <div className="lp-badge">
                <span className="lp-label">Opponent</span>
                <span className="lp-value">{board.lp[1]}</span>
              </div>
              {/* Their hand is public info -- this is a solved-position
                  puzzle, not a ladder game -- but rendering a card back
                  (not fanned-out faces) keeps the always-on board clean;
                  the full hand is one click away in the pile viewer. While
                  the opponent is activating a card *from* that hand (a hand
                  trap), the activating card takes over this cell face-up
                  with the same pulse + chain-link badge a board activation
                  gets. */}
              <div className="opp-hand-cell">
                {enlargedHandCard ? (
                  <CardTile
                    card={enlargedHandCard}
                    enlarged
                    chainLinkBadge={enlargedChainLink ?? undefined}
                  />
                ) : (
                  <PileCell
                    label="HAND"
                    count={board.hand[1].length}
                    hidden
                    clickable={board.hand[1].length > 0}
                    onOpen={() => setPileView({ label: "Opponent's Hand", cards: board.hand[1] })}
                  />
                )}
              </div>
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
              // How many earlier hand cards share this exact code -- lets
              // matchCardIndex tell apart multiple copies of the same card
              // instead of every copy resolving to the same prompt index.
              const duplicateRank = handCards.slice(0, i).filter((c) => c.code === card.code).length;
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
                  duplicateRank={duplicateRank}
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
            locFor={pileView.locFor}
            onCardDetail={onCardDetail}
            onCardMenu={onCardMenu}
            onClose={() => setPileView(null)}
          />
        )}
        <SelectionOverlay
          groups={overlayGroups}
          prompt={prompt}
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
        {pendingPlacement && (
          <PlacementOverlay
            card={pendingPlacement.card}
            label={pendingPlacement.label}
            onCancel={onCancelPlacement}
          />
        )}
      </div>
    </div>
  );
}

function ZoneCardSlot({
  card, loc, prompt, selection, onCardMenu, onSelectToggle, onUnselectChoice, onCardDetail, showStats, pendingFinalChoice, enlarged, chainLinkBadge, duplicateRank,
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
  enlarged?: boolean;
  chainLinkBadge?: number;
  // How many earlier same-code hand cards precede this one -- see
  // matchCardIndex's docstring. Only meaningful for LOC.HAND; irrelevant
  // (and unused) for field zones, which already match by exact sequence.
  duplicateRank?: number;
}) {
  const idleBattleOptions = idleBattleOptionsFor(prompt, card.code, loc);
  const hasMaterials = (card.materials?.length ?? 0) > 0;
  const actionable = idleBattleOptions.length > 0 || hasMaterials;

  const selectIdx = matchCardIndex(prompt, card.code, loc, duplicateRank);
  const isUnselectPrompt = prompt?.prompt === "select_unselect";
  // MSG_SELECT_SUM may carry materials the engine already made compulsory
  // while narrowing the legal combination.  They are not present in
  // `options` (and must not be sent back as selectable indices), but still
  // need to look selected on the board so the player sees the full material
  // set rather than only the remaining card(s).
  const isRequiredSumMaterial = prompt?.prompt === "sum"
    && ((prompt.must_include as { code: number; location: Loc }[] | undefined) ?? []).some((item) =>
      item.code === card.code
      && item.location.controller === loc.controller
      && item.location.location_id === loc.location_id
      && item.location.sequence === loc.sequence);
  const alreadySelected = isUnselectPrompt && selectIdx !== null
    ? Boolean((prompt!.items as { already_selected?: boolean }[])[selectIdx as number]?.already_selected) || selectIdx === pendingFinalChoice
    : false;
  const selected = isRequiredSumMaterial || (isUnselectPrompt
    ? alreadySelected
    : (selectIdx !== null && selection.includes(selectIdx)));
  // For a "sum" prompt specifically, a card that COULD still be picked by
  // matchCardIndex isn't necessarily one that can actually complete a legal
  // material combination -- see isSumOptionSelectable's docstring.
  const selectable = selectIdx !== null && !isRequiredSumMaterial
    && (prompt?.prompt !== "sum" || isSumOptionSelectable(prompt, selection, selectIdx));

  // Never hidden from detail view, face-down or not, either player's card --
  // this is a solved-position puzzle, not a ladder game (see the opponent's
  // hand pile view, which already shows full card info the same way): there
  // is no genuinely hidden information for the player to preserve here.
  const handleClick = (e: MouseEvent) => {
    onCardDetail(card);
    if (actionable) {
      onCardMenu(card, idleBattleOptions, e.clientX, e.clientY, card.materials);
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
      enlarged={enlarged}
      chainLinkBadge={chainLinkBadge}
    />
  );
}
