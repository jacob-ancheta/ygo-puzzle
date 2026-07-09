"""
Define today's puzzle here by card NAME (not code) -- the loader resolves
names against cards.db at load time and will tell you immediately if a
name doesn't match exactly, before it ever touches the engine.
"""

PUZZLE = {
    "lp": {"player": 8000, "opponent": 5000},

    # opponent's board -- position is "attack" or "defense"
    "opponent_field": [
        {"name": "Ame no Murakumo no Mitsurugi", "position": "attack"},
        {"name": "Futsu no Mitama no Mitsurugi", "position": "defense"},
        {"name": "Mitsurugi no Mikoto, Saji", "position": "defense"},
        {"name": "Mitsurugi no Mikoto, Aramasa", "position": "defense"},
        {"name": "Mitsurugi no Mikoto, Kusanagi", "position": "defense"},
    ],

    "player_hand": [
        "Maliss <P> Dormouse",
        "Bystial Magnamhut",
    ],

    "player_deck": [
        "Maliss <P> Chessy Cat",
        "Maliss <P> White Rabbit",
        "Maliss <P> March Hare",
        "Maliss <C> TB-11",
        "Maliss <C> MTP-07",
        "Maliss <C> GWC-06",
    ],

    "player_extra": [
        "Maliss <Q> Red Ransom",
        "Maliss <Q> White Binder",
        "Maliss <Q> Hearts Crypter",
        "Dharc the Dark Charmer, Gloomy",
        "Haggard Lizardose",
        "Linguriboh",
        "Knightmare Cerberus",
    ],

    "win_condition": "Reduce the opponent's LP to 0",
}
