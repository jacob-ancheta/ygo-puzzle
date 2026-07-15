"""
Pre-download card art so the app never makes an image API call during real
play (no runtime dependency, no rate-limit/timeout risk for players).

Images are cached by card CODE, shared across every puzzle -- once a card's
art is on disk it's never re-downloaded, so running this after adding a new
day's puzzle only fetches whatever's actually new.

Two variants are cached per card, from YGOPRODeck's public CDN (the same
official card IDs already used by cards.db, so no name-matching needed):
  - full/{code}.jpg     the whole card, for a description popup
  - cropped/{code}.jpg  art-only crop, for small board tiles

Usage:
    python cache_card_images.py              # every puzzle in puzzles/
    python cache_card_images.py 2026-07-09   # just that one puzzle
"""
import os
import re
import sys
import time
import urllib.error
import urllib.request

from card_lookup import get_card_by_name, search_cards

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PUZZLES_DIR = os.path.join(BACKEND_DIR, "puzzles")
IMAGES_DIR = os.path.join(BACKEND_DIR, "card_images")
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.py$")

CDN_VARIANTS = {
    "full": "https://images.ygoprodeck.com/images/cards/{code}.jpg",
    "cropped": "https://images.ygoprodeck.com/images/cards_cropped/{code}.jpg",
}


def load_puzzle_dict(date_str):
    path = os.path.join(PUZZLES_DIR, f"{date_str}.py")
    namespace = {}
    with open(path, "r", encoding="utf-8") as f:
        exec(compile(f.read(), path, "exec"), namespace)
    return namespace["PUZZLE"]


def puzzle_card_names(puzzle):
    # Must mirror duel_engine.resolve_all()'s key coverage -- any zone a
    # puzzle can seed a card into needs that card's art cached (this lagged
    # behind once before: player_field cards silently rendered with no
    # image because this list predated the newer optional keys).
    names = [e["name"] for e in puzzle["opponent_field"]]
    names += puzzle["player_hand"] + puzzle["player_deck"] + puzzle["player_extra"]
    names += [e["name"] for e in puzzle.get("player_field", [])]
    names += puzzle.get("player_banished", [])
    names += puzzle.get("opponent_graveyard", [])
    names += [e["name"] if isinstance(e, dict) else e for e in puzzle.get("opponent_hand", [])]
    names += [e["name"] for e in puzzle.get("player_spelltrap", [])]
    names += [e["name"] for e in puzzle.get("opponent_spelltrap", [])]
    return names


def resolve_codes(names):
    codes, failed = set(), []
    for name in names:
        card = get_card_by_name(name)
        if card is None:
            failed.append(name)
        else:
            codes.add(card["code"])
    if failed:
        print(f"WARNING: {len(failed)} card name(s) didn't resolve (skipping their images):")
        for name in failed:
            matches = ", ".join(cname for _, cname, *_ in search_cards(name, limit=3))
            print(f"  '{name}' -- close matches: {matches}")
    return codes


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "ygo-puzzle-project"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()
    with open(dest, "wb") as f:
        f.write(data)


def cache_images_for(codes):
    for variant in CDN_VARIANTS:
        os.makedirs(os.path.join(IMAGES_DIR, variant), exist_ok=True)

    cached, skipped, failed = 0, 0, 0
    for code in sorted(codes):
        for variant, url_template in CDN_VARIANTS.items():
            dest = os.path.join(IMAGES_DIR, variant, f"{code}.jpg")
            if os.path.exists(dest):
                skipped += 1
                continue
            try:
                download(url_template.format(code=code), dest)
                cached += 1
                time.sleep(0.1)  # be polite to the CDN
            except urllib.error.HTTPError as e:
                print(f"  {variant}/{code}.jpg -- HTTP {e.code}")
                failed += 1
            except urllib.error.URLError as e:
                print(f"  {variant}/{code}.jpg -- {e.reason}")
                failed += 1
    return cached, skipped, failed


def main():
    if len(sys.argv) > 1:
        dates = [sys.argv[1]]
    else:
        dates = sorted(
            m.group(1) for fname in os.listdir(PUZZLES_DIR)
            for m in [DATE_RE.match(fname)] if m
        )

    all_codes = set()
    for date_str in dates:
        puzzle = load_puzzle_dict(date_str)
        codes = resolve_codes(puzzle_card_names(puzzle))
        print(f"{date_str}: {len(codes)} unique card(s)")
        all_codes |= codes

    print(f"\nCaching images for {len(all_codes)} unique card(s) total...")
    cached, skipped, failed = cache_images_for(all_codes)
    print(f"Done. {cached} downloaded, {skipped} already cached, {failed} failed.")


if __name__ == "__main__":
    main()
