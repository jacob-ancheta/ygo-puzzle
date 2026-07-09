import { useEffect, useState } from "react";
import "./App.css";
import { useDuelSocket } from "./useDuelSocket";
import Board from "./components/Board";
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

interface MenuState {
  card?: CardRef;
  options: { option: IdleBattleOption; idx: number }[];
  x: number;
  y: number;
}

export default function App() {
  const { board, prompt, connected, error, connect, respond } = useDuelSocket(WS_URL);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [detailCard, setDetailCard] = useState<CardRef | null>(null);
  const [priorityOn, setPriorityOn] = useState(true);

  useEffect(() => {
    setMenu(null);
    setSelection([]);
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
      respond({ choice: options[0].idx });
      return;
    }
    setMenu({ card, options, x, y });
  }

  function handleSelectToggle(idx: number) {
    if (!prompt) return;
    setSelection((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      const max = prompt.max as number;
      if (prev.length >= max) return prev;
      return [...prev, idx];
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
    respond({ choice: idx });
  }

  const nonCard = (isBoardPrompt ? nonCardOptions(prompt) : []).filter(({ option }) => !HIDDEN_ACTIONS.has(option.action));
  const isMultiSelect = promptKind !== undefined && MULTI_SELECT_PROMPTS.has(promptKind);

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
        <span className="priority-toggle-label">Priority</span>
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
        />
        <CardDetailPanel card={detailCard} prompt={prompt} onAction={(idx) => respond({ choice: idx })} />
      </main>

      {isMultiSelect && prompt && (
        <SelectionBar
          label={promptKind === "sum" ? `Cards summing to ${prompt.target}` : `Select ${promptKind}`}
          count={selection.length}
          min={prompt.min as number}
          max={prompt.max as number}
          canConfirm={selection.length >= (prompt.min as number) && selection.length <= (prompt.max as number)}
          onConfirm={() => respond({ indices: selection })}
        />
      )}

      {promptKind === "select_unselect" && prompt && (
        <SelectionBar
          label="Select/unselect cards"
          count={(prompt.items as { already_selected?: boolean }[]).filter((i) => i.already_selected).length}
          min={prompt.min as number}
          max={prompt.max as number}
          canConfirm={false}
          onConfirm={() => {}}
          canFinish={Boolean(prompt.can_finish)}
          onFinish={() => respond({ finish: true })}
        />
      )}

      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={menu.options}
          onChoose={(idx) => { respond({ choice: idx }); setMenu(null); }}
          onClose={() => setMenu(null)}
        />
      )}

      {isModalPrompt && prompt && <PromptOverlay prompt={prompt} respond={respond} />}
    </div>
  );
}
