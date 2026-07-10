"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    "lp": {"player": 8000, "opponent": 7000},

    # opponent's board -- position is "attack" or "defense".
    # "summoned" is optional and controls the card's summon history, since
    # cards placed directly onto the board bypass the real summon procedure
    # and the engine otherwise has no record of how they got there. Some
    # effects check that history as part of their condition (e.g. "target a
    # Special Summoned monster"), and won't find pre-placed cards without it.
    # Values: "special", "normal", or omit the key entirely to leave the
    # card's summon history untracked (matches raw engine default).
    "opponent_field": [
        {"name": "Ame no Murakumo no Mitsurugi", "position": "attack", "summoned": "special",
         "eff_behaviour": {"trigger": "first"}},
        {"name": "Futsu no Mitama no Mitsurugi", "position": "defense", "summoned": "special",
         "eff_behaviour": {"trigger": "always", "target": "random"}},
        {"name": "Mitsurugi no Mikoto, Saji", "position": "defense", "summoned": "special"},
        {"name": "Mitsurugi no Mikoto, Aramasa", "position": "defense", "summoned": "special"},
        {"name": "Mitsurugi no Mikoto, Kusanagi", "position": "defense", "summoned": "special"},
    ],

    "player_hand": [
        "Maliss <P> Dormouse",
        "Bystial Druiswurm",
    ],

    "player_deck": [
        "Maliss <P> Chessy Cat",
        "Maliss <P> White Rabbit",
        "Maliss <P> March Hare",
        "Maliss <C> TB-11",
        "Maliss <C> MTP-07",
        "Maliss <C> GWC-06",
        "Maliss in Underground"
    ],

    "player_extra": [
        "Maliss <Q> Red Ransom",
        "Maliss <Q> White Binder",
        "Maliss <Q> Hearts Crypter",
        "Dharc the Dark Charmer, Gloomy",
        "Haggard Lizardose",
        "Linguriboh",
        "Link Decoder",
        "S:P Little Knight",
        "Sky Striker Ace - Azalea"
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}
