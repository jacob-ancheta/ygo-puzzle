"""
FastAPI WebSocket wrapper around duel_engine. One DuelEngine per connection:
connect to /ws (optionally ?date=YYYY-MM-DD for an archived puzzle, defaults
to today's) and you get a fresh attempt at that day's puzzle. The engine's
generator (`duel_engine.run`) is driven here -- events are pushed to the
client immediately, prompts are pushed and then the driver waits for the
client's JSON response before resuming the generator.

All calls into the ctypes engine are routed through a single dedicated
background thread (ENGINE_EXECUTOR) rather than run directly in the async
handler or on the default (multi-worker) executor:
  - Running them inline would block the whole asyncio event loop -- every
    other connected user -- for the duration of each engine call.
  - ygopro-core's thread-safety under truly concurrent (simultaneous) calls
    from multiple threads is unverified, so a multi-worker pool is a real
    risk of corrupting engine state; a single worker serializes all engine
    access while still keeping the event loop free to service everyone
    else's WebSocket I/O in the meantime.
"""
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import FastAPI, Header, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from websockets.exceptions import WebSocketException

import claim_token
import feedback
import leaderboard
import puzzle_registry
from auth import verify_supabase_jwt
from duel_engine import DuelEngine, DuelEnded, PuzzleLoadError, run, initial_board_state

app = FastAPI()

# Frontend is deployed separately (Vercel) from this backend (Render), so
# browser fetch() calls to /puzzles and / are cross-origin and need explicit
# CORS. Comma-separated so the Render env var can list both the production
# Vercel domain and any preview-deploy domains; local Vite dev origin is
# always allowed since it costs nothing and never applies in production.
_default_origins = "http://localhost:5173,http://127.0.0.1:5173"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

ENGINE_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ygo-engine")

CARD_IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_images")
os.makedirs(os.path.join(CARD_IMAGES_DIR, "full"), exist_ok=True)
os.makedirs(os.path.join(CARD_IMAGES_DIR, "cropped"), exist_ok=True)
app.mount("/card_images", StaticFiles(directory=CARD_IMAGES_DIR), name="card_images")


