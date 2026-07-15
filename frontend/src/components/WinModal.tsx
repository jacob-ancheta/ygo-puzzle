import { useState } from "react";
import { useTodayLeaderboard } from "../useTodayLeaderboard";
import type { SignInResult } from "../useAuth";
import SignInForm, { USERNAME_QUERY_PARAM } from "./SignInForm";
import LeaderboardList from "./LeaderboardList";

export interface WinSummary {
  rank: number | null;
  overall_position: number | null;
}

interface Props {
  winSummary: WinSummary | null | undefined;
  communityPosition: number | null | undefined;
  // The signed claim token from the win event -- null if this was a
  // signed-in win (no claiming needed) or the server has no
  // CLAIM_TOKEN_SECRET configured. See App.tsx's claim-on-sign-in effect for
  // the other half of this flow.
  claimToken: string | null | undefined;
  signInWithEmail: (email: string, redirectTo: string, redirectToForNewAccount?: string) => Promise<SignInResult>;
  onClose: () => void;
}

// Query param name App.tsx's post-redirect effect reads the claim token
// back from -- see the redirectTo built below.
export const CLAIM_QUERY_PARAM = "claim";

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export default function WinModal({ winSummary, communityPosition, claimToken, signInWithEmail, onClose }: Props) {
  const { rows, error } = useTodayLeaderboard();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [showSignIn, setShowSignIn] = useState(false);

  // The magic-link click is a full-page redirect (see useAuth's
  // emailRedirectTo) that can land in an entirely different browser/app
  // than the one that requested it -- most commonly an email client's
  // in-app browser, which doesn't share localStorage with wherever this
  // page is running. Embedding both the claim token and the desired
  // username directly in the redirect URL survives that regardless, since
  // they travel with the link itself rather than depending on persisted
  // storage. App.tsx reads them back off window.location on load and posts
  // to /claim-win and /claim-username respectively.
  function handleSignIn(email: string, username: string): Promise<SignInResult> {
    // The claim token (if any) belongs on *both* redirects -- a returning
    // player claiming an anonymous win still needs it -- but the username
    // only ever belongs on the new-account one, so an existing player's
    // display_name is never touched even if they typed something here. See
    // useAuth.ts's signInWithEmail for why the first redirect is tried
    // alone before the second is ever used.
    const baseParams = new URLSearchParams();
    if (claimToken) baseParams.set(CLAIM_QUERY_PARAM, claimToken);
    const buildUrl = (params: URLSearchParams) => {
      const qs = params.toString();
      return qs ? `${window.location.origin}?${qs}` : window.location.origin;
    };
    const redirectTo = buildUrl(baseParams);
    let redirectToForNewAccount: string | undefined;
    if (username) {
      const newParams = new URLSearchParams(baseParams);
      newParams.set(USERNAME_QUERY_PARAM, username);
      redirectToForNewAccount = buildUrl(newParams);
    }
    return signInWithEmail(email, redirectTo, redirectToForNewAccount);
  }

  // Real (signed-in, tamper-resistant) position takes priority; the rough
  // community count is only a fallback so anonymous players still get a
  // number in the share text -- never fed into the actual leaderboard.
  const position = winSummary?.overall_position ?? null;
  const displayPosition = position ?? communityPosition ?? null;
  const shareText = displayPosition != null
    ? `I solved today's Duel Puzzdle! I was the ${ordinal(displayPosition)} to finish today. Try it: ${window.location.origin}`
    : `I solved today's Duel Puzzdle! Try it: ${window.location.origin}`;

  async function handleShare() {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      // Permission denied or similar -- nothing useful to do beyond not
      // pretending it worked; the text is still visible in the modal.
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal win-modal">
        <h3>🎉 Congrats!</h3>

        <div className="win-modal-columns">
          <div className="win-modal-column">
            <h4>Today's top solvers</h4>
            {error && <p className="error-banner">{error}</p>}
            {!error && rows === null && <p>Loading...</p>}
            {!error && rows !== null && rows.length === 0 && <p>You're the first today!</p>}
            {!error && rows !== null && rows.length > 0 && <LeaderboardList rows={rows} />}
          </div>

          <div className="win-modal-column">
            <h4>Your result</h4>
            {position != null ? (
              <p className="win-modal-position">You finished {ordinal(position)} today!</p>
            ) : (
              <>
                {communityPosition != null ? (
                  <p className="win-modal-position">You were the {ordinal(communityPosition)} to solve it today!</p>
                ) : (
                  <p>Sign in to appear on the leaderboard next time.</p>
                )}
                {showSignIn ? (
                  <SignInForm onSubmit={handleSignIn} onClose={() => setShowSignIn(false)} />
                ) : (
                  <button className="btn small" onClick={() => setShowSignIn(true)}>
                    Sign in{claimToken ? " to save your spot" : ""}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <p className="dim win-modal-share-preview">{shareText}</p>

        <div className="modal-actions">
          <button className="btn primary" onClick={handleShare}>
            {shareStatus === "copied" ? "Copied!" : "Share"}
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
