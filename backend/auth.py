"""
Verifies Supabase-issued access tokens so server.py knows which (if any)
authenticated account owns a given /ws connection, without ever trusting a
client-asserted user id directly.

Verification is done by asking Supabase's own Auth API (GET /auth/v1/user)
rather than decoding the JWT locally: Supabase projects can sign tokens with
either the legacy shared HS256 secret or the newer asymmetric JWT Signing
Keys, and asking Supabase directly works correctly either way instead of
guessing which scheme a given project uses.

Play must stay possible fully anonymously -- a missing or invalid token means
"anonymous", never an error, so this never raises.
"""
import os

import httpx

from http_client import client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


async def verify_supabase_jwt(token: str | None) -> str | None:
    """Returns the Supabase user id if `token` is a valid, unexpired
    Supabase-issued access token; None otherwise."""
    if not token or not SUPABASE_URL or not SERVICE_ROLE_KEY:
        return None
    try:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SERVICE_ROLE_KEY},
        )
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.json().get("id")
