import { useEffect, useState } from "react";
import { API_URL } from "../config";
import type { SignInResult } from "../useAuth";

// Query param name App.tsx's post-redirect effect reads the desired
// username back from -- see the redirectTo callers build around onSubmit.
export const USERNAME_QUERY_PARAM = "username";

export const MAX_USERNAME_LENGTH = 20;
const MAX_EMAIL_LENGTH = 254;
// Deliberately loose -- just enough to catch obvious typos/garbage.
// Supabase's own signup validation is the real authority on email validity.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  // Called once email passes validation and "Send link" is clicked --
  // username may be blank (a returning player doesn't need to retype
  // theirs, see useAuth.ts's signInWithEmail). The caller (AuthPanel/
  // WinModal) builds whatever redirectTo(s) it needs (e.g. WinModal also
  // carries a win-claim token) and calls signInWithEmail itself, since that
  // varies per caller.
  onSubmit: (email: string, username: string) => Promise<SignInResult>;
  // Optional secondary action rendered alongside "Send magic link" in the
  // same row (rather than each caller having to add its own separate
  // modal-actions block below this one) -- AuthPanel uses this for "Close".
  onClose?: () => void;
}

export default function SignInForm({ onSubmit, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "no-account" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Best-effort, immediate feedback before ever sending an email -- the
  // real, authoritative uniqueness check still happens server-side at
  // /claim-username once the player actually clicks the link (see
  // App.tsx), since this one can't prevent a same-instant race between two
  // people typing the same name.
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");

  useEffect(() => {
    const trimmed = username.trim();
    if (!trimmed) { setAvailability("idle"); return; }
    setAvailability("checking");
    let cancelled = false;
    const id = setTimeout(() => {
      fetch(`${API_URL}/username-available?name=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => { if (!cancelled) setAvailability(data.available ? "available" : "taken"); })
        .catch(() => { if (!cancelled) setAvailability("idle"); });
    }, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [username]);

  const trimmedEmail = email.trim();
  const trimmedUsername = username.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  // Username is only required once we've actually learned this email has no
  // account yet (the "no-account" status below) -- otherwise a returning
  // player can submit with it blank.
  const usernameOk = trimmedUsername.length === 0 || availability !== "taken";
  const canSubmit = emailValid && usernameOk && status !== "sending";

  // A stale "no account"/error from a previous attempt shouldn't keep
  // showing once the player starts changing what they'll submit next.
  function clearStaleStatus() {
    if (status === "no-account" || status === "error") setStatus("idle");
  }

  async function handleSend() {
    setStatus("sending");
    setErrorMessage(null);
    const result = await onSubmit(trimmedEmail, trimmedUsername);
    if (result.ok) {
      setStatus("sent");
    } else if (result.reason === "no-account") {
      setStatus("no-account");
    } else {
      setStatus("error");
      setErrorMessage(result.message);
    }
  }

  return (
    <>
      {status === "sent" ? (
        <p>Check your email for a link. (Please check spam)</p>
      ) : (
        <>
          <input
            className="text-input signin-username"
            type="text"
            placeholder="Username (leave blank if you already have an account)"
            maxLength={MAX_USERNAME_LENGTH}
            value={username}
            onChange={(e) => { setUsername(e.target.value); clearStaleStatus(); }}
            autoFocus
          />
          {availability === "taken" && <p className="error-banner">That username is already taken.</p>}
          <input
            className="text-input"
            type="email"
            placeholder="you@example.com"
            maxLength={MAX_EMAIL_LENGTH}
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearStaleStatus(); }}
          />
          {email.length > 0 && !emailValid && <p className="error-banner">Enter a valid email address.</p>}
          {status === "no-account" && (
            <p className="error-banner">No account found for that email -- enter a username to create one.</p>
          )}
          {status === "error" && errorMessage && <p className="error-banner">{errorMessage}</p>}
        </>
      )}
      <div className="modal-actions">
        {status !== "sent" && (
          <button className="btn primary" disabled={!canSubmit} onClick={handleSend}>
            {status === "sending" ? "Sending..." : "Send link"}
          </button>
        )}
        {onClose && <button className="btn" onClick={onClose}>Close</button>}
      </div>
    </>
  );
}
