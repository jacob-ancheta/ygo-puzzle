"""
Same ygopro-core engine plumbing as the original play_puzzle terminal script,
restructured so it can be driven over a network instead of a TTY:

- Engine setup (ctypes bindings, card/script readers, duel creation, placing
  the puzzle's cards, starting the duel) lives in DuelEngine, one instance per
  in-progress puzzle attempt instead of module-level globals.
- The message loop is a generator (`run`). Messages that are pure state
  changes (a card moved, LP changed, a chain resolved, ...) are yielded as
  {"type": "event", ...} and the driver should resume immediately with
  `gen.send(None)`. Messages that need a decision are yielded as
  {"type": "prompt", ...} and the driver must resume with
  `gen.send(<response dict from the client>)`.

This lets a FastAPI WebSocket (or a plain test client) drive the exact same
engine logic that play_puzzle used to run against input(), just swapping the
terminal for JSON messages.
"""
import itertools
import os
import random
import ctypes
from ctypes import c_int32, c_uint32, c_uint8, c_char_p, c_void_p, POINTER, Structure, CFUNCTYPE

from card_lookup import get_card, get_card_by_name, search_cards

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

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


class PuzzleLoadError(Exception):
    def __init__(self, failed, suggestions):
        self.failed = failed
        self.suggestions = suggestions
        super().__init__(f"could not resolve card name(s): {', '.join(failed)}")


def resolve_all(puzzle):
    names = [e["name"] for e in puzzle["opponent_field"]]
    names += puzzle["player_hand"] + puzzle["player_deck"] + puzzle["player_extra"]
    names += [e["name"] for e in puzzle.get("player_field", [])]
    names += puzzle.get("player_banished", [])
    resolved, failed = {}, []
    for name in names:
        card = get_card_by_name(name)
        if card is None:
            failed.append(name)
        else:
            resolved[name] = card
    if failed:
        suggestions = {
            name: [{"code": code, "name": cname} for code, cname, *_ in search_cards(name, limit=5)]
            for name in failed
        }
        raise PuzzleLoadError(failed, suggestions)
    return resolved


# ---------- engine setup (process-global: the library, callbacks, and card
# reader are stateless w.r.t. any single duel, so they're registered once) ----------

class CardDataExact(Structure):
    _fields_ = [
        ("code", c_uint32), ("alias", c_uint32), ("setcode", ctypes.c_uint16 * 16),
        ("type", c_uint32), ("level", c_uint32), ("attribute", c_uint32),
        ("race", c_uint32), ("attack", c_int32), ("defense", c_int32),
        ("lscale", c_uint32), ("rscale", c_uint32), ("link_marker", c_uint32),
        ("rule_code", c_uint32),
    ]


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
        return 0
    d = data_ptr.contents
    d.code = code
    d.alias = info["alias"]
    d.type, d.level, d.attribute = info["type"], info["level"], info["attribute"]
    d.race, d.attack, d.defense = info["race"], info["attack"], info["defense"]
    d.link_marker = info["link_marker"]
    d.lscale, d.rscale = info["lscale"], info["rscale"]
    codes = unpack_setcode(info["setcode"])
    for i in range(16):
        d.setcode[i] = codes[i] if i < len(codes) else 0
    return 1


# Virtual script (never touches disk) that backfills summon history for
# opponent_field entries with a "summoned" key in the puzzle definition. Cards
# placed via new_card/add_card bypass the real summon procedure, so effects
# that check IsSummonType (e.g. Bystial Druiswurm's GY trigger) can never
# find a legal target among them without this.
#
# script_reader_impl is a single process-global ctypes callback shared by
# every concurrent duel (different users can be on different puzzles -- e.g.
# today's vs. an archived date -- at the same time), so the setup script for
# each DuelEngine is registered here under its own unique virtual filename
# rather than a single fixed name, and looked up by that name when the
# engine asks for it.
SUMMON_TYPE_LUA = {"special": "SUMMON_TYPE_SPECIAL", "normal": "SUMMON_TYPE_NORMAL"}

_puzzle_setup_scripts = {}
_setup_script_ids = itertools.count()


def build_puzzle_setup_script(puzzle):
    lines = []
    for i, entry in enumerate(puzzle["opponent_field"]):
        summon_type = entry.get("summoned")
        if not summon_type:
            continue
        if summon_type not in SUMMON_TYPE_LUA:
            raise ValueError(
                f"unknown summoned={summon_type!r} for {entry['name']!r} "
                f"(expected 'special' or 'normal')"
            )
        lines.append(
            f"do local c = Duel.GetFieldCard(1, LOCATION_MZONE, {i}) "
            f"if c then Debug.PreSummon(c, {SUMMON_TYPE_LUA[summon_type]}) end end"
        )
    return "\n".join(lines).encode()


_script_cache = {}


def script_reader_impl(script_name, len_ptr):
    name = script_name.decode("utf-8") if script_name else ""
    basename = os.path.basename(name)
    if basename in _puzzle_setup_scripts:
        data = _puzzle_setup_scripts[basename]
    else:
        local_path = os.path.join(BACKEND_DIR, basename)
        path = local_path if os.path.exists(local_path) else os.path.join(SCRIPTS_DIR, basename)
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


lib = ctypes.CDLL(DLL_PATH)

CARD_READER = CFUNCTYPE(c_uint32, c_uint32, POINTER(CardDataExact))
SCRIPT_READER = CFUNCTYPE(c_void_p, c_char_p, POINTER(ctypes.c_int))
MESSAGE_HANDLER = CFUNCTYPE(c_uint32, ctypes.c_ssize_t, c_uint32)
_card_reader_cb = CARD_READER(card_reader_impl)
_script_reader_cb = SCRIPT_READER(script_reader_impl)
_message_handler_cb = MESSAGE_HANDLER(message_handler_impl)
lib.set_card_reader(_card_reader_cb)
lib.set_script_reader(_script_reader_cb)
lib.set_message_handler(_message_handler_cb)

lib.create_duel.restype = ctypes.c_ssize_t
lib.create_duel.argtypes = [ctypes.c_uint32]
lib.preload_script.restype = ctypes.c_int32
lib.query_field_card.restype = ctypes.c_int32
lib.query_field_card.argtypes = [ctypes.c_ssize_t, ctypes.c_uint8, ctypes.c_uint8, ctypes.c_uint32,
                                  ctypes.POINTER(ctypes.c_ubyte), ctypes.c_int32]

