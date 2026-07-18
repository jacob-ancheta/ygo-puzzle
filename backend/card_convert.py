"""
Type bitmask constants and human-readable decoding, matching ygopro-core's
raw engine encoding (see card_data.h). cards.db stores these bitmasks
directly (sourced from the official cards.cdb), so no conversion is needed
to load a card, this module is just for display purposes.
"""

TYPE_MONSTER=0x1; TYPE_SPELL=0x2; TYPE_TRAP=0x4
TYPE_NORMAL=0x10; TYPE_EFFECT=0x20; TYPE_FUSION=0x40; TYPE_RITUAL=0x80
TYPE_SPIRIT=0x200; TYPE_UNION=0x400; TYPE_DUAL=0x800; TYPE_TUNER=0x1000
TYPE_SYNCHRO=0x2000; TYPE_TOKEN=0x4000
TYPE_QUICKPLAY=0x10000; TYPE_CONTINUOUS=0x20000; TYPE_EQUIP=0x40000
TYPE_FIELD=0x80000; TYPE_COUNTER=0x100000; TYPE_FLIP=0x200000; TYPE_TOON=0x400000
TYPE_XYZ=0x800000; TYPE_PENDULUM=0x1000000; TYPE_LINK=0x4000000

# Matches ygopro-core's common.h ATTRIBUTE_*/RACE_* bitmasks exactly (values
# aren't sequential/guessable -- e.g. Attribute starts at EARTH=0x01, not
# LIGHT, and Race has several gaps -- so these are transcribed straight from
# the engine source rather than assumed).
ATTRIBUTE_NAMES = [
    (0x01, "EARTH"), (0x02, "WATER"), (0x04, "FIRE"), (0x08, "WIND"),
    (0x10, "LIGHT"), (0x20, "DARK"), (0x40, "DIVINE"),
]
RACE_NAMES = [
    (0x1, "Warrior"), (0x2, "Spellcaster"), (0x4, "Fairy"), (0x8, "Fiend"),
    (0x10, "Zombie"), (0x20, "Machine"), (0x40, "Aqua"), (0x80, "Pyro"),
    (0x100, "Rock"), (0x200, "Winged Beast"), (0x400, "Plant"), (0x800, "Insect"),
    (0x1000, "Thunder"), (0x2000, "Dragon"), (0x4000, "Beast"), (0x8000, "Beast-Warrior"),
    (0x10000, "Dinosaur"), (0x20000, "Fish"), (0x40000, "Sea Serpent"), (0x80000, "Reptile"),
    (0x100000, "Psychic"), (0x200000, "Divine-Beast"), (0x400000, "Creator God"),
    (0x800000, "Wyrm"), (0x1000000, "Cyberse"), (0x2000000, "Illusion"),
]

def decode_attribute(attribute_int):
    names = [name for bit, name in ATTRIBUTE_NAMES if attribute_int & bit]
    return "/".join(names)

def decode_race(race_int):
    names = [name for bit, name in RACE_NAMES if race_int & bit]
    return "/".join(names)

# Every applicable tag for a card's type bitmask, most card-defining first --
# unlike decode_type() below (a terse one-line label for the CLI tool), this
# is for a detail view that wants the *complete* picture: Tuner/Pendulum/
# Spirit/etc, not just the handful decode_type picks out.
def full_type_tags(type_int):
    if type_int & TYPE_MONSTER:
        tags = []
        for bit, label in [
            (TYPE_NORMAL, "Normal"), (TYPE_EFFECT, "Effect"), (TYPE_FUSION, "Fusion"),
            (TYPE_RITUAL, "Ritual"), (TYPE_SYNCHRO, "Synchro"), (TYPE_XYZ, "Xyz"),
            (TYPE_LINK, "Link"), (TYPE_PENDULUM, "Pendulum"), (TYPE_TUNER, "Tuner"),
            (TYPE_SPIRIT, "Spirit"), (TYPE_UNION, "Union"), (TYPE_DUAL, "Gemini"),
            (TYPE_TOON, "Toon"), (TYPE_FLIP, "Flip"), (TYPE_TOKEN, "Token"),
        ]:
            if type_int & bit:
                tags.append(label)
        return tags
    if type_int & TYPE_SPELL:
        for bit, label in [(TYPE_QUICKPLAY, "Quick-Play"), (TYPE_CONTINUOUS, "Continuous"),
                            (TYPE_EQUIP, "Equip"), (TYPE_FIELD, "Field"), (TYPE_RITUAL, "Ritual")]:
            if type_int & bit:
                return [label]
        return ["Normal"]
    if type_int & TYPE_TRAP:
        for bit, label in [(TYPE_CONTINUOUS, "Continuous"), (TYPE_COUNTER, "Counter")]:
            if type_int & bit:
                return [label]
        return ["Normal"]
    return []

def decode_type(type_int):
    """Turn the engine's type bitmask into a short human-readable label."""
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
