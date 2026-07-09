import { useCallback, useEffect, useRef, useState } from "react";
import { applyEvent, createInitialBoard, type BoardState } from "./boardState";

export interface DuelError {
  message: string;
  suggestions?: Record<string, { code: number; name: string }[]>;
}

export function useDuelSocket(url: string) {
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
    const ws = new WebSocket(url);
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
  }, [url]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = useCallback((response: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(response));
    setPrompt(null);
  }, []);

  return { board, prompt, connected, error, connect, respond };
}
