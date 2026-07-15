"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {
    # Optional display title, shown in the app header next to the app name.
    "title": "Dark World Discards - World Championship 2006",

    "lp": {"player": 600, "opponent": 7000},

    "opponent_field": [
        {
            "name": "Blue-Eyes White Dragon",
            "position": "attack",
        },
        {
            "name": "Blue-Eyes White Dragon",
            "position": "attack",
        },
        {
            "name": "White Magical Hat",
            "position": "attack",
        },
    ],

    "player_field": [
        {
            "name": "Scarr, Scout of Dark World",
            "position": "attack",
        },
    ],

    "player_hand": [
        "Sillva, Warlord of Dark World",
        "Beiige, Vanguard of Dark World",
        "Goldd, Wu-Lord of Dark World",
        "Broww, Huntsman of Dark World",
        "The Cheerful Coffin",
    ],

    "player_deck": [
        "Zure, Knight of Dark World",
    ],

    "player_extra": [],

    "win_condition": "Reduce the opponent's LP to 0",
}