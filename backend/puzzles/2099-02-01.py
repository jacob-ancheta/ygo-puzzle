"""
Scratch test board -- NOT a real puzzle, just skips straight to the Trishula
material-select step so it doesn't need replaying the whole combo. Load it
locally via ?date=2099-02-01 (needs local_config.py's ALLOW_FUTURE_PUZZLES,
already set). Safe to delete once the sum-select bug is nailed down.
"""

PUZZLE = {
    "lp": {"player": 8000, "opponent": 8000},

    "player_field": [
        {"name": "Cloudian - Turbulence", "position": "attack"},
        {"name": "Cloudian - Storm Dragon", "position": "attack"},
        {"name": "Gungnir, Dragon of the Ice Barrier", "position": "attack"},
        {"name": "Cloudian - Smoke Ball", "position": "attack"},
        {"name": "Fishborg Blaster", "position": "attack"},
    ],

    "player_extra": [
        "Trishula, Dragon of the Ice Barrier",
        "Formula Synchron",
        "Mist Wurm",
    ],

    "win_condition": "scratch board for testing the Trishula synchro summon directly",
}
