"""
Wordle-style daily puzzle rotation. Each backend/puzzles/YYYY-MM-DD.py file
defines one puzzle (a module-level PUZZLE dict, same shape as the old
puzzle_definition.py). "Today" is computed in US Eastern time so every
player sees the same puzzle change at the same moment, regardless of their
own timezone.

Puzzle files are loaded via importlib.util rather than a normal package
import since "YYYY-MM-DD" isn't a valid Python identifier.
"""
import importlib.util
import os
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PUZZLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "puzzles")
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.py$")
ROTATION_TZ = ZoneInfo("America/New_York")
# Puzzles rotate at 4pm Eastern rather than midnight -- see resetTime.ts's
# identical ROTATION_HOUR on the frontend, which this must stay in sync
# with (both the cosmetic countdown and the client's actual
# auto-reconnect-at-rotation timer key off it there).  A file dated D is
# "today's" from D 16:00 through (D+1) 16:00 -- i.e. before 16:00, today's
# puzzle-day is still yesterday's calendar date.
ROTATION_HOUR = 16

_cache = {}


def available_dates():
    """All puzzle dates that exist on disk, ascending -- INCLUDING dates in
    the future (puzzles authored ahead of time). Internal use only; anything
    exposed to clients must use public_dates() instead, or pre-authored
    puzzles leak before their day arrives."""
    dates = []
    for fname in os.listdir(PUZZLES_DIR):
        m = DATE_RE.match(fname)
        if m:
            dates.append(m.group(1))
    return sorted(dates)


def public_dates():
    """available_dates() minus anything dated after today (Eastern) -- the
    only date list that's safe to send to a client."""
    today = today_str()
    return [d for d in available_dates() if d <= today]


def today_str():
    now = datetime.now(ROTATION_TZ)
    if now.hour < ROTATION_HOUR:
        now -= timedelta(days=1)
    return now.date().isoformat()


def load_puzzle(date_str):
    """Load (and cache) the PUZZLE dict from puzzles/{date_str}.py."""
    if date_str in _cache:
        return _cache[date_str]

    path = os.path.join(PUZZLES_DIR, f"{date_str}.py")
    if not os.path.exists(path):
        raise FileNotFoundError(f"no puzzle file for {date_str}")

    module_name = f"_puzzle_{date_str.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _cache[date_str] = module.PUZZLE
    return module.PUZZLE


def resolve_puzzle_for(date_str=None):
    """Returns (resolved_date_str, puzzle_dict).

    With no date_str, serves today's (Eastern) puzzle. If no file exists for
    the requested/current date yet (e.g. you haven't authored tomorrow's
    puzzle), falls back to the most recent date on or before it, so the app
    never hard-fails just because "today" hasn't been written yet.
    """
    dates = available_dates()
    if not dates:
        raise RuntimeError(f"no puzzle files found in {PUZZLES_DIR}")

    today = today_str()
    target = date_str or today
    # Never serve past "today", whatever the client asked for -- puzzles are
    # authored ahead of time, so without this clamp `?date=9999-12-31` (or
    # just tomorrow's date, which /puzzles used to happily advertise) would
    # hand out an unreleased puzzle early.
    if target > today:
        target = today
    candidates = [d for d in dates if d <= target]
    # The bare dates[0] fallback only triggers when NOTHING on disk is dated
    # today-or-earlier -- i.e. every puzzle file is future-dated. That's a
    # misconfigured deploy (there's no legitimate way to run a daily-puzzle
    # site with no current puzzle), and serving the earliest future puzzle
    # beats hard-failing every connection while it's fixed.
    chosen = candidates[-1] if candidates else dates[0]
    return chosen, load_puzzle(chosen)
