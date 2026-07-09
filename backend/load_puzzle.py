import os
import sys
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

from card_lookup import get_card, get_card_by_name, search_cards
from puzzle_definition import PUZZLE

MINGW_BIN = r"C:\msys64\mingw64\bin"
if os.path.exists(MINGW_BIN):
    os.add_dll_directory(MINGW_BIN)

DLL_PATH = r"C:\msys64\home\Jacob\ygopro-core\libygo.dll"
SCRIPTS_DIR = r"C:\msys64\home\Jacob\ygopro-scripts"

# ---------- STEP 1: dry-run resolve every name before touching the engine ----------
def collect_all_names(puzzle):
    names = []
    for entry in puzzle["opponent_field"]:
        names.append(entry["name"])
    names += puzzle["player_hand"]
    names += puzzle["player_deck"]
    names += puzzle["player_extra"]
    return names

def resolve_all(puzzle):
    names = collect_all_names(puzzle)
    resolved = {}
    failed = []
    for name in names:
        card = get_card_by_name(name)
        if card is None:
            failed.append(name)
        else:
            resolved[name] = card
    if failed:
        print("=" * 60)
        print(f"{len(failed)} card name(s) did NOT match cards.db exactly:")
        for name in failed:
            print(f"\n  '{name}' -- not found. Close matches:")
            for code, cname, type_int, atk, deff, level in search_cards(name, limit=5):
                print(f"    {code:>10}  {cname}")
        print("=" * 60)
        print("Fix the names in puzzle_definition.py (copy the exact name from")
        print("the matches above) and rerun. Nothing was loaded into the engine.")
        sys.exit(1)
    print(f"All {len(resolved)} card names resolved cleanly. Loading the duel...\n")
    return resolved

resolved = resolve_all(PUZZLE)

# ---------- STEP 2: set up the engine ----------
lib = ctypes.CDLL(DLL_PATH)

class CardDataExact(Structure):
    _fields_ = [
        ("code", c_uint32), ("alias", c_uint32), ("setcode", ctypes.c_uint16 * 16),
        ("type", c_uint32), ("level", c_uint32), ("attribute", c_uint32),
        ("race", c_uint32), ("attack", c_int32), ("defense", c_int32),
        ("lscale", c_uint32), ("rscale", c_uint32), ("link_marker", c_uint32),
        ("rule_code", c_uint32),
    ]
assert ctypes.sizeof(CardDataExact) == 80

def unpack_setcode(value):
    """Mirrors ygopro-core's write_setcode (card_data.h): split a packed
    64-bit setcode into up to 16 individual 16-bit set codes."""
    codes = []
    while value:
        low16 = value & 0xffff
        if low16:
            codes.append(low16)
        value >>= 16
    return codes

def card_reader_impl(code, data_ptr):
    info = get_card(code)
    if not info:
        print(f"[card_reader] not found: {code}")
        return 0
    d = data_ptr.contents
    d.code = code
    d.alias = info["alias"]
    d.type = info["type"]
    d.level = info["level"]
    d.attribute = info["attribute"]
    d.race = info["race"]
    d.attack = info["attack"]
    d.defense = info["defense"]
    d.link_marker = info["link_marker"]
    d.lscale = info["lscale"]
    d.rscale = info["rscale"]
    codes = unpack_setcode(info["setcode"])
    for i in range(16):
        d.setcode[i] = codes[i] if i < len(codes) else 0
    return 1

_script_cache = {}

def script_reader_impl(script_name, len_ptr):
    name = script_name.decode("utf-8") if script_name else ""
    filename = os.path.basename(name)
    path = os.path.join(SCRIPTS_DIR, filename)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        data = f.read()
    buf = ctypes.create_string_buffer(data, len(data))
    _script_cache[name] = buf
    len_ptr[0] = len(data)
    return ctypes.cast(buf, ctypes.c_void_p).value

def message_handler_impl(pduel, msg_type):
    return 0

CARD_READER = CFUNCTYPE(c_uint32, c_uint32, POINTER(CardDataExact))
SCRIPT_READER = CFUNCTYPE(c_void_p, c_char_p, POINTER(ctypes.c_int))
MESSAGE_HANDLER = CFUNCTYPE(c_uint32, ctypes.c_ssize_t, c_uint32)

card_reader_cb = CARD_READER(card_reader_impl)
script_reader_cb = SCRIPT_READER(script_reader_impl)
message_handler_cb = MESSAGE_HANDLER(message_handler_impl)

lib.set_card_reader(card_reader_cb)
lib.set_script_reader(script_reader_cb)
lib.set_message_handler(message_handler_cb)

lib.create_duel.restype = ctypes.c_ssize_t
lib.create_duel.argtypes = [ctypes.c_uint32]
pduel = lib.create_duel(12345)
assert pduel != 0
print("Engine ready, pduel handle:", pduel)

lib.set_player_info(ctypes.c_ssize_t(pduel), 0, PUZZLE["lp"]["player"], 0, 1)
lib.set_player_info(ctypes.c_ssize_t(pduel), 1, PUZZLE["lp"]["opponent"], 0, 1)

# ---------- zone / position constants ----------
LOCATION_DECK, LOCATION_HAND, LOCATION_MZONE = 0x01, 0x02, 0x04
LOCATION_EXTRA = 0x40
POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE = 0x1, 0x4

def place(code, owner, location, zone, position):
    lib.new_card(
        ctypes.c_ssize_t(pduel), ctypes.c_uint32(code),
        ctypes.c_uint8(owner), ctypes.c_uint8(owner),
        ctypes.c_uint8(location), ctypes.c_uint8(zone), ctypes.c_uint8(position),
    )

# ---------- STEP 3: build the board ----------
# player 0 = you (the solver), player 1 = opponent
for i, entry in enumerate(PUZZLE["opponent_field"]):
    card = resolved[entry["name"]]
    pos = POS_FACEUP_ATTACK if entry["position"] == "attack" else POS_FACEUP_DEFENSE
    print(f"opponent zone {i}: {card['name']} ({entry['position']})")
    place(card["code"], 1, LOCATION_MZONE, i, pos)

for i, name in enumerate(PUZZLE["player_hand"]):
    card = resolved[name]
    print(f"your hand: {card['name']}")
    place(card["code"], 0, LOCATION_HAND, i, POS_FACEUP_ATTACK)

for i, name in enumerate(PUZZLE["player_deck"]):
    card = resolved[name]
    print(f"your deck: {card['name']}")
    place(card["code"], 0, LOCATION_DECK, i, POS_FACEUP_ATTACK)

for i, name in enumerate(PUZZLE["player_extra"]):
    card = resolved[name]
    print(f"your extra deck: {card['name']}")
    place(card["code"], 0, LOCATION_EXTRA, i, POS_FACEUP_ATTACK)

lib.start_duel(ctypes.c_ssize_t(pduel), ctypes.c_uint32(0))
result = lib.process(ctypes.c_ssize_t(pduel))
print("\nprocess() result:", result)
print(f"\nWin condition: {PUZZLE['win_condition']}")
print("SUCCESS: full puzzle board loaded and the duel is running.")

lib.end_duel(ctypes.c_ssize_t(pduel))