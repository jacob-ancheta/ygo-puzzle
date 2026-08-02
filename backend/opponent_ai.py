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

# Must match duel_engine.py's own module-level ATTACK_DECLARED literal
# exactly -- can't import it directly (duel_engine.py imports *this*
# module, so the reverse would be circular), so the string is duplicated
# here instead, cross-referenced by comment on both ends.
_ATTACK_DECLARED = "attack_declared"


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


def _resolve_trigger_names(names):
    """Like _resolve_names, but for respond_to/avoid specifically -- these
    match against a trigger_code, which can also be duel_engine.py's
    ATTACK_DECLARED sentinel (set at MSG_ATTACK, since an attack declaration
    isn't a card activation and has no code of its own) rather than a real
    card. "attack" is recognized as that sentinel here -- e.g. Lunalight
    Liger Dancer's board-wipe is a plain Quick Effect usable any time by its
    own card text, but "respond_to": "attack" scopes the AI's policy to
    only actually take it when responding to an attack declaration, leaving
    every other ambient opportunity alone.

    Deliberately not merged into _resolve_names: that function also backs
    `target` (what to select once activated), where "attack" wouldn't mean
    anything -- a target always names an actual selectable card.
    """
    if not names or names == "random":
        return None
    if isinstance(names, str):
        names = [names]
    codes = set()
    for name in names:
        if name == "attack":
            codes.add(_ATTACK_DECLARED)
            continue
        card = get_card_by_name(name)
        if card is None:
            raise ValueError(f"eff_behaviour references unknown card name: {name!r}")
        codes.add(card["code"])
    return codes


def _resolve_controller(value):
    """None -> no restriction; "opponent"/"self" -> the concrete player
    index, relative to the AI's own side (player 1). Raises loudly on
    anything else, same reasoning as _resolve_names."""
    if value is None:
        return None
    mapping = {"opponent": 0, "self": 1}
    if value not in mapping:
        raise ValueError(f"eff_behaviour trigger_controller must be 'opponent' or 'self', got {value!r}")
    return mapping[value]


