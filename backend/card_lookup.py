"""
Quick local lookup against cards.db -- no network, instant.
Use this while authoring puzzles to find a card's code by name.

Usage:
    python card_lookup.py dharc
    python card_lookup.py "knightmare cerberus"
"""
import os
import sqlite3
import sys

from card_convert import decode_type

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cards.db")

# A single, lazily-opened, reused connection rather than one per call. This
# module sits on the hottest path in the app: card_reader_impl (a ctypes
# callback the engine invokes for card data, potentially many times per
# duel) and card_brief() (called for essentially every event -- draws,
# moves, chaining, summons...) both route through get_card()/get_card_by_name.
# Opening+closing a fresh sqlite3 connection -- file open, journal/WAL
# setup, close -- on every single one of those calls is wasted work that
# directly extends how long each duel occupies server.py's single-worker
# ENGINE_EXECUTOR thread (every engine call for every user funnels through
# that one thread), so the cost here doesn't just waste CPU, it adds
# straight to the queue every other concurrent user is waiting behind.
#
# Left at the default check_same_thread=True deliberately: every caller
# that matters for the running server (card_reader_impl, card_brief(), and
# resolve_all() at duel setup) executes on that same single executor
# thread, consistently, for the process's lifetime, so a connection reused
# by exactly one thread is exactly what SQLite expects. If ENGINE_EXECUTOR
# ever grows beyond one worker, this needs a connection-per-thread (or a
# lock) -- check_same_thread's default gives a loud, immediate
# sqlite3.ProgrammingError if that invariant is ever broken without this
# module being updated to match, instead of silently risking corruption.
_conn = None


def _connection():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH)
    return _conn


def search_cards(query, limit=15):
    cur = _connection().cursor()
    cur.execute(
        "SELECT code, name, type, attack, defense, level FROM cards WHERE name LIKE ? ORDER BY name LIMIT ?",
        (f"%{query}%", limit),
    )
    return cur.fetchall()

CARD_COLS = ["code", "name", "type", "level", "attribute", "race", "attack", "defense",
             "link_marker", "setcode", "alias", "lscale", "rscale", "desc"]

def get_card_by_name(name):
    """Exact-match lookup for puzzle authoring. Returns None if no exact match
    (caller should fall back to search_cards() to show close matches)."""
    cur = _connection().cursor()
    cur.execute("SELECT * FROM cards WHERE name = ?", (name,))
    row = cur.fetchone()
    if row is None:
        return None
    return dict(zip(CARD_COLS, row))

def get_card(code):
    cur = _connection().cursor()
    cur.execute("SELECT * FROM cards WHERE code = ?", (code,))
    row = cur.fetchone()
    if row is None:
        return None
    return dict(zip(CARD_COLS, row))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python card_lookup.py <search term>")
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    for code, name, type_int, atk, deff, level in search_cards(query):
        label = decode_type(type_int)
        if type_int & 0x1:  # TYPE_MONSTER
            stats = f"ATK {atk} / DEF {deff}  LV/RANK/LINK {level}"
        else:
            stats = ""
        print(f"{code:>10}  {name:<42} {label:<22} {stats}")
