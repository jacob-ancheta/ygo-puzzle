"""
Batch version of load_puzzle.py's checks: resolves every card name AND loads
every puzzle file into the real ygopro-core engine, across ALL files in
puzzles/ (not just today's). Exits non-zero -- printing every failing
puzzle, not just the first -- if anything's wrong, so it can gate the Docker
build: a bad puzzle fails the build and Render just keeps serving the last
good image instead of shipping a broken one.

Run manually with `python validate_puzzles.py` before pushing to the
puzzles repo, or let the Dockerfile run it automatically after cloning the
puzzles repo in.
"""
import os
import sys
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

from card_lookup import get_card, get_card_by_name, search_cards
from puzzle_registry import available_dates, load_puzzle

try:
    from local_config import MINGW_BIN, DLL_PATH, SCRIPTS_DIR
except ImportError:
    raise SystemExit(
        "Missing backend/local_config.py -- copy backend/local_config.example.py "
        "to backend/local_config.py and edit it to point at your own ygopro-core "
        "/ ygopro-scripts checkout."
    )

if os.path.exists(MINGW_BIN):
    os.add_dll_directory(MINGW_BIN)


def collect_all_names(puzzle):
    names = []
    for entry in puzzle.get("opponent_field", []):
        names.append(entry["name"])
    names += puzzle.get("player_hand", [])
    names += puzzle.get("player_deck", [])
    names += puzzle.get("player_extra", [])
    return names


def resolve_names(puzzle):
    """Like load_puzzle.py's resolve_all(), but returns failures instead of
    exiting -- one bad puzzle shouldn't hide problems in the rest of the batch."""
    resolved = {}
    failed = []
    for name in collect_all_names(puzzle):
        card = get_card_by_name(name)
        if card is None:
            failed.append(name)
        else:
            resolved[name] = card
    return resolved, failed


# ---------- engine setup (once, shared across all puzzles) ----------
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

LOCATION_DECK, LOCATION_HAND, LOCATION_MZONE = 0x01, 0x02, 0x04
LOCATION_EXTRA = 0x40
POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE = 0x1, 0x4


def place(pduel, code, owner, location, zone, position):
    lib.new_card(
        ctypes.c_ssize_t(pduel), ctypes.c_uint32(code),
        ctypes.c_uint8(owner), ctypes.c_uint8(owner),
        ctypes.c_uint8(location), ctypes.c_uint8(zone), ctypes.c_uint8(position),
    )


def load_into_engine(puzzle, resolved):
    """Builds the board and starts the duel exactly like load_puzzle.py's
    manual test script does. Raises on any engine-level failure."""
    pduel = lib.create_duel(12345)
    if not pduel:
        raise RuntimeError("create_duel returned a null handle")
    try:
        lib.set_player_info(ctypes.c_ssize_t(pduel), 0, puzzle["lp"]["player"], 0, 1)
        lib.set_player_info(ctypes.c_ssize_t(pduel), 1, puzzle["lp"]["opponent"], 0, 1)

        for i, entry in enumerate(puzzle.get("opponent_field", [])):
            card = resolved[entry["name"]]
            pos = POS_FACEUP_ATTACK if entry["position"] == "attack" else POS_FACEUP_DEFENSE
            place(pduel, card["code"], 1, LOCATION_MZONE, i, pos)

        for i, name in enumerate(puzzle.get("player_hand", [])):
            place(pduel, resolved[name]["code"], 0, LOCATION_HAND, i, POS_FACEUP_ATTACK)

        for i, name in enumerate(puzzle.get("player_deck", [])):
            place(pduel, resolved[name]["code"], 0, LOCATION_DECK, i, POS_FACEUP_ATTACK)

        for i, name in enumerate(puzzle.get("player_extra", [])):
            place(pduel, resolved[name]["code"], 0, LOCATION_EXTRA, i, POS_FACEUP_ATTACK)

        lib.start_duel(ctypes.c_ssize_t(pduel), ctypes.c_uint32(0))
        lib.process(ctypes.c_ssize_t(pduel))
    finally:
        lib.end_duel(ctypes.c_ssize_t(pduel))


def main():
    dates = available_dates()
    if not dates:
        print("No puzzle files found -- nothing to validate.")
        return

    errors = {}
    for date_str in dates:
        try:
            puzzle = load_puzzle(date_str)
        except Exception as exc:
            errors[date_str] = [f"failed to load file: {exc}"]
            continue

        resolved, failed_names = resolve_names(puzzle)
        if failed_names:
            msgs = []
            for name in failed_names:
                matches = search_cards(name, limit=5)
                if matches:
                    close = ", ".join(f"'{cname}'" for _, cname, *_ in matches)
                    msgs.append(f"unresolved card name '{name}' -- close matches: {close}")
                else:
                    msgs.append(f"unresolved card name '{name}' -- no close matches")
            errors[date_str] = msgs
            continue

        try:
            load_into_engine(puzzle, resolved)
        except Exception as exc:
            errors[date_str] = [f"engine failed to load puzzle: {exc}"]

    if errors:
        print("=" * 60)
        print(f"{len(errors)} of {len(dates)} puzzle(s) FAILED validation:")
        for date_str, msgs in errors.items():
            print(f"\n  {date_str}:")
            for msg in msgs:
                print(f"    - {msg}")
        print("=" * 60)
        sys.exit(1)

    print(f"All {len(dates)} puzzle(s) resolved and loaded cleanly.")


if __name__ == "__main__":
    main()
