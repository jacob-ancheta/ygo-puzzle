"""
Thin async wrapper around Supabase's PostgREST API for leaderboard/profile
data. Uses the service-role key, which bypasses RLS entirely -- this module
is the only thing allowed to write puzzle_results/profiles, since the
record_win() Postgres function is only grantable to the service_role.
"""
import os

import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def _headers():
    return {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}


async def record_win(user_id: str, puzzle_date: str) -> dict | None:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/record_win",
            headers=_headers(),
            json={"p_puzzle_date": puzzle_date, "p_user_id": user_id},
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None


async def record_completion(puzzle_date: str) -> int | None:
    """Increments a simple per-day counter on every win, regardless of
    sign-in status -- deliberately separate from record_win/puzzle_results:
    there's no way to dedupe an anonymous player replaying the puzzle, so
    this number is only ever shown as a rough "X people have solved this"
    stat (and as a share-text fallback), never fed into the real,
    tamper-resistant leaderboard ranking."""
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/record_completion",
            headers=_headers(),
            json={"p_puzzle_date": puzzle_date},
        )
        resp.raise_for_status()
        return resp.json()


async def today_leaderboard(puzzle_date: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/puzzle_results",
            headers=_headers(),
            params={
                "puzzle_date": f"eq.{puzzle_date}",
                "rank": "not.is.null",
                "select": "rank,solved_at,profiles(display_name)",
                "order": "rank.asc",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def get_profile(user_id: str) -> dict | None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers=_headers(),
            params={"id": f"eq.{user_id}", "select": "display_name,first_count,second_count,third_count"},
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None
