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

Only one image is stored per card: get_card_by_name() returns a single row,
so alternate arts (cards.db carries a dozen alias codes for e.g. Dark
Magician Girl) are never fetched -- the code cached here is the same one
duel_engine.card_brief() builds its /card_images/ URLs from, which is what
the app actually renders.

Usage:
    python cache_card_images.py              # every puzzle in puzzles/
    python cache_card_images.py 2026-07-09   # just that one puzzle
    python cache_card_images.py --prune      # + delete art no puzzle needs
    python cache_card_images.py --prune --dry-run
"""
import os
import re
import sys
import time
import urllib.error
import urllib.request

from card_lookup import get_card, get_card_by_name, search_cards

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
    names = [e["name"] for e in puzzle.get("opponent_field", [])]
    names += [m for e in puzzle.get("opponent_field", []) for m in e.get("materials", [])]
    names += puzzle.get("player_hand", []) + puzzle.get("player_deck", []) + puzzle.get("player_extra", [])
    names += [e["name"] for e in puzzle.get("player_field", [])]
    names += [m for e in puzzle.get("player_field", []) for m in e.get("materials", [])]
    names += puzzle.get("player_banished", [])
    names += puzzle.get("player_graveyard", [])
    names += [e["name"] if isinstance(e, dict) else e for e in puzzle.get("opponent_graveyard", [])]
    names += [e["name"] if isinstance(e, dict) else e for e in puzzle.get("opponent_hand", [])]
    names += [e["name"] for e in puzzle.get("player_spelltrap", [])]
    names += [e["name"] for e in puzzle.get("opponent_spelltrap", [])]
    names += puzzle.get("opponent_extra", [])
    names += puzzle.get("opponent_banished", [])
    names += puzzle.get("opponent_deck", [])
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


def cached_codes(variant):
    d = os.path.join(IMAGES_DIR, variant)
    if not os.path.isdir(d):
        return set()
    return {int(f[:-4]) for f in os.listdir(d) if f.endswith(".jpg") and f[:-4].isdigit()}


def prune(keep_codes, dry_run):
    """Delete cached art for cards no puzzle references any more -- leftovers
    from puzzles that were edited or dropped.

    Deliberately gated on having scanned EVERY puzzle (see main): pruning
    against one date would wipe the entire rest of the cache. Note this only
    sees cards a puzzle *seeds*; art for a card that only ever enters play
    mid-duel (a token an effect creates, say) has no name in the puzzle dict
    to match on, so it looks orphaned. Nothing does that today, but check the
    printed list before saying yes if that ever changes.
    """
    orphans = sorted(
        (variant, code)
        for variant in CDN_VARIANTS
        for code in cached_codes(variant) - keep_codes
    )
    if not orphans:
        print("\nNothing to prune -- no cached art is unused.")
        return

    names = sorted({(get_card(code) or {}).get("name", f"<code {code}>") for _, code in orphans})
    print(f"\n{len(orphans)} unused file(s) across {len(names)} card(s):")
    for name in names:
        print(f"  {name}")

    if dry_run:
        print("(--dry-run: nothing deleted)")
        return
    for variant, code in orphans:
        os.remove(os.path.join(IMAGES_DIR, variant, f"{code}.jpg"))
    print(f"Deleted {len(orphans)} file(s).")


def main():
    args = sys.argv[1:]
    do_prune = "--prune" in args
    dry_run = "--dry-run" in args
    dates = [a for a in args if not a.startswith("--")]

    all_puzzles = not dates
    if all_puzzles:
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

    if do_prune:
        if not all_puzzles:
            print("\nRefusing to prune: --prune needs every puzzle scanned, "
                  "but a specific date was given. Re-run without the date.")
            return
        prune(all_codes, dry_run)


if __name__ == "__main__":
    main()
