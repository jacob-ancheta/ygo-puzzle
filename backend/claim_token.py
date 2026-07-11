"""
Signed, stateless tokens that let an anonymous winner retroactively claim
their leaderboard spot after signing in (see WinModal's "Sign In" button).

Without this, a bare "/claim-win?date=X" endpoint would let *any* signed-in
account claim a rank slot for any date, whether they solved that puzzle or
not. Instead, the server hands out one of these tokens only at the moment an
anonymous "win" event actually fires (see server.py), scoped to that puzzle
date and signed with a server-only secret -- the frontend stashes it in
localStorage across the magic-link redirect and posts it back to /claim-win,
which verifies the signature/expiry before calling record_win.

The puzzle_date embedded in the token (not any client-supplied field) is
what's actually recorded -- there is deliberately no separate "which date"
input to the claim endpoint for an attacker to mismatch against the token.
"""
import hashlib
import hmac
import os
import time

SECRET = os.environ.get("CLAIM_TOKEN_SECRET")
TTL_SECONDS = 48 * 60 * 60  # generous enough to check email overnight


def _sign(puzzle_date: str, expiry: int) -> str:
    msg = f"{puzzle_date}.{expiry}".encode()
    return hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()


def make_claim_token(puzzle_date: str) -> str | None:
    if not SECRET:
        return None
    expiry = int(time.time()) + TTL_SECONDS
    return f"{puzzle_date}.{expiry}.{_sign(puzzle_date, expiry)}"


def verify_claim_token(token: str) -> str | None:
    """Returns the puzzle_date the token is valid for, or None if the token
    is missing, malformed, expired, or fails signature verification."""
    if not SECRET or not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    puzzle_date, expiry_str, signature = parts
    try:
        expiry = int(expiry_str)
    except ValueError:
        return None
    if time.time() > expiry:
        return None
    if not hmac.compare_digest(signature, _sign(puzzle_date, expiry)):
        return None
    return puzzle_date
