"""
Run this ONCE (or occasionally, e.g. monthly, to pick up new sets).
Builds cards.db from the official ygopro card database (mycard/ygopro-database),
which is the same cards.cdb format ygopro-core/ygopro-scripts are built against.
Unlike the old YGOPRODeck-API pipeline, the raw type/attribute/race/setcode
values here are already the exact bitmasks the engine expects -- no guessing
from human-readable strings required.

Usage:  python build_card_database.py
Output: cards.db  (SQLite)
"""
import os
import sqlite3
import tempfile
import urllib.request

CDB_URL = "https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/en-US/cards.cdb"
DB_PATH = "cards.db"

TYPE_LINK = 0x4000000
TYPE_PENDULUM = 0x1000000

def fetch_official_cdb():
    print("Downloading official card database (cards.cdb)...")
    req = urllib.request.Request(CDB_URL, headers={"User-Agent": "ygo-puzzle-project"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    fd, path = tempfile.mkstemp(suffix=".cdb")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return path

def decode_row(row):
    """row = (id, alias, setcode, type, atk, raw_def, raw_level, race, attribute)"""
    code, alias, setcode, type_, atk, raw_def, raw_level, race, attribute = row

    if type_ & TYPE_LINK:
        link_marker = raw_def
        defense = 0
        level = raw_level & 0xff
    else:
        link_marker = 0
        defense = raw_def
        level = raw_level & 0xff

    if type_ & TYPE_PENDULUM:
        lscale = (raw_level >> 24) & 0xff
        rscale = (raw_level >> 16) & 0xff
    else:
        lscale = 0
        rscale = 0

    return {
        "code": code, "type": type_, "level": level, "attribute": attribute,
        "race": race, "attack": atk, "defense": defense, "link_marker": link_marker,
        "setcode": setcode, "alias": alias, "lscale": lscale, "rscale": rscale,
    }

def build_db(cdb_path):
    src = sqlite3.connect(cdb_path)
    src_cur = src.cursor()
    src_cur.execute("""
        SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.name
        FROM datas d JOIN texts t ON d.id = t.id
    """)
    rows = src_cur.fetchall()
    src.close()

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS cards")
    cur.execute("""
        CREATE TABLE cards (
            code INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            type INTEGER, level INTEGER, attribute INTEGER, race INTEGER,
            attack INTEGER, defense INTEGER, link_marker INTEGER,
            setcode INTEGER, alias INTEGER, lscale INTEGER, rscale INTEGER
        )
    """)
    cur.execute("CREATE INDEX idx_name ON cards(name)")

    out_rows = []
    for *data_cols, name in rows:
        e = decode_row(tuple(data_cols))
        out_rows.append((
            e["code"], name, e["type"], e["level"], e["attribute"], e["race"],
            e["attack"], e["defense"], e["link_marker"], e["setcode"], e["alias"],
            e["lscale"], e["rscale"],
        ))

    cur.executemany(
        "INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", out_rows
    )
    conn.commit()
    conn.close()
    return len(out_rows)

def main():
    cdb_path = fetch_official_cdb()
    try:
        n = build_db(cdb_path)
        print(f"Wrote {n} cards to {DB_PATH}")
    finally:
        os.remove(cdb_path)

if __name__ == "__main__":
    main()