LOCATION_DECK, LOCATION_HAND, LOCATION_MZONE, LOCATION_SZONE, LOCATION_EXTRA = 0x01, 0x02, 0x04, 0x08, 0x40
LOCATION_REMOVED = 0x20
POS_FACEUP_ATTACK, POS_FACEUP_DEFENSE = 0x1, 0x4
QUERY_ATTACK, QUERY_DEFENSE = 0x100, 0x200
TYPE_LINK = 0x4000000
DUEL_ATTACK_FIRST_TURN = 0x02  # puzzles are constructed positions, not turn 1 of a real match --
                                # without this, the engine correctly (but unhelpfully) blocks
                                # Battle Phase entirely on the very first turn.


class DuelEnded(Exception):
    """Raised when the engine's processor queue is genuinely empty (no more
    messages will ever come without some external stimulus we haven't given)."""


class MessageStream:
    """Pulls messages from the engine, transparently spanning multiple
    process() calls so a single message is never split."""

    def __init__(self, pduel):
        self.pduel = pduel
        self.buf = b""
        self.pos = 0

    def _refill(self):
        # A single process() call can legitimately come back with nothing new
        # (the engine's internal step queue can go quiet for a call or two,
        # e.g. right after a PROCESSOR_WAIT-based message like MSG_CONFIRM_CARDS,
        # while it resumes the yielded script) without the duel actually being
        # over, so retry a bounded number of times before giving up for real.
        for _ in range(1000):
            result = lib.process(ctypes.c_ssize_t(self.pduel))
            msg_len = result & 0xffff
            if msg_len:
                raw = (ctypes.c_ubyte * msg_len)()
                lib.get_message(ctypes.c_ssize_t(self.pduel), raw)
                self.buf = bytes(raw)
                self.pos = 0
                return True
        return False

    def _ensure(self):
        while self.pos >= len(self.buf):
            if not self._refill():
                raise DuelEnded()

    def u8(self):
        self._ensure()
        v = self.buf[self.pos]; self.pos += 1
        return v

    def u16(self):
        self._ensure()
        v = int.from_bytes(self.buf[self.pos:self.pos + 2], "little"); self.pos += 2
        return v

    def u32(self):
        self._ensure()
        v = int.from_bytes(self.buf[self.pos:self.pos + 4], "little"); self.pos += 4
        return v

    def raw(self, n):
        self._ensure()
        v = self.buf[self.pos:self.pos + n]; self.pos += n
        return v


class DuelEngine:
    """One puzzle attempt: a live pduel handle plus the message stream reading
    from it. Create a fresh instance per session/connection."""

    def __init__(self, puzzle, seed=None):
        self.puzzle = puzzle
        self.resolved = resolve_all(puzzle)
        if seed is None:
            seed = random.getrandbits(32)
        self.pduel = lib.create_duel(ctypes.c_uint32(seed))

        lib.set_player_info(ctypes.c_ssize_t(self.pduel), 0, puzzle["lp"]["player"], 0, 1)
        lib.set_player_info(ctypes.c_ssize_t(self.pduel), 1, puzzle["lp"]["opponent"], 0, 1)

        for i, entry in enumerate(puzzle["opponent_field"]):
            card = self.resolved[entry["name"]]
            pos = POS_FACEUP_ATTACK if entry["position"] == "attack" else POS_FACEUP_DEFENSE
            self._place(card["code"], 1, LOCATION_MZONE, i, pos)
        for i, name in enumerate(puzzle["player_hand"]):
            self._place(self.resolved[name]["code"], 0, LOCATION_HAND, i, POS_FACEUP_ATTACK)
        for i, name in enumerate(puzzle["player_deck"]):
            self._place(self.resolved[name]["code"], 0, LOCATION_DECK, i, POS_FACEUP_ATTACK)
        for i, name in enumerate(puzzle["player_extra"]):
            self._place(self.resolved[name]["code"], 0, LOCATION_EXTRA, i, POS_FACEUP_ATTACK)
        # Optional, symmetric with opponent_field -- lets a puzzle start
        # mid-combo with the player's own monsters already on the field or
        # already banished, instead of only ever starting from hand/deck.
        for i, entry in enumerate(puzzle.get("player_field", [])):
            card = self.resolved[entry["name"]]
            pos = POS_FACEUP_ATTACK if entry["position"] == "attack" else POS_FACEUP_DEFENSE
            self._place(card["code"], 0, LOCATION_MZONE, i, pos)
        for i, name in enumerate(puzzle.get("player_banished", [])):
            self._place(self.resolved[name]["code"], 0, LOCATION_REMOVED, i, POS_FACEUP_ATTACK)

        lib.start_duel(ctypes.c_ssize_t(self.pduel), ctypes.c_uint32(DUEL_ATTACK_FIRST_TURN))

        setup_script = build_puzzle_setup_script(puzzle)
        if setup_script:
            self.setup_script_name = f"__puzzle_setup_{next(_setup_script_ids)}__.lua"
            _puzzle_setup_scripts[self.setup_script_name] = setup_script
            lib.preload_script(ctypes.c_ssize_t(self.pduel), self.setup_script_name.encode())
        else:
            self.setup_script_name = None

        self.stream = MessageStream(self.pduel)

    def _place(self, code, owner, location, zone, position):
        lib.new_card(ctypes.c_ssize_t(self.pduel), ctypes.c_uint32(code), ctypes.c_uint8(owner),
                     ctypes.c_uint8(owner), ctypes.c_uint8(location), ctypes.c_uint8(zone),
                     ctypes.c_uint8(position))

    def send_i(self, value):
        lib.set_responsei(ctypes.c_ssize_t(self.pduel), ctypes.c_int32(value))

    def send_b(self, byte_values):
        # set_responseb always memcpy's a fixed 256 bytes from whatever we pass,
        # so the buffer must always be fully allocated, not sized to the payload.
        buf_out = (ctypes.c_ubyte * 256)()
        for i, v in enumerate(byte_values):
            buf_out[i] = v & 0xff
        lib.set_responseb(ctypes.c_ssize_t(self.pduel), buf_out)

    def close(self):
        """Release this engine's entry in the process-global setup-script
        registry. Call once when the connection using it ends."""
        if self.setup_script_name:
            _puzzle_setup_scripts.pop(self.setup_script_name, None)


def initial_board_state(engine):
    """The starting position is placed via new_card() before start_duel, so no
    MSG_MOVE ever describes it -- the client needs this snapshot to render
    anything before the first event arrives."""
    puzzle = engine.puzzle

    def brief(name):
        return card_brief(engine.resolved[name]["code"])

    return {
        "type": "event",
        "event": "board_state",
        "lp": dict(puzzle["lp"]),
        "opponent_field": [
            {"card": brief(entry["name"]), "zone": i, "position": entry["position"]}
            for i, entry in enumerate(puzzle["opponent_field"])
        ],
        "player_hand": [brief(name) for name in puzzle["player_hand"]],
        "player_deck": [brief(name) for name in puzzle["player_deck"]],
        "player_extra": [brief(name) for name in puzzle["player_extra"]],
        "player_field": [
            {"card": brief(entry["name"]), "zone": i, "position": entry["position"]}
            for i, entry in enumerate(puzzle.get("player_field", []))
        ],
        "player_banished": [brief(name) for name in puzzle.get("player_banished", [])],
    }


