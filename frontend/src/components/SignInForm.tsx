import { useState } from "react";

interface Props {
  signInWithEmail: (email: string) => Promise<string | null>;
  // Called right before the magic-link email actually sends -- WinModal
  // uses this to stash a pending win-claim into localStorage first, since
  // the magic-link redirect is a full page reload that would otherwise lose
  // it (see App.tsx's claim-on-sign-in effect).
  onBeforeSend?: () => void;
  // Optional secondary action rendered alongside "Send magic link" in the
  // same row (rather than each caller having to add its own separate
  // modal-actions block below this one) -- AuthPanel uses this for "Close".
  onClose?: () => void;
}

export default function SignInForm({ signInWithEmail, onBeforeSend, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSend() {
    onBeforeSend?.();
    setStatus("sending");
    setErrorMessage(null);
    const err = await signInWithEmail(email);
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
        <p>Check your email for a magic link.</p>
      ) : (
        <>
          <input
            className="text-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          {status === "error" && errorMessage && <p className="error-banner">{errorMessage}</p>}
        </>
      )}
      <div className="modal-actions">
        {status !== "sent" && (
          <button className="btn primary" disabled={!email || status === "sending"} onClick={handleSend}>
            {status === "sending" ? "Sending..." : "Send magic link"}
          </button>
        )}
        {onClose && <button className="btn" onClick={onClose}>Close</button>}
      </div>
    </>
  );
}
