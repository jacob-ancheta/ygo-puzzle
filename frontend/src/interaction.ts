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

/**
 * Whether at least one currently offered idle/battle option originates from
 * this exact (controller, location_id) zone -- for a pile-level "something
 * in here is actionable right now" glow (GY/Extra Deck). Unlike
 * idleBattleOptionsFor, this isn't matching a single card: a pile renders
 * one merged tile that can stand in for several different cards (e.g. 3
 * GY monsters), so there's no one card code to check against -- only "is
 * this zone, as a whole, offering anything right now".
 */
export function isPileActionable(prompt: Record<string, unknown> | null, controller: number, locationId: number): boolean {
  if (!prompt || (prompt.prompt !== "idlecmd" && prompt.prompt !== "battlecmd")) return false;
  const options = prompt.options as IdleBattleOption[];
  return options.some(({ location }) => location?.controller === controller && location?.location_id === locationId);
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

/**
 * Index of the board card (code + zone) within the prompt's selectable list,
 * if any.
 *
 * `duplicateRank` disambiguates multiple hand copies of the same card (e.g.
 * two "Cloudian - Storm Dragon"): pass how many EARLIER same-code cards
 * precede this one in the displayed hand (0 for the first copy, 1 for the
 * second, ...), and this returns the (duplicateRank+1)-th matching prompt
 * entry instead of always the first. Without this, every rendered copy
 * resolved to the identical prompt index -- selecting one visually
 * highlighted *all* copies at once (since they all shared one selectIdx) and
 * made it impossible to ever select two distinct physical copies for a
 * "discard 2" style prompt. The two copies are still functionally
 * interchangeable (discarding "copy A" vs "copy B" of an identical card has
 * no game-state difference -- see the shuffle note below), so mapping the
 * Nth displayed duplicate to the Nth server-side duplicate is always a safe,
 * unambiguous choice, not a guess.
 */
export function matchCardIndex(prompt: Record<string, unknown> | null, code: number, loc: Loc, duplicateRank = 0): number | null {
  if (!prompt || prompt.prompt === "place") return null;
  const list = selectableList(prompt);
  if (!list) return null;
  let skipped = 0;
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
        if (it.location.controller !== loc.controller) return false;
        if (skipped < duplicateRank) { skipped += 1; return false; }
        return true;
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

// Safety cap on how many "sum" prompt candidates isSumOptionSelectable will
// run its subset-sum search over -- the search is exponential in the worst
// case, and this is a UX nicety (disabling doomed picks up front), not a
// correctness requirement (the server still validates regardless). No real
// puzzle offers anywhere near this many Synchro/Xyz material candidates at
// once; this just keeps a pathological future puzzle from freezing the UI
// instead of degrading to "everything looks selectable."
const SUM_REACHABILITY_CANDIDATE_LIMIT = 20;

/** Does some subset of `levels` (each usable at most once), of size within
 * [countMin, countMax], sum to exactly `target`? Plain recursive
 * include/exclude search -- levels.length is always small in practice (see
 * the cap above), so this stays fast without memoization. */
function subsetCanReachExactly(levels: number[], target: number, countMin: number, countMax: number): boolean {
  if (target === 0 && countMin <= 0) return true;
  if (target < 0 || countMax <= 0 || levels.length === 0) return false;
  const [first, ...rest] = levels;
  if (first <= target && subsetCanReachExactly(rest, target - first, countMin - 1, countMax - 1)) return true;
  return subsetCanReachExactly(rest, target, countMin, countMax);
}

/**
 * Whether the "sum" prompt option at `optionIdx` can still be part of some
 * valid final material combination, given what's already in `selection`.
 *
 * Synchro/Xyz material selection only accepts a combination that sums
 * *exactly* to the prompt's target (see duel_engine.py's MSG_SELECT_SUM
 * handling) -- but nothing previously stopped the player from picking
 * options that make that impossible (e.g. selecting materials that already
 * exceed the target, or that leave a remainder no other combination of
 * what's left can complete), only to have the final Confirm rejected after
 * the fact with no explanation of which pick was the problem. This computes,
 * live as each pick changes, which remaining options could still lead to a
 * legal combination -- so an option that can no longer possibly be part of
 * one is simply not selectable, the same way a puzzle's already-fixed
 * `must_include` materials aren't a "choice" either.
 *
 * Already-selected options are always toggleable (deselecting can only ever
 * make the remaining problem easier, never impossible).
 */
export function isSumOptionSelectable(prompt: Record<string, unknown> | null, selection: number[], optionIdx: number): boolean {
  if (!prompt || prompt.prompt !== "sum") return true;
  if (selection.includes(optionIdx)) return true;

  const options = (prompt.options as { level?: number }[]) ?? [];
  if (options.length > SUM_REACHABILITY_CANDIDATE_LIMIT) return true;
  const mustInclude = (prompt.must_include as { level?: number }[]) ?? [];
  const target = prompt.target as number;
  const min = prompt.min as number;
  const max = prompt.max as number;

  const mustSum = mustInclude.reduce((s, c) => s + (c.level ?? 0), 0);
  const selectedSum = selection.reduce((s, i) => s + (options[i]?.level ?? 0), 0);
  const thisLevel = options[optionIdx]?.level ?? 0;

  const remainingAfterThis = target - mustSum - selectedSum - thisLevel;
  if (remainingAfterThis < 0) return false;

  const picksAfterThis = selection.length + 1;
  const maxMoreAfterThis = max - picksAfterThis;
  if (maxMoreAfterThis < 0) return false;
  const minMoreAfterThis = Math.max(0, min - picksAfterThis);

  const otherUnselectedLevels = options
    .map((o, i) => ({ i, level: o.level ?? 0 }))
    .filter(({ i }) => i !== optionIdx && !selection.includes(i))
    .map(({ level }) => level);

  return subsetCanReachExactly(otherUnselectedLevels, remainingAfterThis, minMoreAfterThis, maxMoreAfterThis);
}
