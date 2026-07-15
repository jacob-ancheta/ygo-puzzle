"""
Thin async wrapper around Supabase's PostgREST API for leaderboard/profile
data. Uses the service-role key, which bypasses RLS entirely -- this module
is the only thing allowed to write puzzle_results/profiles, since the
record_win() Postgres function is only grantable to the service_role.
"""
import os

from http_client import client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def _headers():
    return {"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"}


async def record_win(user_id: str, puzzle_date: str) -> dict | None:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/record_win",
        headers=_headers(),
        json={"p_puzzle_date": puzzle_date, "p_user_id": user_id},
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


async def already_recorded(user_id: str, puzzle_date: str) -> bool:
    """Whether this signed-in user already has a puzzle_results row for this
    date -- checked before bumping the community completion counter so a
    retry (unlimited by design, see record_win) doesn't inflate the "you
    were the Nth" number shown to other players."""
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return False
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/puzzle_results",
        headers=_headers(),
        params={
            "puzzle_date": f"eq.{puzzle_date}",
            "user_id": f"eq.{user_id}",
            "select": "user_id",
            "limit": "1",
        },
    )
    resp.raise_for_status()
    return len(resp.json()) > 0


async def record_completion(puzzle_date: str) -> int | None:
    """Increments a simple per-day counter on every win, regardless of
    sign-in status -- deliberately separate from record_win/puzzle_results:
    there's no way to dedupe an anonymous player replaying the puzzle, so
    this number is only ever shown as a rough "X people have solved this"
    stat (and as a share-text fallback), never fed into the real,
    tamper-resistant leaderboard ranking."""
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/record_completion",
        headers=_headers(),
        json={"p_puzzle_date": puzzle_date},
    )
    resp.raise_for_status()
    return resp.json()


async def today_leaderboard(puzzle_date: str) -> list[dict]:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return []
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/puzzle_results",
        headers=_headers(),
        params={
            "puzzle_date": f"eq.{puzzle_date}",
            "rank": "not.is.null",
            "select": "rank,solved_at,profiles(display_name,first_count,second_count,third_count)",
            "order": "rank.asc",
        },
    )
    resp.raise_for_status()
    return resp.json()


async def get_profile(user_id: str) -> dict | None:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/profiles",
        headers=_headers(),
        params={"id": f"eq.{user_id}", "select": "display_name,first_count,second_count,third_count"},
    )
    resp.raise_for_status()
    rows = resp.json()
    return rows[0] if rows else None


async def display_name_taken(display_name: str, exclude_user_id: str | None = None) -> bool:
    """Whether some OTHER profile already has this display_name. Application-
    level only -- there's no unique constraint on profiles.display_name at
    the DB level (would need a migration run directly in Supabase), so this
    is a best-effort check, not a hard guarantee under true concurrent
    writes. Good enough for two humans clicking magic links at different
    times, which is the realistic case."""
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return False
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/profiles",
        headers=_headers(),
        params={"display_name": f"eq.{display_name}", "select": "id", "limit": "5"},
    )
    resp.raise_for_status()
    rows = resp.json()
    return any(row["id"] != exclude_user_id for row in rows)


async def set_display_name(user_id: str, display_name: str) -> None:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return
    resp = await client.patch(
        f"{SUPABASE_URL}/rest/v1/profiles",
        headers=_headers(),
        params={"id": f"eq.{user_id}"},
        json={"display_name": display_name},
    )
    resp.raise_for_status()


async def try_claim_token(token_hash: str, user_id: str) -> bool | None:
    """First-writer-wins single-use marker for win-claim tokens (see
    claim_token.py). Inserting the token's hash into claimed_tokens is the
    atomic "I got here first" -- the table's primary key on token_hash is
    what actually enforces one claim per token, not any check-then-act here.

    Returns True if this call (or a previous call by this SAME user --
    e.g. the magic link clicked twice) owns the claim, False if a DIFFERENT
    account already redeemed this token, and None if the check couldn't run
    at all (Supabase unconfigured, or the claimed_tokens table hasn't been
    created yet) -- the caller decides what None means; server.py currently
    fails open so the claim flow keeps working before the migration runs.

    Requires this one-time migration in the Supabase SQL editor:

        create table if not exists public.claimed_tokens (
          token_hash text primary key,
          user_id uuid not null,
          claimed_at timestamptz not null default now()
        );
        alter table public.claimed_tokens enable row level security;

    (RLS enabled with no policies: only the service-role key -- i.e. this
    module -- can touch it.)
    """
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/claimed_tokens",
        headers={**_headers(), "Prefer": "return=minimal"},
        json={"token_hash": token_hash, "user_id": user_id},
    )
    if resp.status_code == 201:
        return True
    if resp.status_code == 409:
        # Someone already claimed it -- idempotent success if that someone
        # was this very account (same person re-clicking their magic link).
        owner_resp = await client.get(
            f"{SUPABASE_URL}/rest/v1/claimed_tokens",
            headers=_headers(),
            params={"token_hash": f"eq.{token_hash}", "select": "user_id"},
        )
        owner_resp.raise_for_status()
        rows = owner_resp.json()
        return bool(rows) and rows[0]["user_id"] == user_id
    if resp.status_code == 404:
        # PostgREST's "relation does not exist" -- the migration above
        # hasn't been run yet.
        print("[try_claim_token] claimed_tokens table missing -- run the "
              "migration in leaderboard.try_claim_token's docstring; "
              "failing open (tokens NOT single-use until then)")
        return None
    resp.raise_for_status()
    return None


async def release_claim_token(token_hash: str) -> None:
    """Best-effort undo of try_claim_token, for when record_win fails after
    the token was already marked used -- without this, a transient Supabase
    hiccup would permanently burn a legitimate claim token."""
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return
    await client.delete(
        f"{SUPABASE_URL}/rest/v1/claimed_tokens",
        headers=_headers(),
        params={"token_hash": f"eq.{token_hash}"},
    )
