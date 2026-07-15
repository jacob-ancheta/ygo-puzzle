import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { API_URL } from "../config";
import type { SignInResult } from "../useAuth";
import SignInForm, { MAX_USERNAME_LENGTH, USERNAME_QUERY_PARAM } from "./SignInForm";

const MAX_NAME_LENGTH = MAX_USERNAME_LENGTH;

interface Profile {
  display_name: string;
  first_count: number;
  second_count: number;
  third_count: number;
}

interface Props {
  user: User | null;
  accessToken: string | undefined;
  signInWithEmail: (email: string, redirectTo: string, redirectToForNewAccount?: string) => Promise<SignInResult>;
  signOut: () => void;
}

export default function AuthPanel({ user, accessToken, signInWithEmail, signOut }: Props) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Distinguishes "haven't fetched yet" from "fetched, but this signed-in
  // account has no profile row" -- previously both silently rendered as
  // nothing at all, indistinguishable from a fresh signup with no visible
  // error either way.
  const [profileMissing, setProfileMissing] = useState(false);

  const [showRename, setShowRename] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving" | "error">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) { setProfile(null); setProfileMissing(false); return; }
    let cancelled = false;
    setProfileMissing(false);
    fetch(`${API_URL}/profile/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setProfileMissing(true); return; }
        setProfile(data);
      })
      .catch(() => { if (!cancelled) setProfileMissing(true); });
    return () => { cancelled = true; };
  }, [accessToken]);

  function openRename() {
    setNewName(profile?.display_name ?? "");
    setRenameStatus("idle");
    setRenameError(null);
    setShowRename(true);
  }

  async function handleRenameSave() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenameStatus("error");
      setRenameError("Name can't be empty.");
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setRenameStatus("error");
      setRenameError(`Keep it under ${MAX_NAME_LENGTH} characters.`);
      return;
    }
    if (!accessToken) return;
    setRenameStatus("saving");
    // Routed through /claim-username (not a direct Supabase client call)
    // so rename enforces the same cross-account uniqueness check as the
    // sign-in flow -- two accounts could otherwise end up with identical
    // display_names via this path even after sign-in was locked down.
    try {
      const res = await fetch(`${API_URL}/claim-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameStatus("error");
        setRenameError(data.error ?? "Couldn't save that name.");
        return;
      }
    } catch {
      setRenameStatus("error");
      setRenameError("Couldn't reach the server -- try again in a bit.");
      return;
    }
    setProfile((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
    setShowRename(false);
  }

  return (
    <div className="auth-panel">
      {user ? (
        <>
          {profile && (
            <>
              <span className="display-name">{profile.display_name}</span>
              <button className="btn small" onClick={openRename} title="Rename">
                Rename
              </button>
              <span className="profile-counters" title="Lifetime 1st / 2nd / 3rd place finishes">
                🥇{profile.first_count} 🥈{profile.second_count} 🥉{profile.third_count}
              </span>
            </>
          )}
          {profileMissing && (
            <span className="dim" title="Signed in, but no profile row was found for this account -- try refreshing, or contact support if this persists.">
              Signed in (profile unavailable)
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
            <SignInForm
              onSubmit={(email, username) => {
                // The existing-user redirect deliberately carries no
                // username -- see useAuth.ts's signInWithEmail, which tries
                // this one first and never reaches the second (username-
                // bearing) redirect for an account that already exists.
                const redirectTo = window.location.origin;
                const redirectToForNewAccount = username
                  ? `${window.location.origin}?${USERNAME_QUERY_PARAM}=${encodeURIComponent(username)}`
                  : undefined;
                return signInWithEmail(email, redirectTo, redirectToForNewAccount);
              }}
              onClose={() => setShowSignIn(false)}
            />
          </div>
        </div>
      )}

      {showRename && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Rename</h3>
            <input
              className="text-input"
              type="text"
              value={newName}
              maxLength={MAX_NAME_LENGTH}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            {renameStatus === "error" && renameError && <p className="error-banner">{renameError}</p>}
            <div className="modal-actions">
              <button className="btn primary" disabled={renameStatus === "saving"} onClick={handleRenameSave}>
                {renameStatus === "saving" ? "Saving..." : "Save"}
              </button>
              <button className="btn" onClick={() => setShowRename(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
