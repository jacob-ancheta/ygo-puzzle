"""
One shared httpx.AsyncClient for every outbound HTTP call the backend makes
(Supabase REST/auth, Resend). Previously each call constructed -- and tore
down -- its own AsyncClient, which means a fresh TCP+TLS handshake per call;
with a shared client, httpx keeps pooled connections alive across calls, so
the 2-3 sequential Supabase round trips on every win (already_recorded,
record_completion, record_win) reuse one warm connection instead of paying
three handshakes. Never closed explicitly: it lives for the whole process,
same as the connections it pools.
"""
import httpx

client = httpx.AsyncClient(timeout=5.0)