# ---------- message protocol ----------
MSG_RETRY = 1
MSG_HINT = 2
MSG_WIN = 5
MSG_SELECT_BATTLECMD = 10
MSG_SELECT_IDLECMD = 11
MSG_SELECT_EFFECTYN = 12
MSG_SELECT_YESNO = 13
MSG_SELECT_OPTION = 14
MSG_SELECT_CARD = 15
MSG_SELECT_CHAIN = 16
MSG_SELECT_PLACE = 18
MSG_SELECT_POSITION = 19
MSG_SELECT_TRIBUTE = 20
MSG_SELECT_COUNTER = 22
MSG_SELECT_SUM = 23
MSG_SELECT_DISFIELD = 24
MSG_SORT_CARD = 25
MSG_SELECT_UNSELECT_CARD = 26
MSG_CONFIRM_DECKTOP = 30
MSG_CONFIRM_CARDS = 31
MSG_SHUFFLE_DECK = 32
MSG_SHUFFLE_HAND = 33
MSG_SWAP_GRAVE_DECK = 35
MSG_SHUFFLE_SET_CARD = 36
MSG_REVERSE_DECK = 37
MSG_DECK_TOP = 38
MSG_SHUFFLE_EXTRA = 39
MSG_NEW_TURN = 40
MSG_NEW_PHASE = 41
MSG_CONFIRM_EXTRATOP = 42
MSG_MOVE = 50
MSG_POS_CHANGE = 53
MSG_SET = 54
MSG_SWAP = 55
MSG_FIELD_DISABLED = 56
MSG_SUMMONING = 60
MSG_SUMMONED = 61
MSG_SPSUMMONING = 62
MSG_SPSUMMONED = 63
MSG_FLIPSUMMONING = 64
MSG_FLIPSUMMONED = 65
MSG_CHAINING = 70
MSG_CHAINED = 71
MSG_CHAIN_SOLVING = 72
MSG_CHAIN_SOLVED = 73
MSG_CHAIN_END = 74
MSG_CHAIN_NEGATED = 75
MSG_CHAIN_DISABLED = 76
MSG_RANDOM_SELECTED = 81
MSG_BECOME_TARGET = 83
MSG_DRAW = 90
MSG_DAMAGE = 91
MSG_RECOVER = 92
MSG_EQUIP = 93
MSG_LPUPDATE = 94
MSG_UNEQUIP = 95
MSG_CARD_TARGET = 96
MSG_CANCEL_TARGET = 97
MSG_PAY_LPCOST = 100
MSG_ADD_COUNTER = 101
MSG_REMOVE_COUNTER = 102
MSG_ATTACK = 110
MSG_BATTLE = 111
MSG_ATTACK_DISABLED = 112
MSG_DAMAGE_STEP_START = 113
MSG_DAMAGE_STEP_END = 114
MSG_MISSED_EFFECT = 120
MSG_TOSS_COIN = 130
MSG_TOSS_DICE = 131
MSG_ROCK_PAPER_SCISSORS = 132
MSG_HAND_RES = 133
MSG_ANNOUNCE_RACE = 140
MSG_ANNOUNCE_ATTRIB = 141
MSG_ANNOUNCE_CARD = 142
MSG_ANNOUNCE_NUMBER = 143
MSG_CARD_HINT = 160
MSG_TAG_SWAP = 161
MSG_RELOAD_FIELD = 162
MSG_AI_NAME = 163
MSG_SHOW_HINT = 164
MSG_PLAYER_HINT = 165
MSG_MATCH_KILL = 170

LOCATION_NAMES = {
    LOCATION_DECK: "Deck", LOCATION_HAND: "Hand", LOCATION_MZONE: "Monster Zone",
    LOCATION_SZONE: "Spell/Trap Zone", 0x10: "Graveyard", 0x20: "Banished",
    LOCATION_EXTRA: "Extra Deck", 0x80: "Overlay",
}


def describe_location(info):
    controller = info & 0xff
    location = (info >> 8) & 0xff
    sequence = (info >> 16) & 0xff
    position = (info >> 24) & 0xff
    return {
        "controller": controller,
        "location": LOCATION_NAMES.get(location, hex(location)),
        "location_id": location,
        "sequence": sequence,
        "position": position,
    }


PHASE_NAMES = {
    0x01: "Draw Phase", 0x02: "Standby Phase", 0x04: "Main Phase 1",
    0x08: "Battle Start", 0x10: "Battle Step", 0x20: "Damage Step",
    0x40: "Damage Calculation", 0x80: "Battle Step End", 0x100: "Main Phase 2",
    0x200: "End Phase",
}
PHASE_END = 0x200

IDLE_ACTION_NAMES = ["Summon", "Special Summon", "Change Position", "Set Monster",
                     "Set Spell/Trap", "Activate", "Go to Battle Phase", "Go to End Phase", "Shuffle Hand"]


def card_name(code):
    info = get_card(code & 0x7fffffff)
    return info["name"] if info else f"unknown({code})"


TYPE_MONSTER = 0x1

def card_brief(code):
    code &= 0x7fffffff
    info = get_card(code)
    if not info:
        return {"code": code, "name": f"unknown({code})"}
    brief = {
        "code": code, "name": info["name"], "type": info["type"], "desc": info["desc"],
        "image_full": f"/card_images/full/{code}.jpg",
        "image_cropped": f"/card_images/cropped/{code}.jpg",
    }
    if info["type"] & TYPE_MONSTER:
        brief["attack"] = info["attack"]
        brief["defense"] = info["defense"]
        brief["level"] = info["level"]
    return brief


def query_live_stats(engine):
    """Snapshot the current (post-effect) ATK/DEF of every monster in both
    Monster Zones. card_brief() only has the printed/base stats from
    cards.db, which don't reflect in-duel modifications -- stat-boost
    effects, "double this card's ATK" effects, Link Monster continuous
    effects on the opponent's stats, etc. -- so the client needs this to
    display those correctly."""
    results = []
    for controller in (0, 1):
        buf = (ctypes.c_ubyte * 4096)()
        n = lib.query_field_card(ctypes.c_ssize_t(engine.pduel), ctypes.c_uint8(controller),
                                  ctypes.c_uint8(LOCATION_MZONE), ctypes.c_uint32(QUERY_ATTACK | QUERY_DEFENSE),
                                  buf, ctypes.c_int32(0))
        offset = 0
        sequence = 0
        while offset < n:
            length = int.from_bytes(bytes(buf[offset:offset + 4]), "little")
            if length <= 4:
                offset += 4
                sequence += 1
                continue
            attack = int.from_bytes(bytes(buf[offset + 8:offset + 12]), "little", signed=True)
            defense = int.from_bytes(bytes(buf[offset + 12:offset + 16]), "little", signed=True)
            results.append({"controller": controller, "sequence": sequence, "attack": attack, "defense": defense})
            offset += length
            sequence += 1
    return results


