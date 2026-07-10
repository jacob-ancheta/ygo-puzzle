import { useEffect, useRef, useState } from "react";
import "./App.css";
import { useDuelSocket } from "./useDuelSocket";
import Board, { type PileView } from "./components/Board";
import ActionMenu from "./components/ActionMenu";
import PromptOverlay from "./components/PromptOverlay";
import SelectionBar from "./components/SelectionBar";
import CardDetailPanel from "./components/CardDetailPanel";
import { nonCardOptions } from "./interaction";
import { WS_URL } from "./config";
import type { CardRef, IdleBattleOption } from "./protocol";

const BOARD_PROMPTS = new Set(["idlecmd", "battlecmd", "card", "tribute", "sum", "select_unselect", "place"]);
const MULTI_SELECT_PROMPTS = new Set(["card", "tribute", "sum"]);
// "shuffle_hand" is a real idlecmd option the engine can offer, but this
// puzzle never needs it and it just clutters the phase menu -- drop it here
// rather than in interaction.ts, which stays a generic categorizer.
const HIDDEN_ACTIONS = new Set(["shuffle_hand"]);

// Actions that skip straight to committing (Summon, Set, attack, ...) stay
// as-is; these ones interrupt with a Yes/No confirm first, since choosing
// them is otherwise irreversible and there's no other point of no return
// (e.g. clicking to place a card) to catch a misclick.
function needsConfirm(action: string): boolean {
  return action === "Activate" || action === "activate" || action === "Special Summon";
}

function confirmLabel(action: string, cardName: string): string {
  if (action === "Special Summon") return `Special Summon ${cardName}?`;
  return `Activate effect of ${cardName}?`;
}

interface MenuState {
  card?: CardRef;
  options: { option: IdleBattleOption; idx: number }[];
  x: number;
  y: number;
}

interface ConfirmState {
  label: string;
  idx: number;
  card?: CardRef;
}

