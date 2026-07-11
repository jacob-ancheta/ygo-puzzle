import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { API_URL } from "../config";
import { supabase } from "../supabaseClient";
import SignInForm from "./SignInForm";

const MAX_NAME_LENGTH = 20;

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
  const [profile, setProfile] = useState<Profile | null>(null);

  const [showRename, setShowRename] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameStatus, setRenameStatus] = useState<"idle" | "saving" | "error">("idle");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) { setProfile(null); return; }
    let cancelled = false;
    fetch(`${API_URL}/profile/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((res) => res.json())
      .then((data) => { if (!cancelled && !data.error) setProfile(data); })
      .catch(() => {});
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
    if (!user) return;
    setRenameStatus("saving");
    // Safe directly from the client: RLS restricts this update to the
    // signed-in user's own row and only grants the display_name column
    // (see the schema set up when accounts were added).
    const { error } = await supabase.from("profiles").update({ display_name: trimmed }).eq("id", user.id);
    if (error) {
      setRenameStatus("error");
      setRenameError(error.message);
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
            <SignInForm signInWithEmail={signInWithEmail} onClose={() => setShowSignIn(false)} />
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
