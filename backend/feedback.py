"""
Sends bug-report / puzzle-suggestion submissions straight to the
developer's inbox via Resend's HTTP API. Deliberately no database table --
Supabase already owns accounts/leaderboard data, and free-text user
submissions don't need a persistent store when a transactional email is
simpler and Resend is already the project's mail provider (magic-link
delivery).
"""
import os

import httpx

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
# Must be an address on a domain verified in the Resend dashboard --
# duelpuzzdle.xyz per the project's setup.
FEEDBACK_FROM_EMAIL = os.environ.get("FEEDBACK_FROM_EMAIL", "feedback@duelpuzzdle.xyz")
FEEDBACK_TO_EMAIL = os.environ.get("FEEDBACK_TO_EMAIL")


async def send_feedback_email(kind: str, message: str, contact_email: str | None) -> bool:
    """Returns whether the email actually sent -- False (not raised) if
    Resend isn't configured yet, matching this codebase's convention
    elsewhere of a missing-config feature quietly no-opping rather than
    breaking the request."""
    if not RESEND_API_KEY or not FEEDBACK_TO_EMAIL:
        return False
    subject = f"[Duel Puzzdle] {'Bug report' if kind == 'bug' else 'Puzzle suggestion'}"
    body = message if not contact_email else f"{message}\n\n-- reply to: {contact_email}"
    payload = {
        "from": FEEDBACK_FROM_EMAIL,
        "to": [FEEDBACK_TO_EMAIL],
        "subject": subject,
        "text": body,
    }
    if contact_email:
        payload["reply_to"] = contact_email
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
        )
        resp.raise_for_status()
    return True
