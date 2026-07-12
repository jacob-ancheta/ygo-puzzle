import { useState } from "react";
import { API_URL } from "../config";

interface Props {
  onClose: () => void;
}

type Kind = "bug" | "suggestion";
type Status = "idle" | "sending" | "sent" | "error";

export default function FeedbackModal({ onClose }: Props) {
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    setStatus("sending");
    setErrorMessage(null);
    try {
      const res = await fetch(`${API_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message,
          contact_email: contactEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Couldn't send that -- try again in a bit.");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server -- try again in a bit.");
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Report a bug / suggest a puzzle</h3>
        {status === "sent" ? (
          <>
            <p>Thanks -- that's on its way.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-actions feedback-kind-toggle">
              <button className={`btn small ${kind === "bug" ? "primary" : ""}`} onClick={() => setKind("bug")}>
                Bug report
              </button>
              <button className={`btn small ${kind === "suggestion" ? "primary" : ""}`} onClick={() => setKind("suggestion")}>
                Puzzle suggestion
              </button>
            </div>
            <textarea
              className="text-input"
              rows={5}
              placeholder={kind === "bug" ? "What happened, and what did you expect instead?" : "What card(s)/setup would make a good puzzle?"}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
            <input
              className="text-input feedback-contact-email"
              type="email"
              placeholder="Your email (optional, if you want a reply)"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            {status === "error" && errorMessage && <p className="error-banner">{errorMessage}</p>}
            <div className="modal-actions">
              <button
                className="btn primary"
                disabled={!message.trim() || status === "sending"}
                onClick={handleSubmit}
              >
                {status === "sending" ? "Sending..." : "Send"}
              </button>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
