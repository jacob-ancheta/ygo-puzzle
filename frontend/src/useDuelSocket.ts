import { useCallback, useEffect, useRef, useState } from "react";
import { applyEvent, createInitialBoard, type BoardState } from "./boardState";

export interface DuelError {
  message: string;
  suggestions?: Record<string, { code: number; name: string }[]>;
}

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

  const connect = useCallback(() => {
    wsRef.current?.close();
    setBoard(createInitialBoard());
    setPrompt(null);
    setError(null);

    const generation = ++generationRef.current;
    const token = getToken?.();
    const fullUrl = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => { if (generationRef.current === generation) setConnected(true); };
    ws.onclose = () => { if (generationRef.current === generation) setConnected(false); };
    ws.onerror = () => { if (generationRef.current === generation) setConnected(false); };

    ws.onmessage = (raw) => {
      if (generationRef.current !== generation) return;
      const item = JSON.parse(raw.data as string);

      if (item.type === "error") {
        setError({ message: item.message, suggestions: item.suggestions });
        setPrompt(null);
        return;
      }

      if (item.type === "event") {
        setBoard((prev) => applyEvent(prev, item));
        setPrompt(null);
      } else if (item.type === "prompt") {
        setPrompt(item);
      }
    };
    // getToken is included so a fresh sign-in/out is reflected on the *next*
    // connect() call -- omitting it would let this closure keep reading
    // whatever session existed when this callback was first created.
  }, [url, getToken]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
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
