"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    "lp": {"player": 1000, "opponent": 5200},

    "opponent_field": [
        {
            "name": "Stardust Dragon",
            "position": "attack",
        },
        {
            "name": "Stardust Dragon",
            "position": "attack",
        },
        {
            "name": "Stardust Dragon",
            "position": "attack",
        },
    ],

    "opponent_spelltrap": [
        {
            "name": "Mirror Force",
            "position": "set",
        },
        {
            "name": "Mirror Force",
            "position": "set",
        },
    ],

    # trigger: "always" (the default) -- Battle Fader's own condition ("When
    # an opponent's monster declares a direct attack") is entirely
    # engine-enforced, so the AI only ever gets asked at a moment that's
    # already legal; saying yes every time it's offered is exactly
    # "activate at the first possible instance" (and since using it banishes
    # it, there's only ever one such moment anyway).
    "opponent_hand": [
        {
            "name": "Battle Fader",
            "eff_behaviour": {
                "trigger": "always",
            },
        },
    ],

    "player_spelltrap": [
        {
            "name": "The Transmigration Prophecy",
            "position": "set",
        },
    ],

    "player_hand": [
        "Salvage",
        "Cloudian - Smoke Ball",
        "Cloudian - Storm Dragon",
        "Cloudian - Storm Dragon",
        "Pot of Avarice",
    ],

    "player_graveyard": [
        "Cloudian - Smoke Ball",
        "Cloudian - Smoke Ball",
        "Fishborg Blaster",
        "Cloudian - Turbulence",
        "Cloudian - Storm Dragon",
        "Gungnir, Dragon of the Ice Barrier"
    ],

    "player_extra": [
        "Formula Synchron",
        "Trishula, Dragon of the Ice Barrier",
        "Mist Wurm",
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}