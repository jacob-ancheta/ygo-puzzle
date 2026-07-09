"""
Type bitmask constants and human-readable decoding, matching ygopro-core's
raw engine encoding (see card_data.h). cards.db stores these bitmasks
directly (sourced from the official cards.cdb), so no conversion is needed
to load a card -- this module is just for display purposes.
"""

TYPE_MONSTER=0x1; TYPE_SPELL=0x2; TYPE_TRAP=0x4
TYPE_NORMAL=0x10; TYPE_EFFECT=0x20; TYPE_FUSION=0x40; TYPE_RITUAL=0x80
TYPE_SPIRIT=0x200; TYPE_UNION=0x400; TYPE_DUAL=0x800; TYPE_TUNER=0x1000
TYPE_SYNCHRO=0x2000; TYPE_TOKEN=0x4000
TYPE_QUICKPLAY=0x10000; TYPE_CONTINUOUS=0x20000; TYPE_EQUIP=0x40000
TYPE_FIELD=0x80000; TYPE_COUNTER=0x100000; TYPE_FLIP=0x200000; TYPE_TOON=0x400000
TYPE_XYZ=0x800000; TYPE_PENDULUM=0x1000000; TYPE_LINK=0x4000000

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
