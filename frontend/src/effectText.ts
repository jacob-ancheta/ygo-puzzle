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

// Curated text for MSG_SELECT_OPTION ("activate 1 of these effects") prompts.
// Like YESNO_TEXT above, the engine only hands the client opaque numeric
// desc ids for these -- and for this prompt it doesn't even forward which
// card is asking (see duel_engine.py's MSG_SELECT_OPTION handler), so the
// caller has to fall back to the currently-resolving chain card.
//
// Keyed by the script's own aux.Stringid *local offset* (desc = card.code*16
// + offset), not by array position: a card's script only calls
// Duel.SelectOption with the subset of effects that are currently legal
// (see e.g. c40044918.lua's sel==1/2/3 branches), so the offered options'
// positions shift depending on board state. The offset is stable regardless
// -- it's how PromptOverlay both labels the right effect for a partial offer
// and knows which of a card's *other* named effects to show, disabled, when
// this turn didn't offer them.
const OPTION_TEXT: Record<number, Record<number, string>> = {
  // Elemental HERO Stratos -- offset 0 is the shared "activate 1 of these
  // effects" trigger description (not one of the two choices below).
  40044918: {
    1: "Destroy Spells/Traps on the field, up to the number of \"HERO\" monsters you control, except this card",
    2: "Add 1 \"HERO\" monster from your Deck to your hand",
  },
};

export function optionText(cardCode: number | undefined): Record<number, string> | null {
  if (cardCode === undefined) return null;
  return OPTION_TEXT[cardCode] ?? null;
}
