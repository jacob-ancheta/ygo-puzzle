import { useEffect, useState } from "react";
import { API_URL } from "../config";

// Query param name App.tsx's post-redirect effect reads the desired
// username back from -- see the redirectTo callers build around onSubmit.
export const USERNAME_QUERY_PARAM = "username";

export const MAX_USERNAME_LENGTH = 20;
const MAX_EMAIL_LENGTH = 254;
// Deliberately loose -- just enough to catch obvious typos/garbage.
// Supabase's own signup validation is the real authority on email validity.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  // Called once both fields pass validation and "Send magic link" is
  // clicked -- the caller (AuthPanel/WinModal) builds whatever redirectTo
  // it needs (e.g. WinModal also carries a win-claim token) and calls
  // signInWithEmail itself, since that varies per caller.
  onSubmit: (email: string, username: string) => Promise<string | null>;
  // Optional secondary action rendered alongside "Send magic link" in the
  // same row (rather than each caller having to add its own separate
  // modal-actions block below this one) -- AuthPanel uses this for "Close".
  onClose?: () => void;
}

export default function SignInForm({ onSubmit, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
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
  const canSubmit = emailValid && trimmedUsername.length > 0 && availability !== "taken" && status !== "sending";

  async function handleSend() {
    setStatus("sending");
    setErrorMessage(null);
    const err = await onSubmit(trimmedEmail, trimmedUsername);
    if (err) {
      setStatus("error");
      setErrorMessage(err);
    } else {
      setStatus("sent");
    }
  }

  return (
    <>
      {status === "sent" ? (
        <p>Check your email for a link.</p>
      ) : (
        <>
          <input
            className="text-input signin-username"
            type="text"
            placeholder="Username"
            maxLength={MAX_USERNAME_LENGTH}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          {availability === "taken" && <p className="error-banner">That username is already taken.</p>}
          <input
            className="text-input"
            type="email"
            placeholder="you@example.com"
            maxLength={MAX_EMAIL_LENGTH}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {email.length > 0 && !emailValid && <p className="error-banner">Enter a valid email address.</p>}
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
