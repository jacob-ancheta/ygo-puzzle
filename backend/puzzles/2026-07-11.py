"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.

TEST PUZZLE -- minimal setup for manual testing. Delete/revert this file
(and re-point puzzle_registry back to the prior date) once done.
"""

PUZZLE = {
    "lp": {"player": 8000, "opponent": 100},

    "opponent_field": [],

    "player_hand": [
        "Maliss <P> Dormouse",
    ],

    "player_deck": [],

    "player_extra": [],

    "win_condition": "Reduce the opponent's LP to 0",
}
