export const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8000/ws";
export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

export function imageUrl(path?: string): string | undefined {
  return path ? `${API_URL}${path}` : undefined;
}
