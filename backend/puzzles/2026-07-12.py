"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    "lp": {"player": 8000, "opponent": 5000},

    "opponent_field": [
        {
            "name": "Elemental HERO Absolute Zero",
            "position": "attack",
        },
        {
            "name": "Elemental HERO Absolute Zero",
            "position": "attack",
        },
    ],

    "player_hand": [
        "Double Summon",
        "Caius the Shadow Monarch",
        "Plaguespreader Zombie",
        "Deep Sea Diva",
        "Elemental HERO Stratos",
    ],

    "player_deck": [
        "Evil HERO Infernal Prodigy",
        "Destiny HERO - Malicious",
        "Destiny HERO - Malicious",
        "Spined Gillman",
    ],

    "player_extra": [
        "Magical Android",
        "Brionac, Dragon of the Ice Barrier",
        "Black Rose Dragon",
        "Thought Ruler Archfiend",
        "Stardust Dragon",
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}
