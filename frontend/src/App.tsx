import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { useDuelSocket } from "./useDuelSocket";
import { useAuth } from "./useAuth";
import Board, { type PileView, type PendingPlacementView } from "./components/Board";
import ActionMenu from "./components/ActionMenu";
import PromptOverlay from "./components/PromptOverlay";
import SelectionBar from "./components/SelectionBar";
import CardDetailPanel from "./components/CardDetailPanel";
import CardTile from "./components/CardTile";
import AuthPanel from "./components/AuthPanel";
import ResetCountdown from "./components/ResetCountdown";
import LeaderboardModal from "./components/LeaderboardModal";
import FeedbackModal from "./components/FeedbackModal";
import LossModal from "./components/LossModal";
import WinModal, { ordinal, CLAIM_QUERY_PARAM } from "./components/WinModal";
import { USERNAME_QUERY_PARAM } from "./components/SignInForm";
import { nonCardOptions } from "./interaction";
import { LOC, TYPE_FIELD, guessOpenZones, type BoardState } from "./boardState";
import { API_URL, WS_URL } from "./config";
import type { CardRef, IdleBattleOption } from "./protocol";

const BOARD_PROMPTS = new Set(["idlecmd", "battlecmd", "card", "tribute", "sum", "select_unselect", "place", "chain"]);
const MULTI_SELECT_PROMPTS = new Set(["card", "tribute", "sum"]);
// "shuffle_hand" is a real idlecmd option the engine can offer, but this
// puzzle never needs it and it just clutters the phase menu -- drop it here
// rather than in interaction.ts, which stays a generic categorizer.
const HIDDEN_ACTIONS = new Set(["shuffle_hand"]);

// Actions that skip straight to committing (Summon, Set, attack, ...) stay
// as-is; these ones interrupt with a confirm step first, since choosing them
// is otherwise irreversible and there's no other point of no return to catch
// a misclick. Set Monster/Set Spell/Trap are deliberately NOT here -- both
// commit straight to the (already glow-highlighted) zone-placement prompt,
// same as Special Summon material selection does elsewhere.
function needsConfirm(action: string): boolean {
  return action === "Activate" || action === "activate" || action === "Special Summon";
}

function confirmLabel(action: string, cardName: string): string {
  if (action === "Special Summon") return `Special Summon ${cardName}?`;
  return `Activate effect of ${cardName}?`;
}

// Set Monster/Set Spell-Trap/Normal Summon all place onto one of the
// player's own 5 main zones -- for these (and only these), the target zone
// is guessed client-side (see boardState.ts's guessOpenZones) so the zones
// can glow, with a free Cancel, before anything is sent to the server.
// Special Summon and Activate stay on the old confirm-then-ask-server path.
function locationIdForPlacementAction(action: string): number | null {
  if (action === "Set Spell/Trap") return LOC.SZONE;
  if (action === "Summon" || action === "Set Monster") return LOC.MZONE;
  return null;
}

function isPlacementAction(action: string): boolean {
  return locationIdForPlacementAction(action) !== null;
}

function placementLabel(action: string, isFieldSpell: boolean): string {
  if (action === "Set Spell/Trap") return isFieldSpell ? "Choose the Field Zone" : "Choose a Spell/Trap Zone";
  return "Choose a Monster Zone";
}


interface MenuState {
  card?: CardRef;
  options: { option: IdleBattleOption; idx: number }[];
  x: number;
  y: number;
}

interface ConfirmState {
  label: string;
  action: string;
  idx: number;
  card?: CardRef;
}

