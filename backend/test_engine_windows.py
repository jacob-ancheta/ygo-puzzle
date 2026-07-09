import os
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

MINGW_BIN = r"C:\msys64\mingw64\bin"
if os.path.exists(MINGW_BIN):
    os.add_dll_directory(MINGW_BIN)

DLL_PATH = r"C:\msys64\home\Jacob\ygopro-core\libygo.dll"
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

assert ctypes.sizeof(CardDataExact) == 80, ctypes.sizeof(CardDataExact)
print("CardDataExact size OK:", ctypes.sizeof(CardDataExact))

FAKE_CODE = 999999999

def card_reader_impl(code, data_ptr):
    if code == FAKE_CODE:
        d = data_ptr.contents
        d.code = FAKE_CODE
        d.type = 0x1
        d.level = 4
        d.attribute = 0x10
        d.race = 0x1
        d.attack = 1200
        d.defense = 1000
        return 1
    return 0

def script_reader_impl(script_name, len_ptr):
    return None

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
assert pduel != 0, "create_duel failed"

lib.set_player_info(ctypes.c_ssize_t(pduel), 0, 8000, 5, 1)
lib.set_player_info(ctypes.c_ssize_t(pduel), 1, 8000, 5, 1)

LOCATION_MZONE = 0x04
POS_FACEUP_ATTACK = 0x1

lib.new_card(
    ctypes.c_ssize_t(pduel),
    ctypes.c_uint32(FAKE_CODE),
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
print("raw bytes (first 32):", bytes(buf[:min(32, msg_len)]))

lib.end_duel(ctypes.c_ssize_t(pduel))
print("SUCCESS: engine created a duel, placed a card, and produced a message without crashing.")