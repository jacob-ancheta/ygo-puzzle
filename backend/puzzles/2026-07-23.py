"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    "title" : "Hint: Liger activates when attacked",
    "lp": {"player": 100, "opponent": 6400},

    "opponent_field": [
        {
            "name": "Lunalight Liger Dancer",
            "position": "attack",
            "eff_behaviour": {"trigger": "always", "respond_to": "attack"},
        },
        {
            "name": "Lunalight Liger Dancer",
            "position": "attack",
            "eff_behaviour": {"trigger": "always", "respond_to": "attack"},
        },
    ],

    "opponent_extra": [
        "Lunalight Leo Dancer",
        "Lunalight Leo Dancer",
    ],

    "player_hand": [
        "Girsu, the Orcust Mekk-Knight",
        "Orcust Knightmare",
    ],

    "player_deck": [
        "Orcust Harp Horror",
        "World Legacy - \"World Wand\"",
        "Orcust Cymbal Skeleton",
        "Orcustrated Babel"
    ],

    "player_extra": [
        "Dingirsu, the Orcust of the Evening Star",
        "Galatea, the Orcust Automaton",
        "Galatea-I, the Orcust Automaton",
        "Borrelsword Dragon",
        "Enlilgirsu, the Orcust Mekk-Knight",
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}
