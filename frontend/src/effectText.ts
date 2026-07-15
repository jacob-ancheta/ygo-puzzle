// Curated, friendlier text for specific cards' generic yes/no windows.
// MSG_SELECT_YESNO/EFFECTYN carry no effect *text* of their own -- the
// engine never exposes per-effect descriptions to Python, only a numeric
// `desc` id -- so anything clearer than the generic "{card}: confirm?"
// fallback has to be manually written per (card, desc) pair here.
//
// Keying by card code *alone* is a trap: a card with multiple distinct
// effects (e.g. Ame no Murakumo no Mitsurugi has three -- an on-summon
// destroy-all, a quick-effect discard-or-negate, and a tribute search) would
// have this same curated text applied to *all* of them, since the client
// has no other way to tell which one is actually being asked about. That
// happened here: the discard/negate wording (meant only for the quick
// effect) was showing up for the unrelated "destroy all monsters" trigger
// too, since both are just "yesno about card X" from the client's view.
// Keying by "code:desc" scopes each entry to the one specific effect it was
// written for; every other effect of that card correctly falls through to
// the generic fallback in PromptOverlay.tsx instead of borrowing this text.
export interface YesNoText {
  title: string;
  note?: string;
  yesLabel?: string;
  noLabel?: string;
}

const YESNO_TEXT: Record<string, YesNoText> = {
  // Ame no Murakumo no Mitsurugi's quick effect (discard or negate). Note
  // this is the desc of the actual "want to discard?" yesno sub-question
  // (Duel.SelectYesNo's own aux.Stringid index), which is a *different*
  // numeric id from the desc on that effect's "chaining" event (which
  // identifies the effect itself, not this specific follow-up question) --
  // confirmed by observing both live rather than assuming they'd match.
  "19899073:318385171": {
    title: "Ame no Murakumo no Mitsurugi's effect",
    note: "Discard 1 card to keep the effect it just negated -- otherwise, that effect stays negated.",
    yesLabel: "Discard a card",
    noLabel: "Leave it negated",
  },
};

export function yesNoText(cardCode: number | undefined, desc: number | undefined): YesNoText | null {
  if (cardCode === undefined || desc === undefined) return null;
  return YESNO_TEXT[`${cardCode}:${desc}`] ?? null;
}

// Text for MSG_SELECT_OPTION ("activate 1 of these effects") prompts,
// parsed straight from the resolving card's own `desc` -- unlike
// YESNO_TEXT above, this needs no per-card entry: cards.db already formats
// this exact pattern as bullet-prefixed lines in the official text (e.g.
// Stratos: "You can activate 1 of these effects; [bullet] Destroy... [bullet]
// Add..."), so splitting on that bullet character gets the real option text
// for *any* such card automatically. See mapOptionsToBullets below for the
// one scenario (a partial offer on a card with no separate "activate 1 of
// these effects" description of its own) this can't fully disambiguate.
const BULLET = "●";

export function optionBullets(desc: string | undefined): string[] {
  if (!desc) return [];
  return desc
    .split(BULLET)
    .slice(1) // part 0 is the lead-in sentence before the first bullet
    .map((s) => s.split("\t")[0].trim()) // drop trailing restriction text (e.g. "\tYou can only use this effect... once per turn.")
    .filter((s) => s.length > 0);
}

// Learned per card code: the local offset (see mapOptionsToBullets) of that
// card's first bullet, once actually observed. A card's script only calls
// Duel.SelectOption with the subset of effects currently legal, so a
// *partial* offer's local-offset numbering is ambiguous on its own --
// whether local offset 0 is the first bullet, or reserved for a separate
// "you can activate 1 of these effects" trigger description with the real
// options starting at 1 (as with Stratos: see c40044918.lua) -- both are
// common conventions and cards.db has no field for which one a given card
// uses. A *full* offer (every bullet legal at once) has no such ambiguity
// -- it can only be zipped one way -- so it doubles as ground truth for
// that card's convention, cached here for any partial offer of the same
// card later in the session.
//
// Seeded with cards confirmed live against the real engine, since a puzzle
// can plausibly *only* ever offer a partial subset of a given card's
// options (e.g. Stratos here: the opposing field never has a Spell/Trap to
// destroy in the puzzle this was checked against, so the "destroy" bullet
// is never legal and a full offer is never observed to learn from) --
// without a seed, that card would never get bullet text at all despite
// having it, since the ambiguous case is deliberately left unmapped rather
// than guessed. Every other card still works with zero entries here; add
// one only if the same "partial-only" situation gets reported again.
const learnedBaseOffset = new Map<number, number>([
  [40044918, 1], // Elemental HERO Stratos -- offset 0 is its own trigger description, not a bullet
]);

/**
 * Maps each offered option's raw wire index to a bullet index in `bullets`,
 * or null where the mapping can't be determined confidently (see above) --
 * callers should treat "any nulls" as "don't trust this mapping" rather
 * than showing a wrong bullet as available/unavailable, which would be
 * actively misleading rather than merely less helpful.
 */
export function mapOptionsToBullets(cardCode: number | undefined, descs: number[], bullets: string[]): (number | null)[] {
  if (descs.length === bullets.length) {
    if (cardCode !== undefined) {
      learnedBaseOffset.set(cardCode, Math.min(...descs.map((d) => d - cardCode * 16)));
    }
    return descs.map((_, i) => i);
  }
  if (cardCode === undefined) return descs.map(() => null);
  const base = learnedBaseOffset.get(cardCode);
  if (base === undefined) return descs.map(() => null);
  const offsets = descs.map((d) => d - cardCode * 16);
  return offsets.map((o) => (o - base >= 0 && o - base < bullets.length ? o - base : null));
}
