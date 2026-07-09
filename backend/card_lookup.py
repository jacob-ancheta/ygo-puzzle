"""
Quick local lookup against cards.db -- no network, instant.
Use this while authoring puzzles to find a card's code by name.

Usage:
    python card_lookup.py dharc
    python card_lookup.py "knightmare cerberus"
"""
import sqlite3
import sys

DB_PATH = "cards.db"

def search_cards(query, limit=15):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "SELECT code, name, attack, defense, level FROM cards WHERE name LIKE ? ORDER BY name LIMIT ?",
        (f"%{query}%", limit),
    )
    rows = cur.fetchall()
    conn.close()
    return rows

def get_card(code):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT * FROM cards WHERE code = ?", (code,))
    row = cur.fetchone()
    conn.close()
    if row is None:
        return None
    cols = ["code", "name", "type", "level", "attribute", "race", "attack", "defense", "link_marker"]
    return dict(zip(cols, row))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python card_lookup.py <search term>")
        sys.exit(1)
    query = " ".join(sys.argv[1:])
    for code, name, atk, deff, level in search_cards(query):
        print(f"{code:>10}  {name:<40} ATK {atk} / DEF {deff}  LV/RANK/LINK {level}")
