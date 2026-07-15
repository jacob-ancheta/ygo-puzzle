"""
Define a puzzle here by card NAME (not code) -- the loader resolves names
against cards.db at load time and will tell you immediately if a name
doesn't match exactly, before it ever touches the engine.

The filename (YYYY-MM-DD.py) is the date this puzzle is served on.

TEST PUZZLE -- minimal setup for manual testing. Delete/revert this file
(and re-point puzzle_registry back to the prior date) once done.
"""

PUZZLE = {
    # Optional display title, shown in the app header next to the app name.
    "title": "Skill Drain Sandbox",

    "lp": {"player": 8000, "opponent": 100},

    "opponent_field": [],

    # Spell/Trap zone cards, either side. position: "set" (face-down, and
    # immediately activatable -- pre-placed cards carry no "set this turn"
    # restriction) or "faceup" (a continuous card already active).
    "player_spelltrap": [
        {"name": "Skill Drain", "position": "set"},
        {"name": "Skill Drain", "position": "faceup"},
    ],

    "opponent_spelltrap": [
        {"name": "Skill Drain", "position": "set"},
        {"name": "Skill Drain", "position": "faceup"},
    ],

    "player_hand": [
        "Maliss <P> Dormouse",
        "Elemental HERO Stratos",
    ],

    "player_deck": [
        "Destiny HERO - Malicious",
    ],

    "player_extra": [],

    "win_condition": "Reduce the opponent's LP to 0",
}
