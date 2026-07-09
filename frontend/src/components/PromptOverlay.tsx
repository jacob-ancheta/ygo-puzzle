import { useState, type ReactNode } from "react";

interface Props {
  prompt: Record<string, unknown>;
  respond: (response: Record<string, unknown>) => void;
}

/** Modal popups for decisions that aren't "click the card on the board":
 * yes/no windows, chain windows, option pickers, position choice, RPS,
 * announcements, and counter allocation. */
export default function PromptOverlay({ prompt, respond }: Props) {
  const kind = prompt.prompt as string;

  if (kind === "yesno" || kind === "effectyn") {
    const card = prompt.card as { name: string } | undefined;
    const title = kind === "effectyn" ? `Activate effect of ${card?.name}?` : "Confirm";
    return (
      <Modal title={title}>
        {prompt.note ? <p className="prompt-note">{prompt.note as string}</p> : null}
        <div className="modal-actions">
          <button className="btn primary" onClick={() => respond({ choice: 1 })}>Yes</button>
          <button className="btn" onClick={() => respond({ choice: 0 })}>No</button>
        </div>
      </Modal>
    );
  }

  if (kind === "chain") {
    const options = prompt.options as { card: { name: string }; desc: number; forced: boolean }[];
    return (
      <Modal title="Activate an effect?">
        <div className="modal-list">
          {options.map((opt, i) => (
            <button key={i} className="btn list-item" onClick={() => respond({ choice: i })}>
              {opt.card.name}{opt.forced ? " (forced)" : ""}
            </button>
          ))}
        </div>
        {prompt.can_pass ? (
          <div className="modal-actions">
            <button className="btn" onClick={() => respond({ pass: true })}>Pass</button>
          </div>
        ) : null}
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
    const card = prompt.card as { name: string };
    const options = prompt.options as string[];
    const labels: Record<string, string> = {
      faceup_attack: "Attack",
      facedown_attack: "Set (Attack)",
      faceup_defense: "Defense",
      facedown_defense: "Set (Defense)",
    };
    return (
      <Modal title={`Position for ${card.name}`}>
        <div className="modal-actions">
          {options.map((opt, i) => (
            <button key={i} className="btn" onClick={() => respond({ choice: i })}>{labels[opt] ?? opt}</button>
          ))}
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
      <input className="text-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} autoFocus />
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
