import { useState, type ReactNode } from "react";
import type { CardRef } from "../protocol";
import { POS } from "../boardState";
import CardTile from "./CardTile";
import { yesNoText } from "../effectText";

interface Props {
  prompt: Record<string, unknown>;
  respond: (response: Record<string, unknown>) => void;
  // MSG_SELECT_YESNO carries no card reference of its own -- this is the
  // card whose effect is currently resolving on the chain, used as a
  // best-effort hint so a bare "yesno" prompt isn't just "Confirm?".
  contextCard?: CardRef | null;
}

/** Modal popups for decisions that aren't "click the card on the board":
 * yes/no windows, chain windows, option pickers, position choice, RPS,
 * announcements, and counter allocation. */
export default function PromptOverlay({ prompt, respond, contextCard }: Props) {
  const kind = prompt.prompt as string;

  if (kind === "yesno" || kind === "effectyn") {
    const card = (prompt.card as CardRef | undefined) ?? contextCard ?? undefined;
    // MSG_SELECT_YESNO/EFFECTYN never carry the actual effect text (the
    // engine doesn't expose per-effect descriptions to Python) -- fall back
    // to a curated per-(card, desc) override (see effectText.ts) before
    // settling for the generic "{card}: confirm?" wording. Passing `desc`
    // matters: a card with several distinct effects would otherwise get the
    // same curated text no matter which of its effects is actually being
    // asked about.
    const curated = yesNoText(card?.code, prompt.desc as number | undefined);
    const title = curated?.title
      ?? (kind === "effectyn"
        ? `Activate effect of ${card?.name ?? "this card"}?`
        : card ? `${card.name}: confirm?` : "Confirm");
    return (
      <Modal title={title}>
        {card && (
          <div className="modal-card">
            <CardTile card={card} />
          </div>
        )}
        {curated?.note && <p className="prompt-note">{curated.note}</p>}
        {prompt.note ? <p className="prompt-note">{prompt.note as string}</p> : null}
        <div className="modal-actions">
          <button className="btn primary" onClick={() => respond({ choice: 1 })}>{curated?.yesLabel ?? "Yes"}</button>
          <button className="btn" onClick={() => respond({ choice: 0 })}>{curated?.noLabel ?? "No"}</button>
        </div>
      </Modal>
    );
  }

  if (kind === "option") {
    const options = prompt.options as number[];
    return (
      <Modal title="Select an option">
        <div className="modal-list">
          {options.map((desc, i) => (
            <button key={i} className="btn list-item" onClick={() => respond({ choice: i })}>
              Option {i + 1} <span className="dim">(desc {desc})</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  if (kind === "position") {
    const card = prompt.card as CardRef;
    const options = prompt.options as string[];
    // Collapse the up-to-4 raw options (faceup/facedown x attack/defense)
    // down to the two orientations a player actually picks between here --
    // vertical card = Attack, horizontal (rotated, matching how defense
    // monsters render everywhere else) = Defense. Face-up is preferred over
    // face-down when both happen to be offered for the same orientation.
    const attackIdx = options.includes("faceup_attack")
      ? options.indexOf("faceup_attack")
      : options.indexOf("facedown_attack");
    const defenseIdx = options.includes("faceup_defense")
      ? options.indexOf("faceup_defense")
      : options.indexOf("facedown_defense");
    return (
      <Modal title={`Position for ${card.name}`}>
        <div className="position-choice">
          {attackIdx !== -1 && (
            <CardTile card={card} selectable onClick={() => respond({ choice: attackIdx })} />
          )}
          {defenseIdx !== -1 && (
            <CardTile card={card} position={POS.FACEUP_DEFENSE} selectable onClick={() => respond({ choice: defenseIdx })} />
          )}
        </div>
      </Modal>
    );
  }

  if (kind === "rps") {
    return (
      <Modal title="Rock, Paper, Scissors">
        <div className="modal-actions">
          <button className="btn" onClick={() => respond({ choice: 0 })}>Rock</button>
          <button className="btn" onClick={() => respond({ choice: 1 })}>Paper</button>
          <button className="btn" onClick={() => respond({ choice: 2 })}>Scissors</button>
        </div>
      </Modal>
    );
  }

  if (kind === "announce_number") {
    const options = prompt.options as number[];
    return (
      <Modal title="Announce a number">
        <div className="modal-actions">
          {options.map((v, i) => (
            <button key={i} className="btn" onClick={() => respond({ choice: i })}>{v}</button>
          ))}
        </div>
      </Modal>
    );
  }

  if (kind === "announce_card") {
    return <TextPrompt title="Announce a card by name" placeholder="Exact card name" onSubmit={(name) => respond({ name })} />;
  }

  if (kind === "announce_race" || kind === "announce_attrib") {
    const label = kind === "announce_race" ? "race" : "attribute";
    return (
      <TextPrompt
        title={`Announce ${label} bitmask (available: ${(prompt.available as number).toString(16)})`}
        placeholder="0x..."
        onSubmit={(text) => respond({ value: parseInt(text, text.startsWith("0x") ? 16 : 10) || 0 })}
      />
    );
  }

  if (kind === "counter") {
    const items = prompt.items as { name: string; current: number }[];
    const total = prompt.total as number;
    return <CounterAllocator items={items} total={total} onSubmit={(alloc) => respond({ allocation: alloc })} />;
  }

  return (
    <Modal title={`Unhandled prompt: ${kind}`}>
      <p>This prompt type isn't wired up in the UI yet.</p>
    </Modal>
  );
}

function Modal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function TextPrompt({ title, placeholder, onSubmit }: { title: string; placeholder: string; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Modal title={title}>
      <input className="text-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} maxLength={100} autoFocus />
      <div className="modal-actions">
        <button className="btn primary" onClick={() => onSubmit(value)}>Submit</button>
      </div>
    </Modal>
  );
}

function CounterAllocator({ items, total, onSubmit }: { items: { name: string; current: number }[]; total: number; onSubmit: (alloc: number[]) => void }) {
  const [alloc, setAlloc] = useState<number[]>(() => items.map(() => 0));
  const remaining = total - alloc.reduce((a, b) => a + b, 0);

  const bump = (i: number, delta: number) => {
    setAlloc((prev) => {
      const next = prev.slice();
      const v = next[i] + delta;
      if (v < 0 || v > items[i].current) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      next[i] = v;
      return next;
    });
  };

  return (
    <Modal title={`Distribute ${total} counter(s)`}>
      <div className="modal-list">
        {items.map((it, i) => (
          <div key={i} className="counter-row">
            <span>{it.name} (max {it.current})</span>
            <button className="btn small" onClick={() => bump(i, -1)}>-</button>
            <span className="counter-value">{alloc[i]}</span>
            <button className="btn small" onClick={() => bump(i, 1)}>+</button>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn primary" disabled={remaining !== 0} onClick={() => onSubmit(alloc)}>
          Confirm {remaining !== 0 ? `(${remaining} left)` : ""}
        </button>
      </div>
    </Modal>
  );
}
