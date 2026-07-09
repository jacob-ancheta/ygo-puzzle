"""
Converts a YGOPRODeck API card JSON object into the bitflag format
ygopro-core's card_reader callback expects. Shared by build_card_database.py
and anything else that needs to interpret raw API card data.
"""

TYPE_MONSTER=0x1; TYPE_SPELL=0x2; TYPE_TRAP=0x4
TYPE_NORMAL=0x10; TYPE_EFFECT=0x20; TYPE_FUSION=0x40; TYPE_RITUAL=0x80
TYPE_SPIRIT=0x200; TYPE_UNION=0x400; TYPE_DUAL=0x800; TYPE_TUNER=0x1000
TYPE_SYNCHRO=0x2000; TYPE_TOKEN=0x4000
TYPE_QUICKPLAY=0x10000; TYPE_CONTINUOUS=0x20000; TYPE_EQUIP=0x40000
TYPE_FIELD=0x80000; TYPE_COUNTER=0x100000; TYPE_FLIP=0x200000; TYPE_TOON=0x400000
TYPE_XYZ=0x800000; TYPE_PENDULUM=0x1000000; TYPE_LINK=0x4000000

ATTRIBUTES = {
    "EARTH": 0x01, "WATER": 0x02, "FIRE": 0x04, "WIND": 0x08,
    "LIGHT": 0x10, "DARK": 0x20, "DIVINE": 0x40,
}

RACES = {
    "Warrior": 0x1, "Spellcaster": 0x2, "Fairy": 0x4, "Fiend": 0x8,
    "Zombie": 0x10, "Machine": 0x20, "Aqua": 0x40, "Pyro": 0x80,
    "Rock": 0x100, "Winged Beast": 0x200, "Plant": 0x400, "Insect": 0x800,
    "Thunder": 0x1000, "Dragon": 0x2000, "Beast": 0x4000, "Beast-Warrior": 0x8000,
    "Dinosaur": 0x10000, "Fish": 0x20000, "Sea Serpent": 0x40000, "Reptile": 0x80000,
    "Psychic": 0x100000, "Divine-Beast": 0x200000, "Creator God": 0x400000,
    "Wyrm": 0x800000, "Cyberse": 0x1000000, "Illusion": 0x2000000,
}

LINK_MARKERS = {
    "Bottom-Left": 0x001, "Bottom": 0x002, "Bottom-Right": 0x004,
    "Left": 0x008, "Right": 0x020, "Top-Left": 0x040,
    "Top": 0x080, "Top-Right": 0x100,
}

def parse_monster_type(type_str):
    t = TYPE_MONSTER
    tokens = {
        "Ritual": TYPE_RITUAL, "Fusion": TYPE_FUSION, "Synchro": TYPE_SYNCHRO,
        "XYZ": TYPE_XYZ, "Link": TYPE_LINK, "Tuner": TYPE_TUNER,
        "Pendulum": TYPE_PENDULUM, "Flip": TYPE_FLIP, "Union": TYPE_UNION,
        "Spirit": TYPE_SPIRIT, "Toon": TYPE_TOON, "Gemini": TYPE_DUAL,
    }
    for word, bit in tokens.items():
        if word in type_str:
            t |= bit
    # YGOPRODeck only writes the literal word "Normal" for genuinely vanilla
    # monsters. Fusion/Synchro/XYZ/Link are effect monsters by default even
    # though the API never spells out "Effect" for them.
    if "Normal" in type_str and "Effect" not in type_str:
        t |= TYPE_NORMAL
    else:
        t |= TYPE_EFFECT
    return t

def parse_spelltrap_type(type_str, subtype):
    if "Spell" in type_str:
        t = TYPE_SPELL
        sub_map = {"Quick-Play": TYPE_QUICKPLAY, "Continuous": TYPE_CONTINUOUS,
                   "Equip": TYPE_EQUIP, "Field": TYPE_FIELD, "Ritual": TYPE_RITUAL}
    else:
        t = TYPE_TRAP
        sub_map = {"Continuous": TYPE_CONTINUOUS, "Counter": TYPE_COUNTER}
    return t | sub_map.get(subtype, 0)

def decode_type(type_int):
    """Turn the engine's type bitmask back into a short human-readable label."""
    if type_int & TYPE_MONSTER:
        kinds = []
        for bit, label in [
            (TYPE_XYZ, "XYZ"), (TYPE_LINK, "Link"), (TYPE_SYNCHRO, "Synchro"),
            (TYPE_FUSION, "Fusion"), (TYPE_RITUAL, "Ritual"),
        ]:
            if type_int & bit:
                kinds.append(label)
        if type_int & TYPE_EFFECT and not kinds:
            kinds.append("Effect")
        elif type_int & TYPE_NORMAL:
            kinds.append("Normal")
        return "Monster" + (" (" + "/".join(kinds) + ")" if kinds else "")
    if type_int & TYPE_SPELL:
        for bit, label in [(TYPE_QUICKPLAY, "Quick-Play"), (TYPE_CONTINUOUS, "Continuous"),
                            (TYPE_EQUIP, "Equip"), (TYPE_FIELD, "Field"), (TYPE_RITUAL, "Ritual")]:
            if type_int & bit:
                return f"Spell ({label})"
        return "Spell (Normal)"
    if type_int & TYPE_TRAP:
        for bit, label in [(TYPE_CONTINUOUS, "Continuous"), (TYPE_COUNTER, "Counter")]:
            if type_int & bit:
                return f"Trap ({label})"
        return "Trap (Normal)"
    return "Unknown"

def convert_card(card):
    """Convert one YGOPRODeck card JSON object -> our internal card_data dict."""
    type_str = card.get("type", "")
    is_monster = "Monster" in type_str

    entry = {"name": card["name"], "code": card["id"]}

    if is_monster:
        entry["type"] = parse_monster_type(type_str)
        entry["attribute"] = ATTRIBUTES.get(card.get("attribute", ""), 0)
        entry["race"] = RACES.get(card.get("race", ""), 0)
        entry["attack"] = card.get("atk") or 0
        entry["defense"] = card.get("def") or 0
        if "linkval" in card:
            entry["level"] = card["linkval"]
            entry["defense"] = 0
            markers = 0
            for m in card.get("linkmarkers", []):
                markers |= LINK_MARKERS.get(m, 0)
            entry["link_marker"] = markers
        else:
            entry["level"] = card.get("level", 0) or 0
            entry["link_marker"] = 0
    else:
        entry["type"] = parse_spelltrap_type(type_str, card.get("race", ""))
        entry["attribute"] = 0
        entry["race"] = 0
        entry["level"] = 0
        entry["attack"] = 0
        entry["defense"] = 0
        entry["link_marker"] = 0

    return entry