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

def search_cards(query, limit=15):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "SELECT code, name, type, attack, defense, level FROM cards WHERE name LIKE ? ORDER BY name LIMIT ?",
        (f"%{query}%", limit),
    )
    rows = cur.fetchall()
    conn.close()
    return rows

CARD_COLS = ["code", "name", "type", "level", "attribute", "race", "attack", "defense",
             "link_marker", "setcode", "alias", "lscale", "rscale", "desc"]

def get_card_by_name(name):
    """Exact-match lookup for puzzle authoring. Returns None if no exact match
    (caller should fall back to search_cards() to show close matches)."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT * FROM cards WHERE name = ?", (name,))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return None
    return dict(zip(CARD_COLS, row))

def get_card(code):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT * FROM cards WHERE code = ?", (code,))
    row = cur.fetchone()
    conn.close()
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