class OpponentAI:
    def __init__(self, puzzle, resolved):
        # resolved: name -> card info dict (code, ...), already computed by
        # duel_engine.resolve_all() for every card named anywhere in the puzzle.
        self.policies = {}
        # opponent_hand/opponent_graveyard entries may be bare names (no
        # policy possible) or the same dict shape as opponent_field -- all
        # four zones' cards can carry an eff_behaviour, and the policy
        # itself is zone-agnostic (the engine only ever offers effects that
        # are legal from wherever the card actually is, e.g. a hand trap
        # from hand, or a GY-triggered effect like Kuribohrn's own "when an
        # opponent's monster declares an attack" from the graveyard).
        hand_entries = [e for e in puzzle.get("opponent_hand", []) if isinstance(e, dict)]
        gy_entries = [e for e in puzzle.get("opponent_graveyard", []) if isinstance(e, dict)]
        for entry in puzzle.get("opponent_field", []) + hand_entries + gy_entries + puzzle.get("opponent_spelltrap", []):
            behaviour = entry.get("eff_behaviour")
            if not behaviour:
                continue
            code = resolved[entry["name"]]["code"]
            self.policies[code] = {
                "trigger": behaviour.get("trigger", "always"),
                "respond_to": _resolve_trigger_names(behaviour.get("respond_to")),
                # Inverse of respond_to -- skip an otherwise-legal activation
                # opportunity when it was triggered by one of these specific
                # cards (e.g. Baronne de Fleur's negate should fire on
                # anything *except* Puppet Plant). respond_to alone can't
                # express "everything except X" without enumerating every
                # other card in the puzzle by name.
                "avoid": _resolve_trigger_names(behaviour.get("avoid")),
                # Restricts which side's activation counts as a trigger --
                # "opponent" (relative to whichever side this policy's own
                # card is on, always player 1/the AI here) means player 0,
                # "self" means player 1. Lets a card worded "if your opponent
                # activates a card or effect" (e.g. Baronne de Fleur's
                # negate) actually mean that, instead of also firing on the
                # AI's own Called by the Grave/Mirror Force/Kuribohrn.
                "trigger_controller": _resolve_controller(behaviour.get("trigger_controller")),
                "target": behaviour.get("target"),
                # Opts an ignition-style ("you may activate this," not tied
                # to any specific trigger) effect into auto-activation --
                # see should_activate's require_trigger for why this
                # defaults to off.
                "proactive": bool(behaviour.get("proactive")),
                # Narrows "respond_to": "attack" from "an attack was
                # declared" (any attack, useful for e.g. a GY effect that
                # doesn't care which monster got attacked) down to "*this*
                # card specifically is the one being attacked" -- e.g. two
                # copies of the same monster on the field share one policy
                # (keyed by code), but only one of them is actually the
                # attack's target at a time. See choose_chain's per-candidate
                # location comparison, which is what actually tells the two
                # apart -- code alone can't.
                "self_target_only": bool(behaviour.get("self_target_only")),
                # Tie-breaker between two *different* cards simultaneously
                # legal in the same chain window -- lower wins. Unset means
                # no preference, which falls back to `chains`' own order
                # (whatever the engine happened to offer first) exactly like
                # before this field existed. "trigger": "first" already
                # covers the same-card-duplicates case (e.g. two Mirror
                # Forces sharing one policy); this is for e.g. "Mirror Force
                # before Dimensional Prison if both are legal" -- two
                # distinct cards/policies with no other way to express an
                # explicit preference between them.
                "priority": behaviour.get("priority"),
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

    def should_activate(self, code, desc, trigger_code=None, trigger_controller=None, require_trigger=False,
                         self_is_target=False):
        policy = self.policies.get(code)
        if not policy:
            return False
        # MSG_SELECT_EFFECTYN's "you may activate this specific effect?"
        # yes/no has no other candidate to disambiguate against, unlike
        # MSG_SELECT_CHAIN -- so a card with several distinct effects
        # sharing one code (e.g. Baronne de Fleur: a proactive "once per
        # turn: destroy 1 card" ignition effect alongside its reactive
        # "(Quick Effect): negate an activation") would otherwise have a
        # blanket eff_behaviour policy apply to *both*, auto-firing the
        # ignition effect too (reproduced live: it destroyed cards on its
        # own initiative the instant a policy was added for the negate).
        # require_trigger (set only by the EFFECTYN call site, never by
        # MSG_SELECT_CHAIN -- a fresh reactive chain window, e.g. Mirror
        # Force responding to an attack declaration, legitimately has no
        # trigger_code yet either) restricts the policy to effects that are
        # actually responding to something, unless a puzzle explicitly
        # opts an ignition-style effect in with "proactive": true.
        if require_trigger and trigger_code is None and not policy.get("proactive"):
            return False
        respond_to = policy["respond_to"]
        if respond_to is not None and trigger_code not in respond_to:
            # Not a matching opportunity at all -- doesn't count against
            # "first" either, so a later matching trigger still gets it.
            return False
        avoid = policy.get("avoid")
        if avoid is not None and trigger_code in avoid:
            # Same reasoning as the respond_to miss above -- this specific
            # trigger doesn't count as an opportunity at all, so it doesn't
            # consume "first" and a later, non-avoided trigger still gets it.
            return False
        wanted_controller = policy.get("trigger_controller")
        if wanted_controller is not None and trigger_controller != wanted_controller:
            # Same "not a matching opportunity at all" reasoning -- e.g.
            # Baronne de Fleur is worded as responding to the *opponent's*
            # activations, so the AI's own Called by the Grave/Mirror
            # Force/Kuribohrn shouldn't count as an opportunity, let alone
            # get negated.
            return False
        if policy.get("self_target_only") and not self_is_target:
            # Same "not a matching opportunity at all" reasoning as the
            # gates above -- e.g. with two Lunalight Liger Dancers on the
            # field sharing this exact policy, only the one actually
            # targeted by the current attack should count; the other one
            # merely being legal to activate (its own target-existence
            # condition happens to be met too) isn't an opportunity for it.
            return False
        if policy["trigger"] == "first" and (code, desc) in self.activated:
            return False
        return True

    def choose_chain(self, chains, trigger_code, trigger_controller=None, attack_target_location=None):
        """chains: list of (forced, code, desc, location). Returns an index
        to pick, or -1 to pass (only meaningful when nothing in the list is
        forced). Among several simultaneously-legal, non-forced candidates,
        prefers whichever has the lowest explicit eff_behaviour "priority"
        (unset falls back to `chains`' own order, i.e. no-op for every
        puzzle that doesn't set one)."""
        def is_target(location):
            # attack_target_location is None both outside of an attack
            # window and for a direct attack (no monster target) -- either
            # way, nothing should count as "the" target then.
            return attack_target_location is not None and location == attack_target_location

        def priority_of(code):
            policy = self.policies.get(code)
            p = policy.get("priority") if policy else None
            return p if p is not None else float("inf")

        any_forced = any(forced for forced, _, _, _ in chains)
        if any_forced:
            for i, (forced, code, desc, location) in enumerate(chains):
                if forced and self.should_activate(code, desc, trigger_code, trigger_controller,
                                                     self_is_target=is_target(location)):
                    return i
            return next(i for i, (forced, _, _, _) in enumerate(chains) if forced)
        candidates = [i for i, (_forced, code, desc, location) in enumerate(chains)
                      if self.should_activate(code, desc, trigger_code, trigger_controller,
                                               self_is_target=is_target(location))]
        if not candidates:
            return -1
        # min() is stable -- ties (including the all-unset default) resolve
        # to whichever candidate came first in `chains`, same as before.
        return min(candidates, key=lambda i: priority_of(chains[i][1]))

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
        if target == "all":
            # "target any number of X" style effects (e.g. Kuribohrn's
            # "target any number of Kuriboh monsters in your GY") -- take
            # every offered candidate rather than a random subset.
            count = min(len(codes), max_sel) if max_sel else len(codes)
            return list(range(count))
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
        # min_sel/max_sel already have ygopro-core's own must-select offset
        # baked in -- see duel_engine.py's MSG_SELECT_SUM handling for the
        # full explanation. Using them as-is (no further -must_n
        # subtraction) matches that fix.
        return self.choose_indices(opt_count, min_sel, max_sel)

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
