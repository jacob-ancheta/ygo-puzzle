import os
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

from card_lookup import get_card

MINGW_BIN = r"C:\msys64\mingw64\bin"
if os.path.exists(MINGW_BIN):
    os.add_dll_directory(MINGW_BIN)

DLL_PATH = r"C:\msys64\home\Jacob\ygopro-core\libygo.dll"
SCRIPTS_DIR = r"C:\msys64\home\Jacob\ygopro-scripts"

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

def card_reader_impl(code, data_ptr):
    info = get_card(code)  # direct SQLite lookup, no network, no preloaded dict
    if not info:
        print(f"[card_reader] not found in cards.db: {code}")
        return 0
    d = data_ptr.contents
    d.code = code
    d.type = info["type"]
    d.level = info["level"]
    d.attribute = info["attribute"]
    d.race = info["race"]
    d.attack = info["attack"]
    d.defense = info["defense"]
    d.link_marker = info["link_marker"]
    return 1

_script_cache = {}

def script_reader_impl(script_name, len_ptr):
    name = script_name.decode("utf-8") if script_name else ""
    filename = os.path.basename(name)
    path = os.path.join(SCRIPTS_DIR, filename)
    if not os.path.exists(path):
        print(f"[script_reader] MISSING: {path}")
        return None
    with open(path, "rb") as f:
        data = f.read()
    buf = ctypes.create_string_buffer(data, len(data))
    _script_cache[name] = buf
    len_ptr[0] = len(data)
    return ctypes.cast(buf, ctypes.c_void_p).value

def message_handler_impl(pduel, msg_type):
    print(f"[message_handler] msg_type={msg_type}")
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
print("pduel handle:", pduel)
assert pduel != 0

lib.set_player_info(ctypes.c_ssize_t(pduel), 0, 8000, 5, 1)
lib.set_player_info(ctypes.c_ssize_t(pduel), 1, 8000, 5, 1)

LOCATION_MZONE = 0x04
POS_FACEUP_ATTACK = 0x1

# --- edit this to place whatever cards your puzzle needs ---
# find codes with: python card_lookup.py "<search term>"
PUZZLE_CARDS = [
    93854893,  # Dingirsu, the Orcust of the Evening Star
]

for i, code in enumerate(PUZZLE_CARDS):
    info = get_card(code)
    print(f"placing {info['name'] if info else code} in zone {i}")
    lib.new_card(
        ctypes.c_ssize_t(pduel), ctypes.c_uint32(code),
        ctypes.c_uint8(0), ctypes.c_uint8(0),
        ctypes.c_uint8(LOCATION_MZONE), ctypes.c_uint8(i),
        ctypes.c_uint8(POS_FACEUP_ATTACK),
    )

lib.start_duel(ctypes.c_ssize_t(pduel), ctypes.c_uint32(0))
result = lib.process(ctypes.c_ssize_t(pduel))
print("process() result:", result)

lib.end_duel(ctypes.c_ssize_t(pduel))
print("SUCCESS: cards loaded live from cards.db and ran without crashing.")
