import { useState } from "react";
import { useTodayLeaderboard } from "../useTodayLeaderboard";
import SignInForm from "./SignInForm";

export interface WinSummary {
  rank: number | null;
  overall_position: number | null;
}

interface Props {
  winSummary: WinSummary | null | undefined;
  communityPosition: number | null | undefined;
  // The puzzle date and signed claim token from the win event -- both null
  // if this was a signed-in win (no claiming needed) or the server has no
  // CLAIM_TOKEN_SECRET configured. See App.tsx's claim-on-sign-in effect for
  // the other half of this flow.
  puzzleDate: string | null | undefined;
  claimToken: string | null | undefined;
  signInWithEmail: (email: string) => Promise<string | null>;
  onClose: () => void;
}

// Exported so App.tsx's post-redirect effect reads the same key/shape this
// writes.
export const PENDING_CLAIM_KEY = "duelpuzzdle_pending_claim";

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

const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`);

export default function WinModal({ winSummary, communityPosition, puzzleDate, claimToken, signInWithEmail, onClose }: Props) {
  const { rows, error } = useTodayLeaderboard();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied">("idle");
  const [showSignIn, setShowSignIn] = useState(false);

  // The magic-link click is a full-page redirect (see useAuth's
  // emailRedirectTo), which wipes this modal and all in-memory board state
  // -- stashing the claim token here is the only way it survives the round
  // trip. App.tsx picks this back up once `user` resolves after the reload
  // and posts it to /claim-win, without replaying the puzzle.
  function stashPendingClaim() {
    // TEMPORARY diagnostic logging -- remove once the claim-flow bug is
    // pinned down.
    console.log("[claim] stashPendingClaim called, puzzleDate:", puzzleDate, "claimToken:", claimToken);
    if (!puzzleDate || !claimToken) { console.log("[claim] missing puzzleDate or claimToken, not stashing"); return; }
    localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ date: puzzleDate, token: claimToken }));
    console.log("[claim] stashed to localStorage:", localStorage.getItem(PENDING_CLAIM_KEY));
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
            {!error && rows !== null && rows.length > 0 && (
              <ul className="modal-list">
                {rows.map((row) => (
                  <li key={row.rank}>
                    {medal(row.rank)} {row.profiles?.display_name ?? "unknown"}
                  </li>
                ))}
              </ul>
            )}
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
                  <SignInForm signInWithEmail={signInWithEmail} onBeforeSend={stashPendingClaim} onClose={() => setShowSignIn(false)} />
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
