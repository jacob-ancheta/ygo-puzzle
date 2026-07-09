"""
Wordle-style daily puzzle rotation. Each backend/puzzles/YYYY-MM-DD.py file
defines one puzzle (a module-level PUZZLE dict, same shape as the old
puzzle_definition.py). "Today" is computed in US Eastern time so every
player sees the same puzzle change at the same midnight, regardless of
their own timezone.

Puzzle files are loaded via importlib.util rather than a normal package
import since "YYYY-MM-DD" isn't a valid Python identifier.
"""
import importlib.util
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

PUZZLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "puzzles")
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.py$")
ROTATION_TZ = ZoneInfo("America/New_York")

_cache = {}


def available_dates():
    """All puzzle dates that exist on disk, ascending."""
    dates = []
    for fname in os.listdir(PUZZLES_DIR):
        m = DATE_RE.match(fname)
        if m:
            dates.append(m.group(1))
    return sorted(dates)


def today_str():
    return datetime.now(ROTATION_TZ).date().isoformat()


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

    target = date_str or today_str()
    candidates = [d for d in dates if d <= target]
    chosen = candidates[-1] if candidates else dates[0]
    return chosen, load_puzzle(chosen)
