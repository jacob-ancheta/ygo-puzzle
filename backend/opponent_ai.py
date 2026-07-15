"""
Per-puzzle opponent decision policy.

The engine (ygopro-core) always computes the actual legal-option set itself
-- codes, candidate cards, min/max counts, forced-vs-optional, once-per-turn/
chain limits, all of it lives in the external Lua scripts. Every method here
only ever picks among options the engine has already handed us; it never
invents legality. `OpponentAI` just decides, for the opponent's own
puzzle-configured cards, *whether* to take an offered option and, once one is
taken, how to answer whatever follow-up choices (targets, positions, ...)
come while it resolves -- see the `eff_behaviour` field documented in
puzzles/2026-07-09.py.
"""
import random

from card_lookup import get_card_by_name


def _resolve_names(names):
    """A single name, a list of names, or None/"random" -> a set of codes
    (or None). Raises loudly on an unresolvable name, same as resolve_all()
    does for the rest of the puzzle -- a typo here should fail at puzzle
    load, not silently misbehave mid-duel."""
    if not names or names == "random":
        return None
    if isinstance(names, str):
        names = [names]
    codes = set()
    for name in names:
        card = get_card_by_name(name)
        if card is None:
            raise ValueError(f"eff_behaviour references unknown card name: {name!r}")
        codes.add(card["code"])
    return codes


class OpponentAI:
    def __init__(self, puzzle, resolved):
        # resolved: name -> card info dict (code, ...), already computed by
        # duel_engine.resolve_all() for every card named anywhere in the puzzle.
        self.policies = {}
        # opponent_hand entries may be bare names (no policy possible) or
        # the same dict shape as opponent_field -- both zones' cards can
        # carry an eff_behaviour, and the policy itself is zone-agnostic
        # (the engine only ever offers effects that are legal from wherever
        # the card actually is, e.g. a hand trap from hand).
        hand_entries = [e for e in puzzle.get("opponent_hand", []) if isinstance(e, dict)]
        for entry in puzzle["opponent_field"] + hand_entries:
            behaviour = entry.get("eff_behaviour")
            if not behaviour:
                continue
            code = resolved[entry["name"]]["code"]
            self.policies[code] = {
                "trigger": behaviour.get("trigger", "always"),
                "respond_to": _resolve_names(behaviour.get("respond_to")),
                "target": behaviour.get("target"),
            }

        # Keyed by (code, desc) rather than just code -- a card like
        # Murakumo has several genuinely distinct effects (its on-summon
        # destroy-all, its quick-effect negate, its tribute search), each
        # with its own "once per turn" independent of the others ("You can
        # only use *each* effect... once per turn"). `desc` is the
        # engine-assigned id that distinguishes which specific effect is
        # being offered, so tracking per (code, desc) instead of per code
        # keeps "trigger: first" from incorrectly blocking a card's *other*
        # effects just because one of them already fired once.
        self.activated = set()
        # Code of the effect currently being resolved (set once the AI
        # accepts a MSG_SELECT_CHAIN/MSG_SELECT_EFFECTYN choice, cleared at
        # MSG_CHAIN_END) -- lets later target/position prompts and bare
        # yes/no prompts (which carry no code of their own) know which
        # policy is in play.
        self.active_effect_code = None

    # ---- whether-to-activate decisions ----

    def should_activate(self, code, desc, trigger_code=None):
        policy = self.policies.get(code)
        if not policy:
            return False
        respond_to = policy["respond_to"]
        if respond_to is not None and trigger_code not in respond_to:
            # Not a matching opportunity at all -- doesn't count against
            # "first" either, so a later matching trigger still gets it.
            return False
        if policy["trigger"] == "first" and (code, desc) in self.activated:
            return False
        return True

    def choose_chain(self, chains, trigger_code):
        """chains: list of (forced, code, desc). Returns an index to pick,
        or -1 to pass (only meaningful when nothing in the list is forced)."""
        any_forced = any(forced for forced, _, _ in chains)
        if any_forced:
            for i, (forced, code, desc) in enumerate(chains):
                if forced and self.should_activate(code, desc, trigger_code):
                    return i
            return next(i for i, (forced, _, _) in enumerate(chains) if forced)
        for i, (_forced, code, desc) in enumerate(chains):
            if self.should_activate(code, desc, trigger_code):
                return i
        return -1

    def note_activated(self, code, desc):
        self.activated.add((code, desc))
        self.active_effect_code = code

    def clear_active(self):
        self.active_effect_code = None

    # ---- decisions made while resolving an activated effect ----

    def choose_target(self, codes, min_sel, max_sel):
        """codes: candidate codes in offered order. Returns chosen indices."""
        policy = self.policies.get(self.active_effect_code)
        target = policy.get("target") if policy else None
        if target and target != "random":
            wanted = _resolve_names(target)
            matches = [i for i, c in enumerate(codes) if c in wanted]
            if matches:
                return matches[:max_sel] if max_sel else matches
            print(f"[opponent_ai] predetermined target {target!r} not found among "
                  f"candidates for card {self.active_effect_code}; using random instead")
        return self.choose_indices(len(codes), min_sel, max_sel)

    def choose_position(self, available):
        for pref in (0x1, 0x4, 0x2, 0x8):  # prefer face-up attack, then face-up defense
            if pref in available:
                return pref
        return available[0]

    # ---- generic, best-effort fallbacks for decision points Murakumo/Futsu
    # don't need but which must never be left to prompt a human once any
    # opponent card can activate ----

    def choose_indices(self, n, min_sel, max_sel):
        count = min_sel if min_sel == max_sel else random.randint(min_sel, max_sel)
        count = min(count, n)
        return sorted(random.sample(range(n), count)) if count else []

    def choose_option(self, n):
        return random.randrange(n) if n else 0

    def choose_unselect(self, total_items, min_sel, can_finish, already_selected):
        """Returns an index to toggle, or None to signal "finish"."""
        if can_finish and already_selected >= min_sel:
            return None
        return random.randrange(total_items) if total_items else None

    def choose_sum(self, must_n, opt_count, min_sel, max_sel):
        lo, hi = max(0, min_sel - must_n), max(0, max_sel - must_n)
        return self.choose_indices(opt_count, lo, hi)

    def choose_counter(self, item_maxes, total):
        alloc = [0] * len(item_maxes)
        remaining = total
        for i, cur_max in enumerate(item_maxes):
            take = min(remaining, cur_max)
            alloc[i] = take
            remaining -= take
        return alloc

    def choose_bitmask(self, available):
        return available
