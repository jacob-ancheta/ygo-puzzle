"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    "title": "Detonator and a dream",
    "lp": {"player": 100, "opponent": 3000},

    # trigger: "always" -- Baronne's own condition ("Once while face-up on
    # the field, when a card or effect is activated") is entirely
    # engine-enforced (plus its own "once per turn"), so this just means
    # "take the negate every legal opportunity" -- except Puppet Plant's
    # activation specifically, which "avoid" excludes from counting as an
    # opportunity at all (so a later, non-Puppet-Plant activation still
    # gets negated). trigger_controller: "opponent" -- Baronne's negate is
    # worded as responding to the opponent's activations, so it must ignore
    # the AI's own Called by the Grave/Mirror Force/Kuribohrn and wait for
    # the player's first non-Puppet-Plant activation.
    "opponent_field": [
        {
            "name": "Baronne de Fleur",
            "position": "attack",
            "eff_behaviour": {
                "trigger": "always",
                "avoid": "Puppet Plant",
                "trigger_controller": "opponent",
            },
        },
        {
            "name": "Marshmallon",
            "position": "defense",
        },
    ],

    "opponent_spelltrap": [
        {
            "name": "Called by the Grave",
            "position": "set",
            "eff_behaviour": {
                "trigger": "first",
                "target": "Puppet Plant",
            },
        },
        {
            "name": "Mirror Force",
            "position": "set",
            "eff_behaviour": {
                "trigger": "first",
            },
        },
    ],

    # trigger: "first" on all 3 Kuribohrn -- they share the same code+effect
    # id, so the (code, desc) activation tracking used for "first" already
    # takes exactly one of them and leaves the other two alone; which
    # physical copy is arbitrary since they're identical. target: "all"
    # takes every "Kuriboh" monster currently in the GY (just the one here)
    # instead of a random subset.
    "opponent_graveyard": [
        {
            "name": "Kuribohrn",
            "eff_behaviour": {"trigger": "first", "target": "all"},
        },
        {
            "name": "Kuribohrn",
            "eff_behaviour": {"trigger": "first", "target": "all"},
        },
        {
            "name": "Kuribohrn",
            "eff_behaviour": {"trigger": "first", "target": "all"},
        },
        "Kuriboh",
    ],

    "player_field": [
        {
            "name": "Ryzeal Detonator",
            "position": "attack",
            "materials": ["Keldo the Sacred Protector"],
        },
    ],

    "player_hand": [
        "Puppet Plant",
        "Forbidden Droplet",
        "Sol and Luna",
        "Book of Moon",
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}
