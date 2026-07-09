"""
Run this ONCE (or occasionally, e.g. monthly, to pick up new sets).
Pulls the full YGOPRODeck card database in a single request and builds a
local SQLite cache -- no repeated per-card API calls, ever, after this.

Usage:  python build_card_database.py
Output: cards.db  (SQLite)
"""
import json
import sqlite3
import urllib.request

from card_convert import convert_card

API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php"  # no params = full DB
DB_PATH = "cards.db"

def fetch_all_cards():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "ygo-puzzle-project"})
    print("Downloading full card database (this is one big request, may take a bit)...")
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("data", [])

def build_db(cards):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS cards")
    cur.execute("""
        CREATE TABLE cards (
            code INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            type INTEGER, level INTEGER, attribute INTEGER, race INTEGER,
            attack INTEGER, defense INTEGER, link_marker INTEGER
        )
    """)
    cur.execute("CREATE INDEX idx_name ON cards(name)")

    rows = []
    for card in cards:
        try:
            e = convert_card(card)
        except Exception as ex:
            print(f"  skipped {card.get('name', '?')}: {ex}")
            continue
        rows.append((e["code"], e["name"], e["type"], e["level"], e["attribute"],
                      e["race"], e["attack"], e["defense"], e["link_marker"]))

    cur.executemany(
        "INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?,?,?)", rows
    )
    conn.commit()
    conn.close()
    return len(rows)

def main():
    cards = fetch_all_cards()
    print(f"Fetched {len(cards)} cards from the API")
    n = build_db(cards)
    print(f"Wrote {n} cards to {DB_PATH}")

if __name__ == "__main__":
    main()
