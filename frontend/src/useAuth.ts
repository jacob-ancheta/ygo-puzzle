import { useCallback, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

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
  const signInWithEmail = useCallback(async (email: string, redirectTo?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo ?? window.location.origin },
    });
    return error?.message ?? null;
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  return { session, user, signInWithEmail, signOut };
}