def decode_place_flag(flag, playerid):
    # bit layout per ygopro-core playerop.cpp field::select_place (bit set = zone blocked):
    #   0-6: own mzone seq 0-6      8-12: own szone seq 0-4      14-15: own pzone (seq 6/7)
    #   16-22: opp mzone seq 0-6    24-28: opp szone seq 0-4     30-31: opp pzone (seq 6/7)
    opp = 1 - playerid
    options = []
    for s in range(7):
        if not (flag & (1 << s)):
            options.append((playerid, LOCATION_MZONE, s, f"Your Monster Zone {s}"))
    for s in range(5):
        if not (flag & (1 << (8 + s))):
            options.append((playerid, LOCATION_SZONE, s, f"Your Spell/Trap Zone {s}"))
    if not (flag & (1 << 14)):
        options.append((playerid, LOCATION_SZONE, 6, "Your Pendulum Zone (left)"))
    if not (flag & (1 << 15)):
        options.append((playerid, LOCATION_SZONE, 7, "Your Pendulum Zone (right)"))
    for s in range(7):
        if not (flag & (1 << (16 + s))):
            options.append((opp, LOCATION_MZONE, s, f"Opponent Monster Zone {s}"))
    for s in range(5):
        if not (flag & (1 << (24 + s))):
            options.append((opp, LOCATION_SZONE, s, f"Opponent Spell/Trap Zone {s}"))
    if not (flag & (1 << 30)):
        options.append((opp, LOCATION_SZONE, 6, "Opponent Pendulum Zone (left)"))
    if not (flag & (1 << 31)):
        options.append((opp, LOCATION_SZONE, 7, "Opponent Pendulum Zone (right)"))
    return options


# ---------- yield-based prompt helpers ----------
# Each helper yields a "prompt" payload and validates the client's response,
# re-yielding the same prompt (with an "error" note) until it gets something
# usable. This replaces the terminal version's input()-validation loops.

def ask_index(payload, n):
    current = payload
    while True:
        response = yield current
        choice = (response or {}).get("choice")
        if isinstance(choice, int) and 0 <= choice < n:
            return choice
        current = dict(payload, error="invalid choice")


def ask_yesno(payload):
    choice = yield from ask_index(payload, 2)
    return choice


def ask_indices(payload, n, min_sel, max_sel):
    current = payload
    while True:
        response = yield current
        chosen = (response or {}).get("indices")
        if (isinstance(chosen, list) and min_sel <= len(chosen) <= max_sel
                and all(isinstance(i, int) and 0 <= i < n for i in chosen)
                and len(set(chosen)) == len(chosen)):
            return chosen
        current = dict(payload, error="invalid selection")


def ask_counter_alloc(payload, items, total):
    current = payload
    while True:
        response = yield current
        alloc = (response or {}).get("allocation")
        if (isinstance(alloc, list) and len(alloc) == len(items)
                and all(isinstance(a, int) and 0 <= a <= items[i][1] for i, a in enumerate(alloc))
                and sum(alloc) == total):
            return alloc
        current = dict(payload, error="invalid allocation")

def ask_text(payload):
    current = payload
    while True:
        response = yield current
        name = (response or {}).get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
        current = dict(payload, error="enter a name")


def ask_bitmask(payload):
    current = payload
    while True:
        response = yield current
        value = (response or {}).get("value")
        if isinstance(value, int) and value >= 0:
            return value
        current = dict(payload, error="invalid value")


def interact(engine, ask):
    """Run generator `ask` (which yields a prompt and returns a parsed
    decision) then have the engine react. If it comes back MSG_RETRY (the
    decision was rejected as illegal), report that and ask again."""
    while True:
        yield from ask()
        msg = engine.stream.u8()
        if msg == MSG_RETRY:
            yield {"type": "event", "event": "retry"}
            continue
        return msg


def read_zone_card_list(engine, n, extra_u32=False):
    """Reads n * (code:u32, controller:u8, location:u8, sequence:u8[, extra:u32])."""
    items = []
    for _ in range(n):
        code = engine.stream.u32() & 0x7fffffff
        ctrl = engine.stream.u8(); loc = engine.stream.u8(); seq = engine.stream.u8()
        extra = engine.stream.u32() if extra_u32 else None
        items.append((code, ctrl, loc, seq, extra))
    return items


