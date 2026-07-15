import { useCallback, useEffect, useRef, useState } from "react";
import { applyEvent, createInitialBoard, type BoardState } from "./boardState";

export interface DuelError {
  message: string;
  suggestions?: Record<string, { code: number; name: string }[]>;
}

// A closed/errored socket retries this many times, with linear backoff
// (RETRY_BASE_MS * attempt number), before giving up and just sitting
// disconnected for the player to manually hit Restart -- covers a
// transient hiccup (a backend restart/redeploy landing mid-connect, most
// commonly right around the daily puzzle rotation, or a flaky network
// blip) without retrying forever against a genuinely dead backend.
const MAX_AUTO_RETRIES = 5;
const RETRY_BASE_MS = 1500;

// Event names that mean the engine has nothing left to say and server.py's
// own driver loop is about to return (closing the socket as a normal part of
// that, not a failure) -- see server.py's duel_socket and duel_engine.py's
// `run` generator. Mirrors test_client.py's own stop condition.
const TERMINAL_EVENTS = new Set(["win", "loss", "duel_ended", "unsupported", "unhandled"]);

export function useDuelSocket(url: string, getToken?: () => string | undefined) {
  const [board, setBoard] = useState<BoardState>(createInitialBoard());
  const [prompt, setPrompt] = useState<Record<string, unknown> | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<DuelError | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Bumped on every connect() so stale sockets (e.g. the first half of a
  // React StrictMode double-mount, whose close() is async) can tell their
  // own messages apart from the socket that superseded them and no-op.
  const generationRef = useRef(0);
  // Consecutive auto-retry count for the *current* generation -- reset by
  // every explicit connect() (a fresh attempt, e.g. the player clicking
  // Restart, or App.tsx's daily-rotation reconnect) and by every successful
  // onopen, so a later genuinely-transient failure gets its own full
  // MAX_AUTO_RETRIES budget rather than inheriting an exhausted one.
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once a TERMINAL_EVENTS message arrives (see above) -- server.py
  // closes the socket right after sending one of these as an ordinary part
  // of the duel being over, not a dropped connection. Without this,
  // useDuelSocket's own auto-retry (meant for a genuine mid-puzzle network
  // blip) treated that expected close identically to a real one and quietly
  // opened a brand-new attempt ~1.5s later -- overwriting `board` with a
  // freshly reset one. Reproduced live: winning the puzzle would silently
  // reconnect into a new attempt shortly after, which flips
  // board.status away from "win" and closes WinModal out from under the
  // player (App.tsx's showWinModal effect tracks exactly that field) --
  // first reported as "the sign-in modal closes and the puzzle resets",
  // since that's usually about when someone has gotten around to clicking
  // into it.
  const terminalRef = useRef(false);

  const connect = useCallback(() => {
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
    wsRef.current?.close();
    setBoard(createInitialBoard());
    setPrompt(null);
    setError(null);

    const generation = ++generationRef.current;
    retryCountRef.current = 0;
    terminalRef.current = false;

    const open = () => {
      const token = getToken?.();
      const fullUrl = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (generationRef.current !== generation) return;
        retryCountRef.current = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        if (generationRef.current !== generation) return;
        setConnected(false);
        if (terminalRef.current) return;
        if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
        retryCountRef.current += 1;
        retryTimeoutRef.current = setTimeout(open, RETRY_BASE_MS * retryCountRef.current);
      };
      ws.onerror = () => { if (generationRef.current === generation) setConnected(false); };

      ws.onmessage = onMessage;
    };

    function onMessage(raw: MessageEvent) {
      if (generationRef.current !== generation) return;
      const item = JSON.parse(raw.data as string);

      if (item.type === "error") {
        setError({ message: item.message, suggestions: item.suggestions });
        setPrompt(null);
        return;
      }

      if (item.type === "event") {
        if (TERMINAL_EVENTS.has(item.event)) terminalRef.current = true;
        setBoard((prev) => applyEvent(prev, item));
        setPrompt(null);
      } else if (item.type === "prompt") {
        setPrompt(item);
      }
    }

    open();
    // getToken is included so a fresh sign-in/out is reflected on the *next*
    // connect() call -- omitting it would let this closure keep reading
    // whatever session existed when this callback was first created.
  }, [url, getToken]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against sending twice for the same prompt: React StrictMode (dev
  // only) double-invokes setState updater functions, and a couple of call
  // sites used to build their response *inside* one (e.g. App.tsx's
  // handlePlaceChoice, via setSelection(prev => { ...; respond(...) })), so
  // a single click could fire this twice -- confirmed live, see below.
  // server.py's driver loop calls `await websocket.receive_json()` exactly
  // once per prompt with no validation that the reply matches what was
  // actually asked, so a second, stray send doesn't get rejected -- it
  // silently becomes the answer to whatever prompt comes *next*, corrupting
  // an unrelated decision (reproduced: a duplicate zone-placement answer got
  // consumed as the reply to the following position prompt, which the
  // engine then rejected as invalid).
  //
  // respondedForRef tracks *which prompt* was last answered, by reference,
  // so a second call for the same still-current prompt is a no-op -- this
  // must NOT live inside a setState updater callback itself (an earlier
  // version did exactly that, and StrictMode double-invoking that very
  // updater defeated it -- the guard's own side effect got doubled too).
  const respondedForRef = useRef<Record<string, unknown> | null>(null);
  const respond = useCallback((response: Record<string, unknown>) => {
    if (respondedForRef.current === prompt) return;
    respondedForRef.current = prompt;
    wsRef.current?.send(JSON.stringify(response));
    setPrompt(null);
  }, [prompt]);

  return { board, prompt, connected, error, connect, respond };
}
