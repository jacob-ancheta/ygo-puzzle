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

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

import puzzle_registry
from duel_engine import DuelEngine, DuelEnded, PuzzleLoadError, run, initial_board_state

app = FastAPI()
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


@app.websocket("/ws")
async def duel_socket(websocket: WebSocket):
    await websocket.accept()
    date_param = websocket.query_params.get("date")

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
        await websocket.send_json(initial_board_state(engine))

        gen = run(engine)
        response = None
        try:
            while True:
                try:
                    item = await run_blocking(gen.send, response)
                except DuelEnded:
                    await websocket.send_json({"type": "event", "event": "duel_ended",
                                                "message": "no more messages from the engine"})
                    break
                except StopIteration:
                    break

                await websocket.send_json(item)
                if item["type"] == "prompt":
                    response = await websocket.receive_json()
                else:
                    response = None
        except WebSocketDisconnect:
            pass
    finally:
        engine.close()