async def run_blocking(func, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(ENGINE_EXECUTOR, func, *args)


@app.get("/")
def health():
    return {"status": "ok", "today": puzzle_registry.today_str(),
            "available_dates": puzzle_registry.available_dates()}


@app.get("/puzzles")
def list_puzzles():
    return {"today": puzzle_registry.today_str(), "dates": puzzle_registry.available_dates()}


@app.get("/notice")
def notice():
    # A manual, low-tech escape hatch for "heads up, we're under heavier
    # load than expected" -- e.g. a rush of players right at the daily
    # puzzle reset. Deliberately just an env var rather than a live-editable
    # config store: this is a rare fallback, not something that needs
    # instant toggling, so a ~1-2 min Render redeploy to pick up a change is
    # an acceptable tradeoff for not adding a whole config system for it.
    return {"message": os.environ.get("SITE_NOTICE") or None}


@app.get("/leaderboard/today")
async def leaderboard_today(date: str | None = None):
    resolved_date, _ = puzzle_registry.resolve_puzzle_for(date)
    rows = await leaderboard.today_leaderboard(resolved_date)
    return {"puzzle_date": resolved_date, "results": rows}


@app.get("/profile/me")
async def profile_me(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    user_id = await verify_supabase_jwt(token)
    if user_id is None:
        return JSONResponse({"error": "not signed in"}, status_code=401)
    profile = await leaderboard.get_profile(user_id)
    return profile or {"error": "profile not found"}


MAX_USERNAME_LENGTH = 20


@app.get("/username-available")
async def username_available(name: str = ""):
    name = name.strip()
    if not name or len(name) > MAX_USERNAME_LENGTH:
        return {"available": False}
    try:
        taken = await leaderboard.display_name_taken(name)
    except Exception as e:
        print(f"[username_available] check failed for name={name!r}: {e!r}")
        return {"available": False}
    return {"available": not taken}


class ClaimUsernameRequest(BaseModel):
    username: str


@app.post("/claim-username")
async def claim_username(body: ClaimUsernameRequest, authorization: str = Header(default="")):
    """Sets the caller's own display_name -- called once they've actually
    signed in (see SignInForm's flow), so a username is only ever reserved
    once someone has clicked their magic link, not merely by typing it into
    the form. Best-effort uniqueness (see display_name_taken's docstring for
    why this isn't a hard DB-level guarantee)."""
    access_token = authorization.removeprefix("Bearer ").strip()
    user_id = await verify_supabase_jwt(access_token)
    if user_id is None:
        return JSONResponse({"error": "not signed in"}, status_code=401)
    username = body.username.strip()
    if not username or len(username) > MAX_USERNAME_LENGTH:
        return JSONResponse(
            {"error": f"username must be non-empty and under {MAX_USERNAME_LENGTH} characters"},
            status_code=400,
        )
    try:
        taken = await leaderboard.display_name_taken(username, exclude_user_id=user_id)
        if taken:
            return JSONResponse({"error": "that username is already taken"}, status_code=409)
        await leaderboard.set_display_name(user_id, username)
    except Exception as e:
        print(f"[claim_username] failed for user_id={user_id!r} username={username!r}: {e!r}")
        return JSONResponse({"error": "couldn't save that username -- try again in a bit"}, status_code=502)
    return {"ok": True, "display_name": username}


class ClaimWinRequest(BaseModel):
    token: str


@app.post("/claim-win")
async def claim_win(body: ClaimWinRequest, authorization: str = Header(default="")):
    """Lets a player who won anonymously and *then* signed in retroactively
    claim their leaderboard spot, without replaying the puzzle -- see
    WinModal's "Sign In" button and claim_token.py for why this needs a
    signed token rather than trusting a client-supplied date."""
    access_token = authorization.removeprefix("Bearer ").strip()
    user_id = await verify_supabase_jwt(access_token)
    if user_id is None:
        return JSONResponse({"error": "not signed in"}, status_code=401)
    puzzle_date = claim_token.verify_claim_token(body.token)
    if puzzle_date is None:
        return JSONResponse({"error": "invalid or expired claim"}, status_code=400)
    result = await leaderboard.record_win(user_id, puzzle_date)
    return {
        "leaderboard": (
            {"rank": result["assigned_rank"], "overall_position": result["overall_position"]}
            if result else None
        ),
    }


class FeedbackRequest(BaseModel):
    kind: Literal["bug", "suggestion"]
    message: str
    contact_email: str | None = None


MAX_FEEDBACK_LENGTH = 4000
MAX_EMAIL_LENGTH = 254


@app.post("/feedback")
async def submit_feedback(body: FeedbackRequest):
    message = body.message.strip()
    if not message or len(message) > MAX_FEEDBACK_LENGTH:
        return JSONResponse(
            {"error": f"message must be non-empty and under {MAX_FEEDBACK_LENGTH} characters"},
            status_code=400,
        )
    contact_email = body.contact_email.strip() if body.contact_email else None
    if contact_email and len(contact_email) > MAX_EMAIL_LENGTH:
        return JSONResponse({"error": f"email must be under {MAX_EMAIL_LENGTH} characters"}, status_code=400)
    try:
        sent = await feedback.send_feedback_email(body.kind, message, contact_email)
    except Exception as e:
        # Logged, not raised as a bare 500: a Resend rejection (bad key,
        # unverified from-domain, etc.) needs to be diagnosable from
        # Render's logs, and the player still deserves a real error instead
        # of an opaque "Internal Server Error" with no detail at all.
        print(f"[feedback] send_feedback_email failed: {e!r}")
        return JSONResponse({"error": "couldn't send that -- try again in a bit"}, status_code=502)
    if not sent:
        # Not configured yet (missing RESEND_API_KEY/FEEDBACK_TO_EMAIL) --
        # a real 5xx rather than pretending it worked, so the frontend can
        # tell the player their message didn't actually go anywhere.
        return JSONResponse({"error": "feedback isn't set up on the server yet"}, status_code=503)
    return {"ok": True}


@app.websocket("/ws")
async def duel_socket(websocket: WebSocket):
    await websocket.accept()
    date_param = websocket.query_params.get("date")
    token_param = websocket.query_params.get("token")
    user_id = await verify_supabase_jwt(token_param)

    try:
        resolved_date, puzzle = puzzle_registry.resolve_puzzle_for(date_param)
    except RuntimeError as e:
        await websocket.send_json({"type": "error", "message": str(e)})
        await websocket.close()
        return

    try:
        engine = await run_blocking(DuelEngine, puzzle)
    except PuzzleLoadError as e:
        await websocket.send_json({"type": "error", "message": str(e), "suggestions": e.suggestions})
        await websocket.close()
        return

    try:
        await websocket.send_json({"type": "event", "event": "puzzle_loaded",
                                    "date": resolved_date, "win_condition": puzzle["win_condition"]})
        # Routed through run_blocking like every other engine-adjacent call:
        # it doesn't touch the ctypes pduel handle, but it does call into
        # card_lookup.py (via card_brief()), which now reuses a single
        # sqlite3 connection across calls -- and that connection is only
        # ever safe to use from the one thread that created it (see
        # card_lookup.py). Calling this directly on the event-loop thread
        # instead of the engine executor thread was a real bug, caught live:
        # sqlite3.ProgrammingError, "created in thread X, used in thread Y".
        await websocket.send_json(await run_blocking(initial_board_state, engine))

        gen = run(engine)
        response = None
        while True:
            try:
                item = await run_blocking(gen.send, response)
            except DuelEnded:
                await websocket.send_json({"type": "event", "event": "duel_ended",
                                            "message": "no more messages from the engine"})
                break
            except RuntimeError as e:
                # gen.send is called through run_in_executor, which can't carry a
                # bare StopIteration back across the executor boundary -- it
                # rewraps generator exhaustion as this RuntimeError instead (see
                # concurrent.futures.thread). Only swallow that specific case;
                # any other RuntimeError is a real bug and should still surface.
                if not isinstance(e.__cause__, StopIteration):
                    raise
                await websocket.send_json({"type": "event", "event": "duel_ended",
                                            "message": "no more messages from the engine"})
                break

            if item.get("type") == "event" and item.get("event") == "win" and item.get("winner") == 0:
                # Community count: every DISTINCT solver counts once. Retries
                # are unlimited by design (see record_win), so a signed-in
                # player replaying after already winning must not bump this
                # again -- checked via already_recorded before incrementing.
                # Anonymous wins still can't be deduped (no stable identity)
                # and always increment, same as before.
                is_repeat_signed_in_win = False
                if user_id is not None:
                    try:
                        is_repeat_signed_in_win = await leaderboard.already_recorded(user_id, resolved_date)
                    except Exception as e:
                        print(f"[duel_socket] already_recorded check failed for user_id={user_id!r} date={resolved_date!r}: {e!r}")

                community_position = None
                if not is_repeat_signed_in_win:
                    try:
                        community_position = await leaderboard.record_completion(resolved_date)
                    except Exception as e:
                        print(f"[duel_socket] record_completion failed for date={resolved_date!r}: {e!r}")
                item["community_position"] = community_position

                # The real, tamper-resistant leaderboard -- only for
                # signed-in connections.
                result = None
                if user_id is not None:
                    try:
                        result = await leaderboard.record_win(user_id, resolved_date)
                    except Exception as e:
                        # Logged, not raised: a Supabase hiccup must never break
                        # the player's duel, but a silently swallowed failure
                        # here was previously undiagnosable from Render's logs.
                        print(f"[duel_socket] record_win failed for user_id={user_id!r} date={resolved_date!r}: {e!r}")
                # Always an explicit key (null on failure/anonymous), never
                # omitted -- gives the frontend one consistent shape to check
                # instead of having to distinguish "key missing" from "no data".
                item["leaderboard"] = (
                    {"rank": result["assigned_rank"], "overall_position": result["overall_position"]}
                    if result else None
                )
                # Lets an anonymous winner claim this exact win later, after
                # signing in, without replaying the puzzle -- see
                # claim_token.py. None (and the frontend just won't offer the
                # claim path) if CLAIM_TOKEN_SECRET isn't configured, or if
                # this connection was already signed in and doesn't need it.
                item["claim_token"] = claim_token.make_claim_token(resolved_date) if user_id is None else None

            await websocket.send_json(item)
            if item["type"] == "prompt":
                response = await websocket.receive_json()
            else:
                response = None
    except (WebSocketDisconnect, WebSocketException):
        # The client disconnected, or -- just as commonly at any real scale
        # -- reconnected (the restart button/key closes the old socket and
        # opens a new one), racing whatever this connection was in the
        # middle of sending/receiving. Not a bug: there's nothing left to do
        # with a socket that's already gone, and nothing worth logging as an
        # error for every ordinary restart.
        pass
    finally:
        # Routed through the same single-worker executor as every other
        # engine call (not called directly here) -- close() now also calls
        # into the C library (lib.end_duel(), see duel_engine.py) to release
        # the native duel object, and that must never run concurrently with
        # -- or on a different thread than -- this duel's other ctypes calls,
        # since ygopro-core's thread-safety under concurrent access is
        # unverified.
        await run_blocking(engine.close)
