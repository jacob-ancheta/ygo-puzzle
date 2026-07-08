import os
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

MINGW_BIN = r"C:\msys64\mingw64\bin"
if os.path.exists(MINGW_BIN):
    os.add_dll_directory(MINGW_BIN)

DLL_PATH = r"C:\msys64\home\Jacob\ygopro-core\libygo.dll"
SCRIPTS_DIR = r"C:\msys64\home\Jacob\ygopro-scripts"

lib = ctypes.CDLL(DLL_PATH)

class CardDataExact(Structure):
    _fields_ = [
        ("code", c_uint32),
        ("alias", c_uint32),
        ("setcode", ctypes.c_uint16 * 16),
        ("type", c_uint32),
        ("level", c_uint32),
        ("attribute", c_uint32),
        ("race", c_uint32),
        ("attack", c_int32),
        ("defense", c_int32),
        ("lscale", c_uint32),
        ("rscale", c_uint32),
        ("link_marker", c_uint32),
        ("rule_code", c_uint32),
    ]
assert ctypes.sizeof(CardDataExact) == 80

DINGIRSU_CODE = 93854893
TYPE_MONSTER = 0x1
TYPE_EFFECT = 0x20
TYPE_XYZ = 0x800000
ATTRIBUTE_DARK = 0x20
RACE_MACHINE = 0x20

# a small local "card database" -- stand-in for what will later come from YGOPRODeck's API
CARD_DB = {
    DINGIRSU_CODE: {
        "type": TYPE_MONSTER | TYPE_EFFECT | TYPE_XYZ,
        "level": 8,   # rank, for Xyz monsters
        "attribute": ATTRIBUTE_DARK,
        "race": RACE_MACHINE,
        "attack": 2600,
        "defense": 2100,
    }
}

def card_reader_impl(code, data_ptr):
    info = CARD_DB.get(code)
    if not info:
        return 0
    d = data_ptr.contents
    d.code = code
    d.type = info["type"]
    d.level = info["level"]
    d.attribute = info["attribute"]
    d.race = info["race"]
    d.attack = info["attack"]
    d.defense = info["defense"]
    return 1

_script_cache = {}  # keep buffers alive so ctypes doesn't free them mid-call

def script_reader_impl(script_name, len_ptr):
    name = script_name.decode("utf-8") if script_name else ""
    filename = os.path.basename(name)  # e.g. "c93854893.lua"
    path = os.path.join(SCRIPTS_DIR, filename)
    if not os.path.exists(path):
        print(f"[script_reader] MISSING: {path}")
        return None
    with open(path, "rb") as f:
        data = f.read()
    buf = ctypes.create_string_buffer(data, len(data))
    _script_cache[name] = buf
    len_ptr[0] = len(data)
    print(f"[script_reader] loaded {filename} ({len(data)} bytes)")
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

# place Dingirsu directly onto player 0's field (skipping the actual Xyz summon procedure --
# we just want to confirm its real script loads and its effects register cleanly)
lib.new_card(
    ctypes.c_ssize_t(pduel),
    ctypes.c_uint32(DINGIRSU_CODE),
    ctypes.c_uint8(0),
    ctypes.c_uint8(0),
    ctypes.c_uint8(LOCATION_MZONE),
    ctypes.c_uint8(0),
    ctypes.c_uint8(POS_FACEUP_ATTACK),
)

lib.start_duel(ctypes.c_ssize_t(pduel), ctypes.c_uint32(0))

result = lib.process(ctypes.c_ssize_t(pduel))
print("process() result:", result)

buf = (ctypes.c_ubyte * 4096)()
msg_len = lib.get_message(ctypes.c_ssize_t(pduel), buf)
print("get_message length:", msg_len)
print("raw bytes:", bytes(buf[:min(64, msg_len)]))

lib.end_duel(ctypes.c_ssize_t(pduel))
print("SUCCESS: Dingirsu's real card data + real Lua script loaded and ran without crashing.")