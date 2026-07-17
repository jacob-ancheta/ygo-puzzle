"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.
"""

PUZZLE = {

    "title": "Hype-man Hype-man - World Championship 2011",
    "lp": {"player": 100, "opponent": 9300},

    "opponent_field": [
        {
            "name": "Arcana Force 0 - The Fool",
            "position": "defense",
        },
        {
            "name": "Arcana Force 0 - The Fool",
            "position": "defense",
        },
        {
            "name": "Arcana Force 0 - The Fool",
            "position": "defense",
        },
    ],

    "opponent_spelltrap": [
        {
            "name": "Royal Decree",
            "position": "faceup",
        },
    ],

    "player_spelltrap": [
        {
            "name": "Miraculous Descent",
            "position": "set",
        },
        {
            "name": "Share the Pain",
            "position": "set",
        },
    ],

    "player_hand": [
        "Hecatrice",
        "The Sanctuary in the Sky",
        "The Agent of Miracles - Jupiter",
        "Herald of Creation",
        "Soul of Purity and Light",
        "Dunames Dark Witch",
    ],

    "player_deck": [
        "Valhalla, Hall of the Fallen",
    ],

    "player_graveyard": [
        "Master Hyperion",
        "Splendid Venus",
    ],

    "player_extra": [],

    "win_condition": "Reduce the opponent's LP to 0",
}