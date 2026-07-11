import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { API_URL } from "../config";

interface Profile {
  display_name: string;
  first_count: number;
  second_count: number;
  third_count: number;
}

interface Props {
  user: User | null;
  accessToken: string | undefined;
  signInWithEmail: (email: string) => Promise<string | null>;
  signOut: () => void;
}

export default function AuthPanel({ user, accessToken, signInWithEmail, signOut }: Props) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!accessToken) { setProfile(null); return; }
    let cancelled = false;
    fetch(`${API_URL}/profile/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => { if (!cancelled && !data.error) setProfile(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  async function handleSend() {
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
    <div className="auth-panel">
      {user ? (
        <>
          {profile && (
            <span className="profile-counters" title="Lifetime 1st / 2nd / 3rd place finishes">
              🥇{profile.first_count} 🥈{profile.second_count} 🥉{profile.third_count}
            </span>
          )}
          <button className="btn small" onClick={() => signOut()}>
            Sign out
          </button>
        </>
      ) : (
        <button className="btn small" onClick={() => setShowSignIn(true)}>
          Sign in
        </button>
      )}

      {showSignIn && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Sign in to appear on the leaderboard</h3>
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
              <button
                className="btn"
                onClick={() => { setShowSignIn(false); setStatus("idle"); setEmail(""); setErrorMessage(null); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