def run(engine):
    """The message loop. Yields {"type": "event", ...} for state changes
    (driver should resume with gen.send(None)) and {"type": "prompt", ...}
    for decisions (driver should resume with gen.send(<client response>))."""
    stream = engine.stream
    pending = None
    current_turn_player = 0

    while True:
        msg = pending if pending is not None else stream.u8()
        pending = None

        if msg == MSG_NEW_TURN:
            player = stream.u8()
            current_turn_player = player
            yield {"type": "event", "event": "new_turn", "player": player}

        elif msg == MSG_NEW_PHASE:
            phase = stream.u16()
            yield {"type": "event", "event": "new_phase", "phase": PHASE_NAMES.get(phase, hex(phase))}
            if phase == PHASE_END and current_turn_player == 0:
                yield {"type": "event", "event": "loss", "message": "turn ended without winning"}
                return

        elif msg == MSG_HINT:
            stream.u8(); stream.u8(); stream.u32()  # UI-only, nothing to act on

        elif msg == MSG_DRAW:
            player = stream.u8()
            count = stream.u8()
            codes = [stream.u32() & 0x7fffffff for _ in range(count)]
            yield {"type": "event", "event": "draw", "player": player,
                   "cards": [card_brief(c) for c in codes]}

        elif msg == MSG_MOVE:
            code = stream.u32() & 0x7fffffff
            prev = stream.u32()
            cur = stream.u32()
            stream.u32()  # reason, not needed
            yield {"type": "event", "event": "move", "card": card_brief(code),
                   "from": describe_location(prev), "to": describe_location(cur)}

        elif msg == MSG_SUMMONING:
            code = stream.u32() & 0x7fffffff
            stream.u32()
            yield {"type": "event", "event": "summoning", "card": card_brief(code)}

        elif msg == MSG_SUMMONED:
            yield {"type": "event", "event": "summoned"}
            yield {"type": "event", "event": "stats_update", "cards": query_live_stats(engine)}

        elif msg == MSG_SPSUMMONING:
            code = stream.u32() & 0x7fffffff
            stream.u32()
            yield {"type": "event", "event": "spsummoning", "card": card_brief(code)}

        elif msg == MSG_SPSUMMONED:
            yield {"type": "event", "event": "spsummoned"}
            yield {"type": "event", "event": "stats_update", "cards": query_live_stats(engine)}

        elif msg == MSG_FLIPSUMMONING:
            code = stream.u32() & 0x7fffffff
            stream.u32()
            yield {"type": "event", "event": "flipsummoning", "card": card_brief(code)}

        elif msg == MSG_FLIPSUMMONED:
            yield {"type": "event", "event": "flipsummoned"}

        elif msg == MSG_CHAINING:
            code = stream.u32() & 0x7fffffff
            stream.u32()
            stream.u8(); stream.u8(); stream.u8()
            desc = stream.u32()
            chain_size = stream.u8()
            yield {"type": "event", "event": "chaining", "card": card_brief(code),
                   "chain_link": chain_size, "desc": desc}

        elif msg == MSG_CHAINED:
            stream.u8()

        elif msg == MSG_CHAIN_SOLVING:
            n = stream.u8()
            yield {"type": "event", "event": "chain_solving", "chain_link": n}

        elif msg == MSG_CHAIN_SOLVED:
            stream.u8()

        elif msg == MSG_CHAIN_END:
            yield {"type": "event", "event": "chain_end"}
            yield {"type": "event", "event": "stats_update", "cards": query_live_stats(engine)}

        elif msg == MSG_CHAIN_NEGATED:
            n = stream.u8()
            yield {"type": "event", "event": "chain_negated", "chain_link": n}

        elif msg == MSG_CHAIN_DISABLED:
            n = stream.u8()
            yield {"type": "event", "event": "chain_disabled", "chain_link": n}

        elif msg == MSG_SHUFFLE_DECK:
            player = stream.u8()
            yield {"type": "event", "event": "shuffle_deck", "player": player}

        elif msg == MSG_SHUFFLE_HAND:
            player = stream.u8()
            count = stream.u8()
            for _ in range(count):
                stream.u32()
            yield {"type": "event", "event": "shuffle_hand", "player": player}

        elif msg == MSG_SHUFFLE_EXTRA:
            player = stream.u8()
            count = stream.u8()
            for _ in range(count):
                stream.u32()
            yield {"type": "event", "event": "shuffle_extra", "player": player}

        elif msg == MSG_SWAP_GRAVE_DECK:
            player = stream.u8()
            yield {"type": "event", "event": "swap_grave_deck", "player": player}

        elif msg == MSG_REVERSE_DECK:
            pass  # no payload; deck-facedown-state toggle, purely internal bookkeeping

        elif msg == MSG_DECK_TOP:
            stream.u8(); stream.u8(); stream.u32()

        elif msg == MSG_SHUFFLE_SET_CARD:
            loc = stream.u8()
            count = stream.u8()
            for _ in range(count):
                stream.u32()
            yield {"type": "event", "event": "shuffle_set_card"}

        elif msg == MSG_CARD_HINT:
            stream.u32(); stream.u8(); stream.u32()

        elif msg == MSG_POS_CHANGE:
            code = stream.u32() & 0x7fffffff
            stream.u8(); stream.u8(); stream.u8()
            prev_pos = stream.u8()
            cur_pos = stream.u8()
            yield {"type": "event", "event": "pos_change", "card": card_brief(code),
                   "prev_position": prev_pos, "position": cur_pos}

        elif msg == MSG_SET:
            code = stream.u32() & 0x7fffffff
            stream.u32()
            yield {"type": "event", "event": "set", "card": card_brief(code)}

        elif msg == MSG_SWAP:
            code1 = stream.u32() & 0x7fffffff
            stream.u32()
            code2 = stream.u32() & 0x7fffffff
            stream.u32()
            yield {"type": "event", "event": "swap", "card1": card_brief(code1), "card2": card_brief(code2)}

        elif msg == MSG_FIELD_DISABLED:
            stream.u32()

        elif msg == MSG_RANDOM_SELECTED:
            player = stream.u8()
            count = stream.u8()
            for _ in range(count):
                stream.u32()
            yield {"type": "event", "event": "random_selected", "player": player, "count": count}

        elif msg == MSG_BECOME_TARGET:
            count = stream.u8()
            for _ in range(count):
                stream.u32()

        elif msg == MSG_RECOVER:
            player = stream.u8()
            amount = stream.u32()
            yield {"type": "event", "event": "recover", "player": player, "amount": amount}

        elif msg == MSG_EQUIP:
            stream.u32(); stream.u32()

        elif msg == MSG_LPUPDATE:
            player = stream.u8()
            lp = stream.u32()
            yield {"type": "event", "event": "lp_update", "player": player, "lp": lp}

        elif msg == MSG_UNEQUIP:
            stream.u32(); stream.u32()

        elif msg == MSG_CARD_TARGET:
            stream.u32(); stream.u32()

        elif msg == MSG_CANCEL_TARGET:
            stream.u32(); stream.u32()

        elif msg == MSG_PAY_LPCOST:
            player = stream.u8()
            cost = stream.u32()
            yield {"type": "event", "event": "pay_lpcost", "player": player, "cost": cost}

        elif msg == MSG_ADD_COUNTER:
            countertype = stream.u16()
            stream.u8(); stream.u8(); stream.u8()
            count = stream.u16()
            yield {"type": "event", "event": "add_counter", "counter_type": countertype, "count": count}

        elif msg == MSG_REMOVE_COUNTER:
            countertype = stream.u16()
            stream.u8(); stream.u8(); stream.u8()
            count = stream.u16()
            yield {"type": "event", "event": "remove_counter", "counter_type": countertype, "count": count}

        elif msg == MSG_ATTACK:
            attacker = stream.u32()
            target = stream.u32()
            yield {"type": "event", "event": "attack", "attacker": describe_location(attacker),
                   "target": describe_location(target) if target else None}

        elif msg == MSG_BATTLE:
            stream.u32()
            a_atk = stream.u32()
            a_def = stream.u32()
            a_destroyed = stream.u8()
            d_info = stream.u32()
            d_atk = stream.u32()
            d_def = stream.u32()
            d_destroyed = stream.u8()
            if d_info:
                yield {"type": "event", "event": "battle", "attacker_atk": a_atk, "defender_atk": d_atk,
                       "defender_def": d_def, "attacker_destroyed": bool(a_destroyed),
                       "defender_destroyed": bool(d_destroyed)}

        elif msg == MSG_ATTACK_DISABLED:
            yield {"type": "event", "event": "attack_disabled"}

        elif msg == MSG_DAMAGE_STEP_START:
            pass

        elif msg == MSG_DAMAGE_STEP_END:
            pass

        elif msg == MSG_MISSED_EFFECT:
            stream.u32()
            code = stream.u32() & 0x7fffffff
            yield {"type": "event", "event": "missed_effect", "card": card_brief(code)}

        elif msg == MSG_MATCH_KILL:
            stream.u32()

        elif msg == MSG_DAMAGE:
            player = stream.u8()
            amount = stream.u32()
            yield {"type": "event", "event": "damage", "player": player, "amount": amount}

        elif msg == MSG_TOSS_COIN:
            player = stream.u8()
            count = stream.u8()
            results = [stream.u8() for _ in range(count)]
            yield {"type": "event", "event": "toss_coin", "player": player,
                   "results": ["heads" if r else "tails" for r in results]}

        elif msg == MSG_TOSS_DICE:
            player = stream.u8()
            count = stream.u8()
            results = [stream.u8() for _ in range(count)]
            yield {"type": "event", "event": "toss_dice", "player": player, "results": results}

        elif msg == MSG_HAND_RES:
            packed = stream.u8()
            hand0, hand1 = packed & 0x3, (packed >> 2) & 0x3
            names = {1: "rock", 2: "paper", 3: "scissors"}
            yield {"type": "event", "event": "hand_res",
                   "player": names.get(hand0), "opponent": names.get(hand1)}

        elif msg == MSG_AI_NAME:
            length = stream.u16()
            stream.raw(length)
            stream.u8()

        elif msg == MSG_SHOW_HINT:
            length = stream.u16()
            text = stream.raw(length).decode("utf-8", "ignore")
            stream.u8()
            yield {"type": "event", "event": "show_hint", "text": text}

        elif msg == MSG_PLAYER_HINT:
            stream.u8(); stream.u8(); stream.u32()

        elif msg == MSG_RELOAD_FIELD:
            # Full field resync -- only expected on tag-duel/spectator-style reconnects,
            # not in a normal solo puzzle session.
            yield {"type": "event", "event": "unsupported",
                   "message": "MSG_RELOAD_FIELD fired -- not expected in a solo puzzle session"}
            return

        elif msg == MSG_TAG_SWAP:
            player = stream.u8()
            main_count = stream.u8()
            extra_count = stream.u8()
            stream.u8()
            hand_count = stream.u8()
            stream.u32()
            for _ in range(hand_count):
                stream.u32()
            for _ in range(extra_count):
                stream.u32()
            yield {"type": "event", "event": "tag_swap", "player": player}

        elif msg == MSG_WIN:
            winner = stream.u8()
            reason = stream.u8()
            yield {"type": "event", "event": "win", "winner": winner, "reason": reason}
            return

        elif msg == MSG_CONFIRM_DECKTOP or msg == MSG_CONFIRM_EXTRATOP:
            player = stream.u8()
            count = stream.u8()
            items = read_zone_card_list(engine, count)
            label = "deck_top" if msg == MSG_CONFIRM_DECKTOP else "extra_deck_top"
            yield {"type": "event", "event": "confirm_cards", "which": label, "player": player,
                   "cards": [card_brief(c) for c, *_ in items]}

        elif msg == MSG_CONFIRM_CARDS:
            player = stream.u8()
            stream.u8()  # skip_panel
            count = stream.u8()
            items = read_zone_card_list(engine, count)
            yield {"type": "event", "event": "confirm_cards", "which": "cards", "player": player,
                   "cards": [card_brief(c) for c, *_ in items]}

        elif msg == MSG_SELECT_YESNO:
            player = stream.u8()
            desc = stream.u32()
            if player == 1:
                # opponent decision -- always decline for now (see project memory
                # on scripted opponent policy; a real per-puzzle policy can replace this)
                engine.send_i(0)
                pending = stream.u8()
                if pending == MSG_RETRY:
                    pending = None
            if pending is None and player == 1:
                def ask():
                    choice = yield from ask_yesno({"type": "prompt", "prompt": "yesno",
                                                    "player": player, "desc": desc,
                                                    "note": "auto-pass wasn't legal"})
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)
            elif player != 1:
                def ask():
                    choice = yield from ask_yesno({"type": "prompt", "prompt": "yesno",
                                                    "player": player, "desc": desc})
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_EFFECTYN:
            player = stream.u8()
            code = stream.u32()
            stream.u32()
            desc = stream.u32()
            if player == 1:
                engine.send_i(0)
                pending = stream.u8()
                if pending == MSG_RETRY:
                    pending = None
            if pending is None and player == 1:
                def ask():
                    choice = yield from ask_yesno({"type": "prompt", "prompt": "effectyn",
                                                    "player": player, "card": card_brief(code), "desc": desc,
                                                    "note": "auto-pass wasn't legal"})
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)
            elif player != 1:
                def ask():
                    choice = yield from ask_yesno({"type": "prompt", "prompt": "effectyn",
                                                    "player": player, "card": card_brief(code), "desc": desc})
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_OPTION:
            player = stream.u8()
            n = stream.u8()
            options = [stream.u32() for _ in range(n)]
            def ask():
                choice = yield from ask_index({"type": "prompt", "prompt": "option", "player": player,
                                                "options": options}, len(options))
                engine.send_i(choice)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_POSITION:
            player = stream.u8()
            code = stream.u32() & 0x7fffffff
            positions = stream.u8()
            pos_names = {0x1: "faceup_attack", 0x2: "facedown_attack",
                         0x4: "faceup_defense", 0x8: "facedown_defense"}
            avail = [p for p in (0x1, 0x2, 0x4, 0x8) if positions & p]
            def ask():
                idx = yield from ask_index({"type": "prompt", "prompt": "position", "player": player,
                                             "card": card_brief(code),
                                             "options": [pos_names[p] for p in avail]}, len(avail))
                engine.send_i(avail[idx])
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_IDLECMD:
            player = stream.u8()
            categories = []
            for cat_idx in range(5):  # summon, spsummon, repos, mset, sset
                n = stream.u8()
                items = []
                for _ in range(n):
                    code = stream.u32(); stream.u8(); stream.u8(); stream.u8()
                    items.append(code)
                categories.append(items)
            n_activate = stream.u8()
            activate_items = []
            for _ in range(n_activate):
                code = stream.u32() & 0x7fffffff
                stream.u8(); stream.u8(); stream.u8(); stream.u32()
                activate_items.append(code)
            categories.append(activate_items)
            to_bp = stream.u8()
            to_ep = stream.u8()
            can_shuffle = stream.u8()

            options = []
            for cat_i, label in enumerate(IDLE_ACTION_NAMES[:6]):
                for item_i, code in enumerate(categories[cat_i] if cat_i < 6 else []):
                    options.append({"category": cat_i, "index": item_i, "action": label,
                                     "card": card_brief(code)})
            if to_bp:
                options.append({"category": 6, "index": 0, "action": "battle_phase"})
            if to_ep:
                options.append({"category": 7, "index": 0, "action": "end_phase"})
            if can_shuffle:
                options.append({"category": 8, "index": 0, "action": "shuffle_hand"})

            def ask():
                choice = yield from ask_index({"type": "prompt", "prompt": "idlecmd", "player": player,
                                                "options": options}, len(options))
                opt = options[choice]
                value = (opt["category"] & 0xffff) | (opt["index"] << 16)
                engine.send_i(value)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_BATTLECMD:
            player = stream.u8()
            n_chain = stream.u8()
            chains = []
            for _ in range(n_chain):
                code = stream.u32() & 0x7fffffff
                stream.u8(); stream.u8(); stream.u8()
                desc = stream.u32()
                chains.append((code, desc))
            n_attack = stream.u8()
            attackers = []
            for _ in range(n_attack):
                code = stream.u32() & 0x7fffffff
                stream.u8(); stream.u8(); stream.u8()
                direct_ok = stream.u8()
                attackers.append((code, direct_ok))
            to_m2 = stream.u8()
            to_ep = stream.u8()

            options = []
            for i, (code, desc) in enumerate(chains):
                options.append({"category": 0, "index": i, "action": "activate",
                                 "card": card_brief(code), "desc": desc})
            for i, (code, direct_ok) in enumerate(attackers):
                options.append({"category": 1, "index": i, "action": "attack",
                                 "card": card_brief(code), "can_attack_directly": bool(direct_ok)})
            if to_m2:
                options.append({"category": 2, "index": 0, "action": "main_phase_2"})
            if to_ep:
                options.append({"category": 3, "index": 0, "action": "end_phase"})

            def ask():
                choice = yield from ask_index({"type": "prompt", "prompt": "battlecmd", "player": player,
                                                "options": options}, len(options))
                opt = options[choice]
                value = (opt["category"] & 0xffff) | (opt["index"] << 16)
                engine.send_i(value)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_CARD or msg == MSG_SELECT_TRIBUTE:
            player = stream.u8()
            cancelable = stream.u8()
            min_sel = stream.u8()
            max_sel = stream.u8()
            n = stream.u8()
            has_release_param = (msg == MSG_SELECT_TRIBUTE)
            items = []
            for _ in range(n):
                code = stream.u32()
                if has_release_param:
                    ctrl = stream.u8(); loc = stream.u8(); seq = stream.u8()
                    stream.u8()  # release_param (tribute weight)
                    loc_info = {"controller": ctrl, "location": LOCATION_NAMES.get(loc, hex(loc)),
                                "location_id": loc, "sequence": seq, "position": 0}
                else:
                    loc_info = describe_location(stream.u32())
                items.append((code, loc_info))

            def ask():
                chosen = yield from ask_indices({"type": "prompt",
                                                  "prompt": "tribute" if has_release_param else "card",
                                                  "player": player, "min": min_sel, "max": max_sel,
                                                  "items": [dict(card_brief(c), location=loc)
                                                            for c, loc in items]},
                                                 len(items), min_sel, max_sel)
                engine.send_b([len(chosen)] + chosen)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_CHAIN:
            player = stream.u8()
            count = stream.u8()
            stream.u8()   # spe_count, UI-only
            stream.u32()  # hint_timing (self)
            stream.u32()  # hint_timing (opponent)
            chains = []
            for _ in range(count):
                stream.u8()  # description type, UI-only
                forced = stream.u8()
                code = stream.u32() & 0x7fffffff
                stream.u32()
                desc = stream.u32()
                chains.append((forced, code, desc))
            any_forced = any(forced for forced, _, _ in chains)

            if not chains:
                # nothing available to activate -- don't bother asking, just pass
                engine.send_i(-1)
                pending = stream.u8()
                if pending == MSG_RETRY:
                    pending = None
            elif player == 1:
                # opponent decision -- for now always pass (see project memory on
                # scripted opponent policy); a forced chain must pick one, so
                # take the first forced option automatically.
                if any_forced:
                    choice = next(i for i, (forced, _, _) in enumerate(chains) if forced)
                else:
                    choice = -1
                engine.send_i(choice)
                pending = stream.u8()
                if pending == MSG_RETRY:
                    pending = None
            if pending is None and chains and player == 1:
                options = [{"card": card_brief(code), "desc": desc, "forced": bool(forced)}
                           for forced, code, desc in chains]
                def ask():
                    if any_forced:
                        choice = yield from ask_index(
                            {"type": "prompt", "prompt": "chain", "player": player,
                             "options": options, "can_pass": False,
                             "note": "auto-pass wasn't legal"}, len(chains))
                    else:
                        choice = yield from _ask_chain_or_pass(
                            dict(prompt="chain", player=player, options=options,
                                 note="auto-pass wasn't legal"))
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)
            elif chains and player != 1:
                options = [{"card": card_brief(code), "desc": desc, "forced": bool(forced)}
                           for forced, code, desc in chains]
                def ask():
                    if any_forced:
                        choice = yield from ask_index(
                            {"type": "prompt", "prompt": "chain", "player": player,
                             "options": options, "can_pass": False}, len(chains))
                    else:
                        choice = yield from _ask_chain_or_pass(
                            dict(prompt="chain", player=player, options=options))
                    engine.send_i(choice)
                pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_PLACE or msg == MSG_SELECT_DISFIELD:
            player = stream.u8()
            count = stream.u8()
            flag = stream.u32()
            count = count if count else 1
            options = decode_place_flag(flag, player)

            def ask():
                chosen = yield from ask_indices(
                    {"type": "prompt", "prompt": "place", "player": player, "count": count,
                     "options": [{"controller": p, "location_id": loc, "sequence": seq, "label": label}
                                 for p, loc, seq, label in options]},
                    len(options), count, count)
                out = []
                for idx in chosen:
                    p, loc, seq, _label = options[idx]
                    out += [p, loc, seq]
                engine.send_b(out)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_UNSELECT_CARD:
            player = stream.u8()
            finishable = stream.u8()
            cancelable = stream.u8()
            min_sel = stream.u8()
            max_sel = stream.u8()
            n_sel = stream.u8()
            select_items = []
            for _ in range(n_sel):
                code = stream.u32() & 0x7fffffff
                loc_info = describe_location(stream.u32())
                select_items.append((code, loc_info))
            n_unsel = stream.u8()
            unselect_items = []
            for _ in range(n_unsel):
                code = stream.u32() & 0x7fffffff
                loc_info = describe_location(stream.u32())
                unselect_items.append((code, loc_info))
            combined = select_items + unselect_items
            can_finish = bool(finishable or cancelable)

            def ask():
                payload = {"type": "prompt", "prompt": "select_unselect", "player": player,
                           "min": min_sel, "max": max_sel, "can_finish": can_finish,
                           "items": [dict(card_brief(c), location=loc, already_selected=i >= len(select_items))
                                     for i, (c, loc) in enumerate(combined)]}
                current = payload
                while True:
                    response = yield current
                    if can_finish and (response or {}).get("finish"):
                        # bvalue and ivalue share the same union in the engine's
                        # response struct, and MSG_SELECT_UNSELECT_CARD's finish
                        # check reads ivalue[0] == -1, so all 4 bytes of that
                        # first int32 need to be 0xff, not just a single byte.
                        engine.send_b([0xff, 0xff, 0xff, 0xff])
                        return
                    idx = (response or {}).get("choice")
                    if isinstance(idx, int) and 0 <= idx < len(combined):
                        engine.send_b([1, idx])
                        return
                    current = dict(payload, error="invalid choice")
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_SUM:
            mode = stream.u8()  # 0 = exact match required, 1 = "at least" mode
            player = stream.u8()
            acc = stream.u32()
            min_sel = stream.u8()
            max_sel = stream.u8()
            must_n = stream.u8()
            must_items = []
            for _ in range(must_n):
                code = stream.u32() & 0x7fffffff
                ctrl = stream.u8(); loc = stream.u8(); seq = stream.u8()
                sum_param = stream.u32()
                loc_info = {"controller": ctrl, "location": LOCATION_NAMES.get(loc, hex(loc)),
                            "location_id": loc, "sequence": seq, "position": 0}
                must_items.append((code, sum_param, loc_info))
            opt_n = stream.u8()
            opt_items = []
            for _ in range(opt_n):
                code = stream.u32() & 0x7fffffff
                ctrl = stream.u8(); loc = stream.u8(); seq = stream.u8()
                sum_param = stream.u32()
                loc_info = {"controller": ctrl, "location": LOCATION_NAMES.get(loc, hex(loc)),
                            "location_id": loc, "sequence": seq, "position": 0}
                opt_items.append((code, sum_param, loc_info))

            def ask():
                codes = [c for c, _, _ in opt_items]
                lo, hi = max(0, min_sel - must_n), max(0, max_sel - must_n)
                chosen = yield from ask_indices(
                    {"type": "prompt", "prompt": "sum", "player": player, "target": acc,
                     "must_include": [dict(card_brief(c), location=loc) for c, _, loc in must_items],
                     "options": [dict(card_brief(c), location=loc) for c, _, loc in opt_items]},
                    len(codes), lo, hi)
                engine.send_b([len(chosen) + must_n] + chosen)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SELECT_COUNTER:
            player = stream.u8()
            countertype = stream.u16()
            count = stream.u16()
            n = stream.u8()
            items = []
            for _ in range(n):
                code = stream.u32() & 0x7fffffff
                ctrl = stream.u8(); loc = stream.u8(); seq = stream.u8()
                cur_count = stream.u16()
                loc_info = {"controller": ctrl, "location": LOCATION_NAMES.get(loc, hex(loc)),
                            "location_id": loc, "sequence": seq, "position": 0}
                items.append((code, cur_count, loc_info))

            def ask():
                alloc = yield from ask_counter_alloc(
                    {"type": "prompt", "prompt": "counter", "player": player, "counter_type": countertype,
                     "total": count,
                     "items": [dict(card_brief(c), current=cur, location=loc) for c, cur, loc in items]},
                    items, count)
                out = []
                for a in alloc:
                    out += [a & 0xff, (a >> 8) & 0xff]
                engine.send_b(out)
            pending = yield from interact(engine, ask)

        elif msg == MSG_SORT_CARD:
            player = stream.u8()
            n = stream.u8()
            for _ in range(n):
                stream.u32(); stream.u8(); stream.u8(); stream.u8()
            # cosmetic reordering only -- always keep default order
            engine.send_i(0xff)
            pending = stream.u8()

        elif msg == MSG_ANNOUNCE_RACE:
            player = stream.u8()
            count = stream.u8()
            available = stream.u32()
            def ask():
                value = yield from ask_bitmask({"type": "prompt", "prompt": "announce_race", "player": player,
                                                 "count": count, "available": available})
                engine.send_i(value)
            pending = yield from interact(engine, ask)

        elif msg == MSG_ANNOUNCE_ATTRIB:
            player = stream.u8()
            count = stream.u8()
            available = stream.u32()
            def ask():
                value = yield from ask_bitmask({"type": "prompt", "prompt": "announce_attrib", "player": player,
                                                 "count": count, "available": available})
                engine.send_i(value)
            pending = yield from interact(engine, ask)

        elif msg == MSG_ANNOUNCE_CARD:
            player = stream.u8()
            n = stream.u8()
            for _ in range(n):
                stream.u32()  # opcode filter tree, not a simple enumerable option list
            def ask():
                name = yield from ask_text({"type": "prompt", "prompt": "announce_card", "player": player})
                card = get_card_by_name(name)
                engine.send_i(card["code"] if card else 0)
            pending = yield from interact(engine, ask)

        elif msg == MSG_ANNOUNCE_NUMBER:
            player = stream.u8()
            n = stream.u8()
            options = [stream.u32() for _ in range(n)]
            def ask():
                choice = yield from ask_index({"type": "prompt", "prompt": "announce_number",
                                                "player": player, "options": options}, len(options))
                engine.send_i(choice)
            pending = yield from interact(engine, ask)

        elif msg == MSG_ROCK_PAPER_SCISSORS:
            which_player = stream.u8()
            def ask():
                choice = yield from ask_index({"type": "prompt", "prompt": "rps", "player": which_player,
                                                "options": ["rock", "paper", "scissors"]}, 3)
                engine.send_i(choice)
            pending = yield from interact(engine, ask)

        else:
            yield {"type": "event", "event": "unhandled", "message_type": msg}
            return


def _ask_chain_or_pass(payload):
    options = payload["options"]
    payload = dict(payload, type="prompt", can_pass=True)
    current = payload
    while True:
        response = yield current
        if (response or {}).get("pass"):
            return -1
        choice = (response or {}).get("choice")
        if isinstance(choice, int) and 0 <= choice < len(options):
            return choice
        current = dict(payload, error="invalid choice")