export default function App() {
  const { board, prompt, connected, error, connect, respond } = useDuelSocket(WS_URL);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [detailCard, setDetailCard] = useState<CardRef | null>(null);
  const [priorityOn, setPriorityOn] = useState(false);
  const [pileView, setPileView] = useState<PileView | null>(null);
  const [pendingFinalChoice, setPendingFinalChoice] = useState<number | null>(null);
  // Extra Deck (Link/Xyz/Synchro/Fusion) summons never emit a "summoning"/
  // "spsummoning" event before their "place" prompt -- only effect-triggered
  // special summons do -- so board.placingCard is unset for them. This is
  // the client-side fallback: whichever card's Summon/Set/Special Summon
  // choice was just committed, kept alive only for the "place" prompt that
  // immediately follows it.
  const [committedCard, setCommittedCard] = useState<CardRef | null>(null);
  // Tracks the previous prompt's kind so committedCard can be cleared only
  // once placement is actually done -- it needs to survive every intermediate
  // prompt in between (e.g. a select_unselect for materials) on the way to
  // the eventual "place" prompt, not just the very next one.
  const prevPromptKindRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setMenu(null);
    setConfirmAction(null);
    setSelection([]);
    setPendingFinalChoice(null);
    const currentKind = prompt?.prompt as string | undefined;
    if (prevPromptKindRef.current === "place" && currentKind !== "place") {
      setCommittedCard(null);
    }
    prevPromptKindRef.current = currentKind;
  }, [prompt]);

  // Priority toggle OFF: whenever a quick-effect window opens (an optional
  // "chain" prompt -- activate something now, or pass), skip the prompt and
  // pass immediately instead of asking.
  useEffect(() => {
    if (priorityOn) return;
    if (prompt?.prompt === "chain" && prompt.can_pass === true && prompt.player === 0) {
      respond({ pass: true });
    }
  }, [prompt, priorityOn, respond]);

  const promptKind = prompt?.prompt as string | undefined;
  const isBoardPrompt = promptKind !== undefined && BOARD_PROMPTS.has(promptKind);
  const isModalPrompt = prompt !== null && !isBoardPrompt;

  function handleCardMenu(card: CardRef, options: { option: IdleBattleOption; idx: number }[], x: number, y: number) {
    if (options.length === 1) {
      const { option, idx } = options[0];
      if (needsConfirm(option.action)) {
        setConfirmAction({ label: confirmLabel(option.action, card.name), idx, card });
        return;
      }
      setCommittedCard(card);
      respond({ choice: idx });
      return;
    }
    setMenu({ card, options, x, y });
  }

  function handleSelectToggle(idx: number) {
    if (!prompt) return;
    setSelection((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      const max = prompt.max as number;
      if (prev.length < max) return [...prev, idx];
      // Already at the limit -- swap in the new pick instead of requiring
      // the old one to be manually unselected first.
      return [...prev.slice(1), idx];
    });
  }

  function handlePlaceChoice(idx: number) {
    if (!prompt) return;
    const count = prompt.count as number;
    setSelection((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      const next = [...prev, idx];
      if (next.length >= count) {
        respond({ indices: next });
        return [];
      }
      return next;
    });
  }

  function handleUnselectChoice(idx: number) {
    if (!prompt) return;
    if (pendingFinalChoice === idx) {
      // Clicking the held card again backs out of the pending state without
      // ever telling the server about it.
      setPendingFinalChoice(null);
      return;
    }
    const items = (prompt.items as { already_selected?: boolean }[]) ?? [];
    const isAdding = !items[idx]?.already_selected;
    const remainingToAdd = items.filter((i) => !i.already_selected).length;
    if (isAdding && remainingToAdd === 1 && Boolean(prompt.can_finish)) {
      // This is the last available material -- hold off sending it so the
      // player can still cancel instead of instantly consuming everything
      // the moment the last candidate is picked.
      setPendingFinalChoice(idx);
      return;
    }
    respond({ choice: idx });
  }

  const nonCard = (isBoardPrompt ? nonCardOptions(prompt) : []).filter(({ option }) => !HIDDEN_ACTIONS.has(option.action));
  const isMultiSelect = promptKind !== undefined && MULTI_SELECT_PROMPTS.has(promptKind);
  const forWhom = board.currentChainCard ? ` for ${board.currentChainCard.name}` : "";

  function handlePhaseClick(x: number, y: number) {
    if (nonCard.length === 0) return;
    if (nonCard.length === 1) {
      respond({ choice: nonCard[0].idx });
      return;
    }
    setMenu({ options: nonCard, x, y });
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>YGO Puzzle</h1>
        <div className="connection-status">
          <span className={`dot ${connected ? "connected" : "disconnected"}`} />
          {connected ? "Connected" : "Disconnected"}
          <button className="btn small" onClick={connect}>New Attempt</button>
        </div>
      </header>

      <button
        className={`priority-toggle ${priorityOn ? "on" : "off"}`}
        onClick={() => setPriorityOn((v) => !v)}
        title="When OFF, priority is passed automatically whenever a quick effect could be activated"
      >
        <span className="priority-toggle-label">Toggle</span>
        <span className="priority-toggle-state">{priorityOn ? "ON" : "OFF"}</span>
      </button>

      {error ? (
        <div className="error-banner">
          <strong>Could not load puzzle:</strong> {error.message}
          {error.suggestions && Object.entries(error.suggestions).map(([name, options]) => (
            <div key={name}>
              '{name}' not found. Close matches: {options.map((o) => o.name).join(", ")}
            </div>
          ))}
        </div>
      ) : null}

      {board.status !== "playing" && (
        <div className={`status-banner ${board.status}`}>{board.statusMessage}</div>
      )}

      <main className="app-main">
        <Board
          board={board}
          prompt={prompt}
          selection={selection}
          onCardMenu={handleCardMenu}
          onSelectToggle={handleSelectToggle}
          onUnselectChoice={handleUnselectChoice}
          onPlaceChoice={handlePlaceChoice}
          onPhaseClick={handlePhaseClick}
          canChangePhase={nonCard.length > 0}
          onCardDetail={setDetailCard}
          pileView={pileView}
          setPileView={setPileView}
          pendingFinalChoice={pendingFinalChoice}
          placingCardFallback={committedCard}
        />
        <CardDetailPanel card={detailCard} />
      </main>

      {isMultiSelect && prompt && !pileView && (
        <SelectionBar
          label={promptKind === "sum" ? `Cards summing to ${prompt.target}` : `Select ${promptKind}${forWhom}`}
          count={selection.length}
          min={prompt.min as number}
          max={prompt.max as number}
          canConfirm={selection.length >= (prompt.min as number) && selection.length <= (prompt.max as number)}
          onConfirm={() => respond({ indices: selection })}
        />
      )}

      {promptKind === "select_unselect" && prompt && !pileView && (
        <SelectionBar
          label={`Select/unselect cards${forWhom}`}
          count={
            (prompt.items as { already_selected?: boolean }[]).filter((i) => i.already_selected).length +
            (pendingFinalChoice !== null ? 1 : 0)
          }
          min={prompt.min as number}
          max={prompt.max as number}
          canConfirm={pendingFinalChoice !== null}
          onConfirm={() => { respond({ choice: pendingFinalChoice }); setPendingFinalChoice(null); }}
          canFinish={Boolean(prompt.can_finish)}
          finishLabel={pendingFinalChoice !== null ? "Cancel" : "Finish"}
          onFinish={() => { respond({ finish: true }); setPendingFinalChoice(null); }}
        />
      )}

      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={menu.options}
          disableOutsideClose={confirmAction !== null}
          onChoose={(idx) => {
            const chosen = menu.options.find((o) => o.idx === idx);
            if (chosen && needsConfirm(chosen.option.action)) {
              setConfirmAction({
                label: confirmLabel(chosen.option.action, chosen.option.card?.name ?? "this card"),
                idx,
                card: chosen.option.card ?? menu.card,
              });
              return;
            }
            if (chosen?.option.card ?? menu.card) setCommittedCard(chosen?.option.card ?? menu.card ?? null);
            respond({ choice: idx });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmAction && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{confirmAction.label}</h3>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  if (confirmAction.card) setCommittedCard(confirmAction.card);
                  respond({ choice: confirmAction.idx });
                  setConfirmAction(null);
                  setMenu(null);
                }}
              >
                Yes
              </button>
              <button className="btn" onClick={() => setConfirmAction(null)}>No</button>
            </div>
          </div>
        </div>
      )}

      {isModalPrompt && prompt && <PromptOverlay prompt={prompt} respond={respond} contextCard={board.currentChainCard} />}
    </div>
  );
}
