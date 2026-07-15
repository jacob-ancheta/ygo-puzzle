import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "no-account" }
  | { ok: false; reason: "error"; message: string };

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // redirectTo lets a caller (WinModal's claim flow) send the player back
  // to a URL carrying extra state -- see PENDING_CLAIM_KEY's replacement in
  // App.tsx/WinModal.tsx, which encodes the claim token as a query param
  // rather than localStorage: the magic link is often opened in a
  // different browser/app than the one that requested it (an email
  // client's in-app browser, most commonly), which doesn't share
  // localStorage with wherever signInWithEmail was originally called from.
  // A query param travels with the link itself, so it survives regardless.
  //
  // Tries as an existing-user-only sign-in first (shouldCreateUser: false,
  // via `redirectTo` -- deliberately never carrying a username, so a
  // returning player's display_name is never touched even if they typed
  // something in that field). If that succeeds, the real magic link has
  // already gone out and there's nothing else to do -- this is also how a
  // blank username field is allowed at all: existing players never need to
  // retype a name they already have.
  //
  // Only a failure that's specifically "no such user" falls through to
  // actually creating one, and only if the caller supplied
  // `redirectToForNewAccount` (i.e. a username was given) -- otherwise this
  // reports "no-account" so the caller can prompt for one instead of
  // silently doing nothing.
  const signInWithEmail = useCallback(async (
    email: string,
    redirectTo: string,
    redirectToForNewAccount?: string,
  ): Promise<SignInResult> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (!error) return { ok: true };
    // GoTrue's documented response for shouldCreateUser:false against an
    // email with no existing account is this exact message -- confirmed
    // against Supabase's own source, but re-verify with one real attempt if
    // this project's Supabase version ever stops matching it, since a
    // silent mismatch would misreport every "no account" case as a generic
    // error instead.
    const noAccount = error.message.includes("Signups not allowed for otp");
    if (!noAccount) return { ok: false, reason: "error", message: error.message };
    if (!redirectToForNewAccount) return { ok: false, reason: "no-account" };
    const { error: signupError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectToForNewAccount },
    });
    return signupError ? { ok: false, reason: "error", message: signupError.message } : { ok: true };
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  return { session, user, signInWithEmail, signOut };
}