export default function App() {
  const { session, user, signInWithEmail, signOut } = useAuth();
  const { board, prompt, connected, error, connect, respond } = useDuelSocket(WS_URL, () => session?.access_token);

  // useDuelSocket's own mount effect connects immediately, before Supabase
  // has necessarily finished hydrating a session from the magic-link
  // redirect's URL fragment (or localStorage) -- that first connection can
  // easily race ahead of sign-in and land anonymous even though the UI
  // catches up moments later and shows the player as signed in for the rest
  // of the attempt. Reconnecting the instant sign-in resolves (not on every
  // subsequent session change, just the null -> real transition) guarantees
  // the attempt actually being played is the one the server sees as
  // authenticated, at the cost of restarting whatever the first split
  // second of anonymous play was -- reproduced live: signed-in players who
  // won got no puzzle_results row because their whole duel had actually run
  // on the pre-sign-in anonymous connection.
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    const justSignedIn = !wasSignedInRef.current && user !== null;
    wasSignedInRef.current = user !== null;
    if (justSignedIn) connect();
  }, [user, connect]);

  // WinModal's "Sign In" button embeds the claim token directly in the
  // magic-link's redirect URL (see WinModal.tsx's handleSignIn) --
  // read it back here and redeem it. A plain POST, entirely independent of
  // the duel socket/reconnect effect above: the win already happened
  // server-side, so there's nothing to replay.
  //
  // Deliberately its own effect keyed only on `session`, not bundled into
  // the justSignedIn transition above: that effect fires exactly once, the
  // instant `user` flips from null, and `session` isn't guaranteed to carry
  // a populated access_token in that very same tick during magic-link
  // redirect hydration. This version just keeps checking on every session
  // change (guarded by claimAttemptedRef so it only ever actually fires
  // once) until a token shows up.
  const claimAttemptedRef = useRef(false);
  const [claimResult, setClaimResult] = useState<{ position: number } | { error: string } | null>(null);
  useEffect(() => {
    if (claimAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get(CLAIM_QUERY_PARAM);
    if (!token) return;
    if (!session?.access_token) return;
    claimAttemptedRef.current = true;
    // Drop the token from the URL/history now that we've read it, rather
    // than leaving it sitting there (visible, re-submittable on refresh).
    params.delete(CLAIM_QUERY_PARAM);
    const cleanedSearch = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (cleanedSearch ? `?${cleanedSearch}` : ""));

    fetch(`${API_URL}/claim-win`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        const pos = data.leaderboard?.overall_position;
        if (res.ok && pos != null) {
          setClaimResult({ position: pos });
        } else {
          // Expired/already-claimed token, or a signed-in win somehow with
          // no overall_position -- either way, this used to fail silently
          // with no feedback at all, which looked identical to "nothing
          // happened" from a successful no-op.
          setClaimResult({ error: data.error ?? "Couldn't save your win." });
        }
      })
      .catch(() => setClaimResult({ error: "Couldn't reach the server to save your win." }));
  }, [session]);

  // Same pattern as the win-claim effect above, for the username chosen at
  // sign-in time (see SignInForm) -- also embedded in the redirect URL
  // rather than localStorage, and only actually reserved here, once the
  // player has verified via the magic link, not merely by typing it into
  // the form (see /claim-username's uniqueness check).
  const usernameClaimAttemptedRef = useRef(false);
  const [usernameResult, setUsernameResult] = useState<{ name: string } | { error: string } | null>(null);
  useEffect(() => {
    if (usernameClaimAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const username = params.get(USERNAME_QUERY_PARAM);
    if (!username) return;
    if (!session?.access_token) return;
    usernameClaimAttemptedRef.current = true;
    params.delete(USERNAME_QUERY_PARAM);
    const cleanedSearch = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (cleanedSearch ? `?${cleanedSearch}` : ""));

    fetch(`${API_URL}/claim-username`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ username }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setUsernameResult({ name: data.display_name ?? username });
        } else {
          setUsernameResult({ error: data.error ?? "Couldn't set that username." });
        }
      })
      .catch(() => setUsernameResult({ error: "Couldn't reach the server to set your username." }));
  }, [session]);

  // A restart isn't free server-side (a fresh native duel object, a new
  // shuffle/deal, an initial phase resolution -- all serialized behind
  // server.py's single-worker engine executor, shared across every
  // connected user), so reflexive spam -- holding R (keydown auto-repeats),
  // mashing the button -- shouldn't turn into a matching flood of restarts.
  // This is deliberately just a client-side cooldown, not a queue: extra
  // presses inside the window are dropped outright, not deferred.
  const lastRestartRef = useRef(0);
  const restart = useCallback(() => {
    const now = Date.now();
    if (now - lastRestartRef.current < 750) return;
    lastRestartRef.current = now;
    connect();
  }, [connect]);

  // "R" restarts the puzzle from anywhere -- matches the key badge on the
  // restart button. Ignored while a text prompt (announce_card/race/attrib)
  // has an <input> focused, so typing an "r" into a card name doesn't
  // accidentally blow away the attempt.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "r" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      restart();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [restart]);

  // Manual, rarely-used escape hatch (see backend/server.py's /notice) --
  // fetched once on load rather than polled, since this is meant for "heads
  // up before you start" (e.g. bracing for a reset-time rush), not a live
  // status indicator that needs to update mid-session.
  const [siteNotice, setSiteNotice] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/notice`)
      .then((res) => res.json())
      .then((data) => setSiteNotice(data.message ?? null))
      .catch(() => {});
  }, []);

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // Symmetric open/close (not "open once, dismiss manually") so a restart
  // -- which resets board.status back to "playing" -- automatically
  // retracts a stale modal with no extra plumbing at the restart/connect
  // call sites, matching how noticeQueue/consumedNoticesRef already detect
  // "board was reset for a new attempt" elsewhere in this file.
  const [showWinModal, setShowWinModal] = useState(false);
  const wasPlayerWinRef = useRef(false);
  useEffect(() => {
    const isPlayerWin = board.status === "win" && board.playerWon === true;
    if (isPlayerWin !== wasPlayerWinRef.current) setShowWinModal(isPlayerWin);
    wasPlayerWinRef.current = isPlayerWin;
  }, [board.status, board.playerWon]);

  const [showLossModal, setShowLossModal] = useState(false);
  const wasLossRef = useRef(false);
  useEffect(() => {
    const isLoss = board.status === "loss";
    if (isLoss !== wasLossRef.current) setShowLossModal(isLoss);
    wasLossRef.current = isLoss;
  }, [board.status]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [detailCard, setDetailCard] = useState<CardRef | null>(null);
  const [priorityOn, setPriorityOn] = useState(false);
  const [pileView, setPileView] = useState<PileView | null>(null);
  const [pendingFinalChoice, setPendingFinalChoice] = useState<number | null>(null);
  // Extra Deck (Link/Xyz/Synchro/Fusion) summons never emit a "summoning"/
  // "spsummoning" event before their "place" prompt -- only effect-triggered
  // special summons do -- so board.placingCard is unset for them. This is
  // the client-side fallback: whichever card's Summon/Set/Special Summon
  // choice was just committed, kept alive only for the "place" prompt that
  // immediately follows it.
  const [committedCard, setCommittedCard] = useState<CardRef | null>(null);
  // Tracks the previous prompt's kind so committedCard can be cleared only
  // once placement is actually done -- it needs to survive every intermediate
  // prompt in between (e.g. a select_unselect for materials) on the way to
  // the eventual "place" prompt, not just the very next one.
  const prevPromptKindRef = useRef<string | undefined>(undefined);

  // A Summon/Set whose target zone is still a client-side guess -- see
  // locationIdForPlacementAction/guessOpenZones. `chosenSequence` stays null
  // while the player can still freely Cancel (nothing sent to the server
  // yet); once they click a guessed zone it's set and this becomes a
  // "waiting for the server's real place prompt to confirm or correct the
  // guess" marker instead (see the effect below).
  interface PendingPlacementState extends PendingPlacementView {
    idx: number;
    chosenSequence: number | null;
  }
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacementState | null>(null);

  function startPlacement(card: CardRef, idx: number, action: string) {
    const locationId = locationIdForPlacementAction(action);
    if (locationId === null) {
      respond({ choice: idx });
      return;
    }
    const isFieldSpell = locationId === LOC.SZONE && card.type !== undefined && Boolean(card.type & TYPE_FIELD);
    setPendingPlacement({
      card, idx, locationId,
      label: placementLabel(action, isFieldSpell),
      openSequences: guessOpenZones(board, locationId, isFieldSpell),
      chosenSequence: null,
    });
  }

  function handleGuessedZoneClick(sequence: number) {
    if (!pendingPlacement) return;
    setCommittedCard(pendingPlacement.card);
    respond({ choice: pendingPlacement.idx });
    setPendingPlacement({ ...pendingPlacement, chosenSequence: sequence });
  }

  function handleCancelPlacement() {
    setPendingPlacement(null);
  }

  // Once the server's real "place" prompt comes back for a zone the player
  // already picked locally, auto-confirm it there so they don't have to
  // click twice -- the server is still the authority: if our guess doesn't
  // actually appear among its real options (a lock we couldn't have known
  // about client-side), this just backs off and lets the normal place-prompt
  // UI show the *real* legal zones instead.
  useEffect(() => {
    if (!pendingPlacement || pendingPlacement.chosenSequence === null) return;
    if (prompt?.prompt !== "place") return;
    const options = prompt!.options as { controller: number; location_id: number; sequence: number }[];
    const matchIdx = options.findIndex((o) => o.controller === 0
      && o.location_id === pendingPlacement.locationId && o.sequence === pendingPlacement.chosenSequence);
    if (matchIdx !== -1 && (prompt!.count as number) === 1) {
      respond({ indices: [matchIdx] });
    }
    setPendingPlacement(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, pendingPlacement]);

  useEffect(() => {
    setMenu(null);
    setConfirmAction(null);
    setSelection([]);
    setPendingFinalChoice(null);
    const currentKind = prompt?.prompt as string | undefined;
    if (prevPromptKindRef.current === "place" && currentKind !== "place") {
      setCommittedCard(null);
    }
    prevPromptKindRef.current = currentKind;
  }, [prompt]);

  // Queue of opponent activations still waiting for their own glow+notice
  // turn, plus `current` (the one actually being shown right now). This is
  // a queue and not just a single slot because multiple opponent cards can
  // chain in quick succession -- e.g. Futsu reborning Murakumo immediately
  // opens Murakumo's own "if Special Summoned" trigger as a second
  // activation on the very same tick -- and each one still needs its own
  // full glow-then-notice cycle instead of a later one silently replacing
  // an earlier one that was never actually shown.
  interface NoticeItem { card: CardRef; chainLink?: number; board: BoardState }
  const [noticeQueue, setNoticeQueue] = useState<NoticeItem[]>([]);
  const [current, setCurrent] = useState<NoticeItem | null>(null);
  const [revealed, setRevealed] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enqueue every new opponent activation -- deliberately never overwrites
  // `current` or anything already queued. Reads board.chainNotices (an
  // append-only log the reducer builds, one entry per "chaining" event --
  // see boardState.ts) rather than watching board.currentChainLocation for
  // transitions: several WS messages (and their setBoard calls) can land in
  // the same React commit, and a watcher keyed on a single scalar's identity
  // would only ever see the last of those, silently dropping the rest (e.g.
  // Murakumo's own trigger, opened by Futsu reborning it on the same tick,
  // never getting its own notice). Diffing against how many of the log's
  // entries have already been queued catches all of them regardless.
  const consumedNoticesRef = useRef(0);
  useEffect(() => {
    const all = board.chainNotices;
    if (all.length < consumedNoticesRef.current) {
      // The log is shorter than what we've already consumed -- board was
      // reset for a new attempt (useDuelSocket's connect()), not a normal
      // append. Drop anything left over from the previous attempt instead
      // of getting stuck thinking every future entry was already consumed.
      consumedNoticesRef.current = 0;
      setNoticeQueue([]);
      setCurrent(null);
    }
    if (consumedNoticesRef.current >= all.length) return;
    const fresh = all.slice(consumedNoticesRef.current);
    consumedNoticesRef.current = all.length;
    setNoticeQueue((q) => [...q, ...fresh]);
  }, [board.chainNotices]);

  // Advance the queue once we're free to show the next one. The reveal
  // timer here (like the old single-slot version) deliberately isn't tied
  // to a cleanup keyed on board changes -- the chain a queued activation
  // belongs to can fully resolve server-side (chain_end) faster than the 2s
  // reveal window, and it must still get its full glow duration and still
  // require an explicit acknowledgment either way.
  useEffect(() => {
    if (current || noticeQueue.length === 0) return;
    setCurrent(noticeQueue[0]);
    setNoticeQueue((q) => q.slice(1));
    setRevealed(false);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRevealed(true);
      revealTimerRef.current = null;
    }, 2000);
  }, [current, noticeQueue]);

  // Only for real unmount, not every board update -- see the note above.
  useEffect(() => {
    return () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); };
  }, []);

  const promptKind = prompt?.prompt as string | undefined;
  // Is the *live*, current decision point a chain response opportunity the
  // opponent's activation just opened for the player? Derived from live
  // board state (not `notice`) so it's never stale once the chain actually
  // ends or a different, player-caused chain starts -- `notice`/`revealed`
  // above are purely about the notice's own display timing, decoupled from
  // whether a real response is still pending. Forced responses always show
  // the real interactive prompt regardless of the toggle.
  const liveOpponentChain = board.currentChainLocation?.controller === 1;
  const liveChainResponse = promptKind === "chain" && prompt?.player === 0 && liveOpponentChain;
  const showInteractiveOverlay = liveChainResponse && revealed && (prompt?.can_pass === false || priorityOn);
  // Toggle off (or nothing for the player to respond with at all, e.g. a
  // simultaneous trigger that only the opponent could act on) -- once
  // revealed, show the passive notice instead.
  const showResolvingModal = current !== null && revealed && !showInteractiveOverlay;
  // True whenever there's a pending opponent-activation notice (the current
  // one, or anything still queued behind it) that hasn't been resolved yet
  // and we're not instead handing the player a direct interactive chain
  // response. In all of these states, whatever the *actual* current server
  // prompt is (chain, yesno, effectyn, a follow-up card selection, ...) must
  // stay completely hidden -- otherwise a further decision belonging to the
  // same activation (e.g. Murakumo's discard-or-negate yesno) renders on
  // top of / at the same time as the glow or the notice, instead of only
  // appearing once that's dismissed. Gating on `current` alone (not the
  // rest of the queue) is deliberate: once the front of the queue is
  // dismissed, whatever's next takes its own turn on the next render.
  const promptHeldForNotice = current !== null && !showInteractiveOverlay;
  // Every other piece of prompt-driven UI below (Board's own rendering,
  // SelectionBar, PromptOverlay, ...) is keyed off this instead of the raw
  // `prompt` so a held prompt is treated as if nothing were pending yet.
  const effectivePrompt = promptHeldForNotice ? null : prompt;
  const effectivePromptKind = effectivePrompt?.prompt as string | undefined;

  // Priority toggle OFF: whenever a quick-effect window opens (an optional
  // "chain" prompt -- activate something now, or pass), skip the prompt and
  // pass immediately instead of asking -- this is meant for always-available
  // quick effects (e.g. a hand monster's "banish X; Special Summon this")
  // that merely happen to be legal right now, not anything that actually
  // just happened. fresh_trigger (see duel_engine.py's MSG_SELECT_CHAIN
  // handling) means at least one offered card's own state just changed --
  // a genuine simultaneous trigger -- and those must always be shown,
  // toggle or not, since silently passing them means they never happen at
  // all rather than just skipping a response window. Opponent-caused chains
  // are handled separately above (via the "Resolving X" modal, which waits
  // for an explicit OK instead of silently auto-passing).
  useEffect(() => {
    if (priorityOn || liveChainResponse) return;
    if (prompt?.prompt === "chain" && prompt.can_pass === true && prompt.player === 0
        && !prompt.fresh_trigger) {
      respond({ pass: true });
    }
  }, [prompt, priorityOn, liveChainResponse, respond]);

  const isBoardPrompt = effectivePromptKind !== undefined && BOARD_PROMPTS.has(effectivePromptKind);
  const isModalPrompt = effectivePrompt !== null && !isBoardPrompt;

  function handleCardMenu(card: CardRef, options: { option: IdleBattleOption; idx: number }[], x: number, y: number) {
    if (options.length === 1) {
      const { option, idx } = options[0];
      if (isPlacementAction(option.action)) {
        startPlacement(card, idx, option.action);
        return;
      }
      if (needsConfirm(option.action)) {
        setConfirmAction({ label: confirmLabel(option.action, card.name), action: option.action, idx, card });
        return;
      }
      setCommittedCard(card);
      respond({ choice: idx });
      return;
    }
    setMenu({ card, options, x, y });
  }

  function handleSelectToggle(idx: number) {
    if (!prompt) return;
    setSelection((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      const max = prompt.max as number;
      if (prev.length < max) return [...prev, idx];
      // Already at the limit -- swap in the new pick instead of requiring
      // the old one to be manually unselected first.
      return [...prev.slice(1), idx];
    });
  }

  function handlePlaceChoice(idx: number) {
    if (!prompt) return;
    const count = prompt.count as number;
    // Deliberately not a setSelection(prev => ...) updater: React StrictMode
    // (dev only) double-invokes those, and respond() living inside one meant
    // a single click could send the answer twice -- see the guard in
    // useDuelSocket's respond() for the full story. Reading `selection`
    // directly here is safe precisely because this function isn't itself a
    // setState updater.
    if (selection.includes(idx)) {
      setSelection(selection.filter((i) => i !== idx));
      return;
    }
    const next = [...selection, idx];
    if (next.length >= count) {
      respond({ indices: next });
      setSelection([]);
    } else {
      setSelection(next);
    }
  }

  function handleChainChoice(idx: number) {
    setCurrent(null);
    respond({ choice: idx });
  }

  function handleChainPass() {
    setCurrent(null);
    respond({ pass: true });
  }

  function handleUnselectChoice(idx: number) {
    if (!prompt) return;
    if (pendingFinalChoice === idx) {
      // Clicking the held card again backs out of the pending state without
      // ever telling the server about it.
      setPendingFinalChoice(null);
      return;
    }
    const items = (prompt.items as { already_selected?: boolean }[]) ?? [];
    const isAdding = !items[idx]?.already_selected;
    const remainingToAdd = items.filter((i) => !i.already_selected).length;
    if (isAdding && remainingToAdd === 1 && Boolean(prompt.can_finish)) {
      // This is the last available material -- hold off sending it so the
      // player can still cancel instead of instantly consuming everything
      // the moment the last candidate is picked.
      setPendingFinalChoice(idx);
      return;
    }
    respond({ choice: idx });
  }

  const nonCard = (isBoardPrompt ? nonCardOptions(effectivePrompt) : []).filter(({ option }) => !HIDDEN_ACTIONS.has(option.action));
  const isMultiSelect = effectivePromptKind !== undefined && MULTI_SELECT_PROMPTS.has(effectivePromptKind);
  // Prefer the prompt's own "source" (the card whose effect is asking,
  // attached server-side -- see duel_engine.py's chain_source()) over the
  // client-tracked board.currentChainCard: with simultaneous/nested chain
  // links, several "chaining" events can arrive (or get batched by React)
  // before this exact prompt is rendered, leaving board.currentChainCard
  // pointing at a *later* link than the one this prompt is actually for.
  // The fallback stays for prompt kinds that don't carry "source" (e.g. the
  // "chain" prompt itself, which lists its own per-option cards instead).
  const promptSource = (effectivePrompt?.source as CardRef | undefined) ?? board.currentChainCard;
  // Selection prompts generated for a summon do not belong to the last card
  // on the chain.  In particular, after Double Summon resolves that stale
  // chain card used to make Brionac's material picker read as though Double
  // Summon were requesting the selection.
  const forWhom = effectivePrompt?.source && effectivePromptKind !== "sum" && effectivePromptKind !== "select_unselect"
    ? ` for ${(effectivePrompt.source as CardRef).name}`
    : "";
  const requiredSumMaterials = effectivePromptKind === "sum"
    ? ((effectivePrompt?.must_include as CardRef[] | undefined) ?? [])
    : [];
  const sumLabel = requiredSumMaterials.length
    ? `Select materials totaling ${effectivePrompt?.target} (already selected: ${requiredSumMaterials.map((card) => card.name).join(", ")})`
    : `Select materials totaling ${effectivePrompt?.target}`;

  // What the *board* actually renders: while an opponent-activation notice
  // is up, freeze on that notice's own snapshot (see chainNotices in
  // boardState.ts) instead of the live board -- the server resolves a whole
  // chain (e.g. Futsu reborning Murakumo, which immediately destroys the
  // player's monsters) in one uninterrupted burst with nothing for a human
  // to decide in between, so the live board would otherwise already show
  // the end result before the Futsu/Murakumo notices ever got their turn.
  // Every other piece of logic below (legal-zone guessing, prompts, ...)
  // deliberately keeps reading the live `board`, not this -- only what's
  // actually painted on screen should lag.
  const displayBoard = current?.board ?? board;

  function handlePhaseClick(x: number, y: number) {
    if (nonCard.length === 0) return;
    if (nonCard.length === 1) {
      respond({ choice: nonCard[0].idx });
      return;
    }
    setMenu({ options: nonCard, x, y });
  }

  return (
    <div className="app">
      <div className="orientation-gate">
        <span className="orientation-gate-icon" aria-hidden="true">📱</span>
        <h2>Rotate your device</h2>
        <p>This puzzle needs a landscape screen to play.</p>
      </div>

      <header className="app-header">
        <h1>Duel Puzzdle</h1>
        <div className="connection-status">
          <span className={`dot ${connected ? "connected" : "disconnected"}`} />
          {connected ? "Connected" : "Disconnected"}
        </div>
        <ResetCountdown />
        <AuthPanel user={user} accessToken={session?.access_token} signInWithEmail={signInWithEmail} signOut={signOut} />
      </header>

      <div className="side-controls">
        <button
          className={`priority-toggle ${priorityOn ? "on" : "off"}`}
          onClick={(e) => { setPriorityOn((v) => !v); e.currentTarget.blur(); }}
          title="When OFF, priority is passed automatically whenever a quick effect could be activated, and opponent activations resolve without a chance to respond"
        >
          <span className="priority-toggle-label">Toggle</span>
          <span className="priority-toggle-state">{priorityOn ? "ON" : "OFF"}</span>
        </button>

        <button className="restart-button" onClick={restart} title="Restart the puzzle (R)">
          <span className="restart-button-label">Restart</span>
          <span className="restart-button-key">R</span>
        </button>

        <button className="btn small" onClick={() => setShowLeaderboard(true)} title="Today's top solvers">
          Leaderboard
        </button>

        <button className="btn small" onClick={() => setShowFeedback(true)} title="Report a bug or suggest a puzzle">
          Feedback
        </button>
      </div>

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {showWinModal && (
        <WinModal
          winSummary={board.winSummary}
          communityPosition={board.communityPosition}
          claimToken={board.claimToken}
          signInWithEmail={signInWithEmail}
          onClose={() => setShowWinModal(false)}
        />
      )}

      {showLossModal && (
        <LossModal
          onRestart={() => { setShowLossModal(false); restart(); }}
          onViewBoard={() => setShowLossModal(false)}
        />
      )}

      {claimResult && (
        <div className="modal-backdrop">
          <div className="modal">
            {"position" in claimResult ? (
              <>
                <h3>🎉 Win saved!</h3>
                <p>You finished {ordinal(claimResult.position)} today.</p>
              </>
            ) : (
              <>
                <h3>Couldn't save your win</h3>
                <p className="error-banner">{claimResult.error}</p>
              </>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setClaimResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {usernameResult && (
        <div className="modal-backdrop">
          <div className="modal">
            {"name" in usernameResult ? (
              <>
                <h3>Username saved!</h3>
                <p>You're now signed in as {usernameResult.name}.</p>
              </>
            ) : (
              <>
                <h3>Couldn't set your username</h3>
                <p className="error-banner">{usernameResult.error}</p>
                <p className="dim">You're still signed in -- you can pick a name anytime via Rename in the header.</p>
              </>
            )}
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setUsernameResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {siteNotice && <div className="notice-banner">{siteNotice}</div>}

      {error ? (
        <div className="error-banner">
          <strong>Could not load puzzle:</strong> {error.message}
          {error.suggestions && Object.entries(error.suggestions).map(([name, options]) => (
            <div key={name}>
              '{name}' not found. Close matches: {options.map((o) => o.name).join(", ")}
            </div>
          ))}
        </div>
      ) : null}

      {displayBoard.status !== "playing" && (
        <div className={`status-banner ${displayBoard.status}`}>{displayBoard.statusMessage}</div>
      )}

      <main className="app-main">
        <Board
          board={displayBoard}
          prompt={effectivePrompt}
          selection={selection}
          onCardMenu={handleCardMenu}
          onSelectToggle={handleSelectToggle}
          onUnselectChoice={handleUnselectChoice}
          onPlaceChoice={handlePlaceChoice}
          onChainChoice={handleChainChoice}
          onChainPass={handleChainPass}
          onPhaseClick={handlePhaseClick}
          canChangePhase={nonCard.length > 0}
          onCardDetail={setDetailCard}
          pileView={pileView}
          setPileView={setPileView}
          pendingFinalChoice={pendingFinalChoice}
          placingCardFallback={committedCard}
          pendingPlacement={pendingPlacement && pendingPlacement.chosenSequence === null ? pendingPlacement : null}
          onGuessedZoneClick={handleGuessedZoneClick}
          onCancelPlacement={handleCancelPlacement}
        />
        <CardDetailPanel card={detailCard} />
      </main>

      {isMultiSelect && effectivePrompt && !pileView && (
        <SelectionBar
          label={effectivePromptKind === "sum" ? sumLabel : `Select ${effectivePromptKind}${forWhom}`}
          count={selection.length}
          min={effectivePrompt.min as number}
          max={effectivePrompt.max as number}
          canConfirm={selection.length >= (effectivePrompt.min as number) && selection.length <= (effectivePrompt.max as number)}
          onConfirm={() => respond({ indices: selection })}
        />
      )}

      {effectivePromptKind === "select_unselect" && effectivePrompt && !pileView && (
        <SelectionBar
          label={`Select/unselect cards${forWhom}`}
          count={
            (effectivePrompt.items as { already_selected?: boolean }[]).filter((i) => i.already_selected).length +
            (pendingFinalChoice !== null ? 1 : 0)
          }
          min={effectivePrompt.min as number}
          max={effectivePrompt.max as number}
          canConfirm={pendingFinalChoice !== null}
          onConfirm={() => { respond({ choice: pendingFinalChoice }); setPendingFinalChoice(null); }}
          canFinish={Boolean(effectivePrompt.can_finish)}
          finishLabel={pendingFinalChoice !== null ? "Cancel" : "Finish"}
          onFinish={() => { respond({ finish: true }); setPendingFinalChoice(null); }}
        />
      )}

      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={menu.options}
          disableOutsideClose={confirmAction !== null}
          onChoose={(idx) => {
            const chosen = menu.options.find((o) => o.idx === idx);
            if (chosen && isPlacementAction(chosen.option.action)) {
              const c = chosen.option.card ?? menu.card;
              if (c) {
                startPlacement(c, idx, chosen.option.action);
                setMenu(null);
                return;
              }
            }
            if (chosen && needsConfirm(chosen.option.action)) {
              setConfirmAction({
                label: confirmLabel(chosen.option.action, chosen.option.card?.name ?? "this card"),
                action: chosen.option.action,
                idx,
                card: chosen.option.card ?? menu.card,
              });
              return;
            }
            if (chosen?.option.card ?? menu.card) setCommittedCard(chosen?.option.card ?? menu.card ?? null);
            respond({ choice: idx });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmAction && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>{confirmAction.label}</h3>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  if (confirmAction.card) setCommittedCard(confirmAction.card);
                  respond({ choice: confirmAction.idx });
                  setConfirmAction(null);
                  setMenu(null);
                }}
              >
                Yes
              </button>
              <button className="btn" onClick={() => setConfirmAction(null)}>
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {showResolvingModal && current && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>
              Resolving {current.card.name}
              {current.chainLink !== undefined ? ` (chain link ${current.chainLink})` : ""}
            </h3>
            <div className="modal-card">
              <CardTile card={current.card} />
            </div>
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  if (liveChainResponse && prompt?.can_pass === true) respond({ pass: true });
                  setCurrent(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalPrompt && effectivePrompt && <PromptOverlay prompt={effectivePrompt} respond={respond} contextCard={promptSource} />}
    </div>
  );
}
