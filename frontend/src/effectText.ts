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
