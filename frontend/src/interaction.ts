import type { CardRef, IdleBattleOption } from "./protocol";
import { LOC } from "./boardState";

export interface Loc {
  controller: number;
  location_id: number;
  sequence: number;
}

const CARD_SELECT_PROMPTS = new Set(["card", "tribute", "select_unselect"]);

export const ACTION_LABELS: Record<string, string> = {
  Summon: "Summon",
  "Special Summon": "Special Summon",
  "Change Position": "Change Position",
  "Set Monster": "Set",
  "Set Spell/Trap": "Set",
  Activate: "Activate",
  attack: "Attack",
  activate: "Activate",
  battle_phase: "Battle Phase",
  end_phase: "End Phase",
  main_phase_2: "Main Phase 2",
};

/** Menu label for one idle/battle option -- "Activate Effect" (rather than
 * the bare "Activate" used for e.g. a hand Spell/Trap) specifically for a
 * field monster's own ignition effect, since that's the wording a field
 * monster's action menu (see ZoneCardSlot) uses. */
export function idleOptionLabel(option: IdleBattleOption): string {
  const isFieldMonsterActivate = (option.action === "Activate" || option.action === "activate")
    && option.location?.location_id === LOC.MZONE;
  const label = isFieldMonsterActivate ? "Activate Effect" : (ACTION_LABELS[option.action] ?? option.action);
  return option.can_attack_directly ? `${label} (direct ok)` : label;
}

function dedupeByCategory(matches: { option: IdleBattleOption; idx: number }[]) {
  const seen = new Set<number>();
  return matches.filter(({ option }) => {
    if (seen.has(option.category)) return false;
    seen.add(option.category);
    return true;
  });
}

/**
 * Idle/battle options offered for one specific card. Matching by `code`
 * alone isn't enough: 2 copies of the same card in hand each get their own
 * Summon/Set entry (same code), so without a location to disambiguate,
 * clicking *either* copy would surface all of both copies' entries at once
 * ("Summon Summon Set Set").
 *
 * `loc`, when given, narrows to the clicked card's own entries. Field zones
 * (Monster/Spell-Trap) have a stable identity, so the location match is
 * authoritative there: no entry for this exact zone means this copy has no
 * actions, full stop -- falling back to same-code matches would let one
 * copy borrow another's actions (e.g. a face-up continuous trap showing,
 * and worse *sending*, its set twin's Activate). Hand cards can't do the
 * exact match: the engine shuffles hand order internally while the client's
 * display stays cosmetic (see matchCardIndex's identical caveat), so a hand
 * card's sequence can't be trusted to mean "this physical copy" -- and
 * since identical hand copies are functionally interchangeable anyway, they
 * dedupe by action instead of pinpointing one copy.
 */
export function idleBattleOptionsFor(prompt: Record<string, unknown> | null, code: number, loc?: Loc) {
  if (!prompt || (prompt.prompt !== "idlecmd" && prompt.prompt !== "battlecmd")) return [];
  const options = prompt.options as IdleBattleOption[];
  const matches = options
    .map((option, idx) => ({ option, idx }))
    .filter(({ option }) => option.card && option.card.code === code);
  if (!loc || loc.location_id === LOC.HAND) return dedupeByCategory(matches);
  return matches.filter(({ option }) => option.location
    && option.location.controller === loc.controller
    && option.location.location_id === loc.location_id
    && option.location.sequence === loc.sequence);
}

export function nonCardOptions(prompt: Record<string, unknown> | null) {
  if (!prompt || (prompt.prompt !== "idlecmd" && prompt.prompt !== "battlecmd")) return [];
  const options = prompt.options as IdleBattleOption[];
  return options.map((option, idx) => ({ option, idx })).filter(({ option }) => !option.card);
}

interface SelectableItem extends Partial<CardRef> {
  location?: Loc;
  already_selected?: boolean;
  controller?: number;
  location_id?: number;
  sequence?: number;
}

export function selectableList(prompt: Record<string, unknown> | null): SelectableItem[] | null {
  if (!prompt) return null;
  if (CARD_SELECT_PROMPTS.has(prompt.prompt as string)) return prompt.items as SelectableItem[];
  if (prompt.prompt === "sum" || prompt.prompt === "place") return prompt.options as SelectableItem[];
  return null;
}

/** Index of the board card (code + zone) within the prompt's selectable list, if any. */
export function matchCardIndex(prompt: Record<string, unknown> | null, code: number, loc: Loc): number | null {
  if (!prompt || prompt.prompt === "place") return null;
  const list = selectableList(prompt);
  if (!list) return null;
  const idx = list.findIndex((it) => {
    if (it.code !== code) return false;
    if (it.location) {
      // The core shuffles a player's hand, while the board receives the
      // shuffle only as a cosmetic event and retains its current display
      // order.  A discard/hand-selection prompt therefore has the correct
      // card code but a sequence that can differ from the displayed slot.
      // Hand cards are not positional targets, so matching their identity is
      // the correct interaction and makes those cards selectable again.
      if (loc.location_id === LOC.HAND && it.location.location_id === LOC.HAND) {
        return it.location.controller === loc.controller;
      }
      return it.location.controller === loc.controller && it.location.location_id === loc.location_id && it.location.sequence === loc.sequence;
    }
    return true;
  });
  return idx === -1 ? null : idx;
}

/** Index of an empty (or occupied) target zone within a `place` prompt's option list. */
export function matchZoneIndex(prompt: Record<string, unknown> | null, loc: Loc): number | null {
  if (!prompt || prompt.prompt !== "place") return null;
  const list = selectableList(prompt);
  if (!list) return null;
  const idx = list.findIndex((it) => it.controller === loc.controller && it.location_id === loc.location_id && it.sequence === loc.sequence);
  return idx === -1 ? null : idx;
}

function itemLoc(it: SelectableItem): Loc | null {
  if (it.location) return it.location;
  if (it.controller !== undefined && it.location_id !== undefined && it.sequence !== undefined) {
    return { controller: it.controller, location_id: it.location_id, sequence: it.sequence };
  }
  return null;
}

// Board.tsx only renders individually-clickable card slots for the Monster/
// Spell-Trap zones (both players) and the player's own hand -- everything
// else (Deck, Extra Deck, GY, Banished, opponent's hand) has no on-board
// element a prompt target can be matched against.
function isOnBoardLoc(loc: Loc): boolean {
  if (loc.location_id === LOC.MZONE || loc.location_id === LOC.SZONE) return true;
  if (loc.location_id === LOC.HAND && loc.controller === 0) return true;
  return false;
}

export interface HiddenZoneEntry {
  idx: number;
  item: SelectableItem;
}

export interface HiddenZoneGroup {
  locationId: number;
  controller: number;
  entries: HiddenZoneEntry[];
}

/**
 * Groups a selection prompt's targets that live in a zone Board.tsx doesn't
 * render as individual cards (Deck, Extra Deck, GY, Banished, opponent's
 * hand), so the UI can surface them in a dedicated overlay instead of
 * leaving them un-clickable.
 */
export function hiddenZoneGroups(prompt: Record<string, unknown> | null): HiddenZoneGroup[] {
  const list = selectableList(prompt);
  if (!list) return [];
  const groups = new Map<string, HiddenZoneGroup>();
  list.forEach((item, idx) => {
    const loc = itemLoc(item);
    if (!loc || isOnBoardLoc(loc)) return;
    const key = `${loc.controller}:${loc.location_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { locationId: loc.location_id, controller: loc.controller, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ idx, item });
  });
  return Array.from(groups.values());
}
