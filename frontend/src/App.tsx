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
import ArchiveModal from "./components/ArchiveModal";
import FeedbackModal from "./components/FeedbackModal";
import WelcomeBackModal from "./components/WelcomeBackModal";
import LossModal from "./components/LossModal";
import WinModal, { ordinal, CLAIM_QUERY_PARAM } from "./components/WinModal";
import { USERNAME_QUERY_PARAM } from "./components/SignInForm";
import { idleOptionLabel, nonCardOptions } from "./interaction";
import { selectCardText } from "./effectText";
import { LOC, POS, TYPE_FIELD, guessOpenZones, type BoardState, type ZoneCard } from "./boardState";
import { API_URL, WS_URL } from "./config";
import { msUntilNextRotation } from "./resetTime";
import type { CardRef, IdleBattleOption } from "./protocol";

const TYPE_MONSTER = 0x1;

// A set Spell/Trap's *own* position (FACEDOWN_ATTACK/FACEDOWN_DEFENSE bits,
// per the engine's Spell/Trap-zone convention -- see boardState.ts) --
// distinguishes it from a face-down Set Monster, which already gets its own
// "always show the menu" treatment via Change Position and shouldn't also
// match this.
function isFaceDownSpellTrap(card: CardRef | undefined): boolean {
  if (!card || card.type === undefined || card.type & TYPE_MONSTER) return false;
  const position = (card as ZoneCard).position;
  return position !== undefined && Boolean((position & POS.FACEDOWN_ATTACK) || (position & POS.FACEDOWN_DEFENSE));
}

// Field-zone idle options aren't deduped by category (see
// idleBattleOptionsFor's docstring) -- a card that registers more than one
// independently-activatable ignition effect (e.g. Ancient City - Rainbow
// Ruins) legitimately offers 2+ separate "Activate" entries for the exact
// same card/location. Grouping by action here is what lets the menu show
// one "Activate" button (opening a follow-up picker) instead of N
// identically-labeled ones. Hand-card options are already deduped
// server-adjacent (idleBattleOptionsFor's own dedupeByCategory), so this is
// a no-op there -- every group ends up size 1.
// Activate reads as the primary action for a Spell/Trap in hand -- shown
// first (Set last), rather than the engine's own idlecmd ordering (Set
// before Activate). Array.sort is stable, so this only reorders Activate/Set
// relative to each other and leaves every other action's relative order
// (e.g. a monster's Summon/Change Position/Set) untouched.
function menuActionPriority(action: string): number {
  return action === "Activate" ? -1 : action === "Set" ? 1 : 0;
}

function groupMenuOptions(options: { option: IdleBattleOption; idx: number }[]) {
  const order: string[] = [];
  const groups = new Map<string, { option: IdleBattleOption; idx: number }[]>();
  for (const entry of options) {
    const key = entry.option.action;
    let list = groups.get(key);
    if (!list) { list = []; groups.set(key, list); order.push(key); }
    list.push(entry);
  }
  const sortedOrder = [...order].sort((a, b) => menuActionPriority(a) - menuActionPriority(b));
  return sortedOrder.map((action) => ({ action, entries: groups.get(action) as { option: IdleBattleOption; idx: number }[] }));
}

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

// "Change Position" spelled by destination -- the menu opens from a specific
// board card (a ZoneCard, so its live position is on it), and "To Defense"
// reads much clearer than a direction-less "Change Position".
function repositionLabel(card: CardRef | undefined): string {
  const pos = (card as ZoneCard | undefined)?.position;
  if (pos === undefined) return "Change Position";
  return (pos & POS.FACEUP_ATTACK) || (pos & POS.FACEDOWN_ATTACK) ? "To Defense" : "To Attack";
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
  materials?: CardRef[];
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
  const { board, prompt, connected, error, connect, respond, retried } = useDuelSocket(WS_URL, () => session?.access_token);

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

  // Which archived puzzle (see ArchiveModal) is currently being played, or
  // null for today's live puzzle. Purely a client-side viewing choice --
  // the server already refuses to record leaderboard credit for anything
  // but the actual current date (see server.py's is_current_puzzle), this
  // just drives the UI (disabling the Leaderboard button, the archive
  // banner below, and which puzzle the rotation/restart effects replay).
  const [viewingDate, setViewingDate] = useState<string | null>(null);
  // Mirrors viewingDate for the rotation-reconnect effect below, which
  // fires from a setTimeout closure created once at mount (deps: [connect]
  // only) and would otherwise only ever see the null it captured then.
  const viewingDateRef = useRef<string | null>(null);
  useEffect(() => { viewingDateRef.current = viewingDate; }, [viewingDate]);

  function goToPuzzle(date: string | null) {
    setViewingDate(date);
    connect(date);
  }

  // Auto-reconnect the instant today's puzzle rotates (see ResetCountdown,
  // which shares this same boundary) -- without this, a tab left open past
  // midnight Eastern would just silently keep playing/showing yesterday's
  // puzzle until the player manually refreshed. Deliberately reconnects
  // unconditionally, mid-attempt or not: a puzzle-of-the-day is meant to
  // become a new puzzle-of-the-day the moment the day turns over, same as
  // reloading the page would get you. Skipped entirely while viewing an
  // archived puzzle -- that's a deliberate, purely client-side choice (see
  // viewingDate above), and forcibly yanking the player back to today the
  // moment the clock rolls over would undo it with no warning.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    function scheduleNext() {
      // +1s past the exact boundary so the backend's own "today" (computed
      // independently, server-side, off its own clock) has unambiguously
      // rolled over by the time this fires.
      timeoutId = setTimeout(() => {
        if (viewingDateRef.current === null) connect();
        scheduleNext();
      }, msUntilNextRotation() + 1000);
    }
    scheduleNext();
    return () => clearTimeout(timeoutId);
  }, [connect]);

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
  const [showArchive, setShowArchive] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  // One-time announcement modal, gated on a versioned localStorage key so
  // it shows once per new message (bump the suffix to re-show it to
  // everyone) rather than nagging on every single visit.
  const WELCOME_BACK_KEY = "welcomeBackSeen_2026-08-13b";
  const [showWelcomeBack, setShowWelcomeBack] = useState(
    () => localStorage.getItem(WELCOME_BACK_KEY) !== "1",
  );
  function dismissWelcomeBack() {
    localStorage.setItem(WELCOME_BACK_KEY, "1");
    setShowWelcomeBack(false);
  }

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
  // A field card can register more than one independently-activatable
  // ignition effect (e.g. Ancient City - Rainbow Ruins: Special Summon a
  // Crystal Beast, or draw a card) -- idlecmd offers each as its own
  // "Activate" entry with the same card/location, which ActionMenu collapses
  // into a single "Activate" button (see menuGroups below); clicking it opens
  // this follow-up picker instead of dispatching straight to the server.
  const [effectPicker, setEffectPicker] = useState<{ card: CardRef; items: { option: IdleBattleOption; idx: number }[] } | null>(null);
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
    const openSequences = guessOpenZones(board, locationId, isFieldSpell);
    // Nothing currently looks open -- for a Monster Zone Summon this means
    // a Tribute Summon (every zone occupied, so a tribute is unavoidable
    // before any zone can free up); for the Field Zone it means one's
    // already there. Either way the guess can't possibly be right yet, so
    // skip the client-side "pick a zone right now" overlay entirely and
    // fall back to the same confirm-then-ask-server path Special
    // Summon/Activate already use -- the server asks for tributes first,
    // then sends the real "place" prompt once a zone has genuinely opened
    // up. Without this, clicking Summon on a full field showed a zone
    // picker with nothing in it to click, and the summon choice itself was
    // never even sent to the server (reproduced live: no tribute prompt,
    // no way to proceed at all).
    if (openSequences.length === 0) {
      respond({ choice: idx });
      return;
    }
    setPendingPlacement({
      card, idx, locationId,
      label: placementLabel(action, isFieldSpell),
      openSequences,
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
    setEffectPicker(null);
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

  // The player's own activation gets the same ~2s glow cue as an opponent's
  // (see Board.tsx's enlargedKey), but not the opponent's manual-OK
  // "Resolving X" modal -- the player already knows what they just did. What
  // it's still missing without this: nothing held back the *next* prompt
  // (a follow-up cost/target selection, a token's place/position choice, a
  // fresh chain offer, anything) from rendering immediately, so a fast click
  // could race right past the player's own animation. See holdForPlayerGlow
  // below. Declared up here (above the reset-detection effect that follows)
  // so that effect can clear it on a fresh attempt -- see its own comment.
  const [playerGlowActive, setPlayerGlowActive] = useState(false);
  const playerGlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Frozen board snapshot for the player's own glow window, same idea as
  // the opponent notice queue's `current.board` (see displayBoard below) --
  // without this, a same-batch response from the opponent (e.g. Back to the
  // Front chaining onto Brilliant Fusion) already shows face-up on the live
  // board *during* the player's own flash, since board.zones updates
  // unconditionally the instant its own events land, regardless of glow
  // pacing. The opponent's own reveal already happened, invisibly, before
  // its own notice ever got a chance to show it -- reproduced live as the
  // set trap "just kinda flipping over" with no visible reveal moment: by
  // the time its glow appeared, the board had already looked that way for
  // however long the player's own flash had been showing.
  const [playerGlowBoard, setPlayerGlowBoard] = useState<BoardState | null>(null);

  // Enqueue every new opponent activation -- deliberately never overwrites
  // `current` or anything already queued. Reads board.chainNotices (an
  // append-only log the reducer builds, one entry per "chaining" event,
  // either controller -- see boardState.ts) rather than watching
  // board.currentChainLocation for transitions: several WS messages (and
  // their setBoard calls) can land in the same React commit, and a watcher
  // keyed on a single scalar's identity would only ever see the last of
  // those, silently dropping the rest (e.g. Murakumo's own trigger, opened
  // by Futsu reborning it on the same tick, never getting its own notice).
  // Diffing against how many of the log's entries have already been
  // consumed catches all of them regardless. Filtered to controller 1 here
  // -- the player's own entries are consumed separately below, by
  // playerGlowActive's own effect, off the same shared log.
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
    const fresh = all.slice(consumedNoticesRef.current).filter((n) => n.controller === 1);
    consumedNoticesRef.current = all.length;
    if (fresh.length === 0) return;
    setNoticeQueue((q) => [...q, ...fresh]);
  }, [board.chainNotices]);

  // Advance the queue once we're free to show the next one. The reveal
  // timer here (like the old single-slot version) deliberately isn't tied
  // to a cleanup keyed on board changes -- the chain a queued activation
  // belongs to can fully resolve server-side (chain_end) faster than the 2s
  // reveal window, and it must still get its full glow duration and still
  // require an explicit acknowledgment either way.
  useEffect(() => {
    // Also wait out the player's own glow window (if one's active) before
    // advancing -- without this, a same-batch opponent response (e.g. Back
    // to the Front chaining onto Brilliant Fusion) started showing its own
    // notice *simultaneously* with the player's flash instead of after it,
    // since the two are otherwise fully independent timers racing off the
    // same underlying chainNotices log.
    if (current || noticeQueue.length === 0 || playerGlowActive) return;
    setCurrent(noticeQueue[0]);
    setNoticeQueue((q) => q.slice(1));
    setRevealed(false);
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRevealed(true);
      revealTimerRef.current = null;
    }, 1000);
  }, [current, noticeQueue, playerGlowActive]);

  // Only for real unmount, not every board update -- see the note above.
  useEffect(() => {
    return () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); };
  }, []);

  // Arms/re-arms playerGlowActive on every new chaining event belonging to
  // the player -- off the same chainNotices log the opponent-notice queue
  // above reads, filtered to controller 0 instead of 1. Not
  // board.currentChainLocation: that scalar is what this used to watch, and
  // it silently missed any activation that resolved with nothing further
  // to ask (Allure of Darkness, Double Summon, ...) -- its own "chaining"
  // and the immediately-following "chain_end" (which resets the scalar
  // back to undefined) land in the same React batch, so a scalar-watching
  // effect only ever observes the post-chain_end state and never fires at
  // all. This has its own consumed-count ref (independent of
  // consumedNoticesRef above) since the two effects filter the same shared
  // log for different controllers and must not race each other's progress
  // through it.
  const consumedPlayerGlowRef = useRef(0);
  useEffect(() => {
    const all = board.chainNotices;
    if (all.length < consumedPlayerGlowRef.current) {
      // Reset for a new attempt -- see consumedNoticesRef's identical
      // branch above. Without this, Restart clicked mid-flash left
      // playerGlowActive stuck true for the rest of the attempt (nothing
      // ever arms/clears it again), permanently holding every future
      // prompt (reproduced live: resolved fine through the tokens, then
      // nothing -- not even the idle Main Phase menu -- ever interactive
      // again).
      consumedPlayerGlowRef.current = 0;
      if (playerGlowTimerRef.current) { clearTimeout(playerGlowTimerRef.current); playerGlowTimerRef.current = null; }
      setPlayerGlowActive(false);
      setPlayerGlowBoard(null);
    }
    if (consumedPlayerGlowRef.current >= all.length) return;
    const fresh = all.slice(consumedPlayerGlowRef.current).filter((n) => n.controller === 0);
    consumedPlayerGlowRef.current = all.length;
    if (fresh.length === 0) return;
    // Only the hold window matters here (unlike the opponent queue, nothing
    // needs to visibly show each entry in turn) -- (re)arm once for
    // whichever of this batch is latest. Its snapshot (taken at that link's
    // own "chaining" moment, before any later event in the same batch --
    // e.g. an opponent's chained response -- had a chance to apply) is what
    // displayBoard freezes on below, so nothing that happens *after* this
    // link shows up early.
    if (playerGlowTimerRef.current) clearTimeout(playerGlowTimerRef.current);
    setPlayerGlowActive(true);
    setPlayerGlowBoard(fresh[fresh.length - 1].board);
    playerGlowTimerRef.current = setTimeout(() => {
      setPlayerGlowActive(false);
      setPlayerGlowBoard(null);
      playerGlowTimerRef.current = null;
    }, 1000);
  }, [board.chainNotices]);
  useEffect(() => {
    return () => { if (playerGlowTimerRef.current) clearTimeout(playerGlowTimerRef.current); };
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
  // During the player's own activation glow (playerGlowActive, above), hold
  // back every prompt kind, deliberately with no carve-out for "this is just
  // a required continuation of the card that's already flashing" -- the
  // point is that *nothing* progresses (a follow-up cost/target selection,
  // a token's place/position choice, a fresh chain offer, anything) while
  // the animation is still showing, so it never reads as "the effect
  // already resolved before I even saw it flash." A prompt held this way
  // isn't lost -- the raw `prompt` state is untouched, it just isn't handed
  // to the UI as `effectivePrompt` until the ~2s window elapses, at which
  // point it renders exactly as it would have immediately.
  const holdForPlayerGlow = playerGlowActive;
  // Every other piece of prompt-driven UI below (Board's own rendering,
  // SelectionBar, PromptOverlay, ...) is keyed off this instead of the raw
  // `prompt` so a held prompt is treated as if nothing were pending yet.
  const effectivePrompt = (promptHeldForNotice || holdForPlayerGlow) ? null : prompt;
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

  function dispatchIdleChoice(card: CardRef, option: IdleBattleOption, idx: number) {
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
  }

  function handleCardMenu(
    card: CardRef,
    options: { option: IdleBattleOption; idx: number }[],
    x: number,
    y: number,
    materials?: CardRef[],
  ) {
    const hasMaterials = (materials?.length ?? 0) > 0;
    // A field monster with neither an activatable effect nor materials
    // right now falls straight through here with nothing to do -- callers
    // only invoke onCardMenu when there's at least one of the two.
    if (options.length === 0 && hasMaterials) {
      setPileView({ label: `${card.name}'s Materials`, cards: materials as CardRef[] });
      return;
    }
    // Change Position deliberately never auto-commits, even as a lone
    // option: a pre-placed field monster often has *only* this action, and
    // single-click instantly flipping it (with no un-do -- position changes
    // are once per turn) made merely inspecting the card destructive. It
    // always goes through the menu (with a Cancel) instead.
    //
    // Set Spell/Trap is excluded for the same "always show the menu"
    // reason, but a different underlying cause: whenever a Spell/Trap's
    // Activate condition isn't currently met (e.g. Pot of Avarice needs 5
    // GY monsters), the engine offers Set as the only option, and this
    // single-option shortcut skipped straight into zone-glow placement
    // with no menu at all -- clicking the card jumped straight to "pick a
    // zone", never showing the "Set" button a player expects to see and
    // click first (reproduced live: Pot of Avarice's own click flow looked
    // completely different from every other Spell/Trap in hand, for a
    // purely incidental reason -- its Activate wasn't legal yet, not
    // because Set/Activate menus don't apply to it).
    // A set Spell/Trap's only legal idle option is "Activate" (it can't be
    // re-Set), so this single-option shortcut always skipped straight past
    // the menu into needsConfirm's Yes/No modal -- reproduced live, it read
    // as though clicking a facedown card had no Cancel step at all (the
    // modal's "No" button is one, but nothing about it signals that the way
    // an explicit Activate/Cancel menu does). Every other single-option
    // card here really is a one-shot ignition effect with nothing to pick
    // between; a facedown Spell/Trap is the one case where skipping the
    // menu hides a real, expected click-through step.
    const alwaysShowsMenu = options[0].option.action === "Change Position"
      || options[0].option.action === "Set Spell/Trap"
      || (isFaceDownSpellTrap(card) && options[0].option.action === "Activate");
    if (options.length === 1 && !hasMaterials && !alwaysShowsMenu) {
      dispatchIdleChoice(card, options[0].option, options[0].idx);
      return;
    }
    setMenu({ card, options, materials, x, y });
  }

  function handleSelectToggle(idx: number) {
    if (!prompt) return;
    // Not a setSelection(prev => ...) updater -- same reasoning as
    // handlePlaceChoice below: StrictMode (dev only) double-invokes those,
    // and respond() living inside one would risk a single click sending the
    // answer twice.
    if (selection.includes(idx)) {
      setSelection(selection.filter((i) => i !== idx));
      return;
    }
    const max = prompt.max as number;
    if (selection.length < max) {
      // Always wait for an explicit SelectionBar Confirm click, even at an
      // exact-count pick (e.g. a Tribute Summon's tribute count, or a
      // Synchro's material step) -- consistent with every other selection
      // flow (Extra Deck summons, select_unselect) instead of auto-sending
      // the instant the count is hit, which let one misclick lock in a
      // wrong choice with no chance to reconsider before it's sent.
      setSelection([...selection, idx]);
      return;
    }
    // Already at the limit with room to swap -- swap in the new pick
    // instead of requiring the old one to be manually unselected first.
    setSelection([...selection.slice(1), idx]);
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
  // Card-select prompts ("card"/"tribute"/"select_unselect") carry no
  // effect text of their own -- see effectText.ts's SELECT_CARD_TEXT -- so
  // a card with an otherwise-ambiguous selection (e.g. Riryoku: which of
  // these 2 targets is the one that gets halved?) gets a curated
  // label/note instead of the generic "Select card for X". Riryoku's own
  // targeting specifically comes through as "select_unselect" (its 2-of-N
  // SelectSubGroup allows toggling between combinations), not a plain
  // "card" prompt.
  const curatedSelect = (effectivePromptKind === "card" || effectivePromptKind === "tribute" || effectivePromptKind === "select_unselect")
    ? selectCardText((effectivePrompt?.source as CardRef | undefined)?.code, effectivePrompt)
    : null;

  // What the *board* actually renders: while an opponent-activation notice
  // is up, freeze on that notice's own snapshot (see chainNotices in
  // boardState.ts) instead of the live board -- the server resolves a whole
  // chain (e.g. Futsu reborning Murakumo, which immediately destroys the
  // player's monsters) in one uninterrupted burst with nothing for a human
  // to decide in between, so the live board would otherwise already show
  // the end result before the Futsu/Murakumo notices ever got their turn.
  // playerGlowBoard is the same idea for the player's own flash (checked
  // second, since current -- an opponent notice -- only ever starts once
  // playerGlowActive has cleared; see that queue-advance effect). Every
  // other piece of logic below (legal-zone guessing, prompts, ...)
  // deliberately keeps reading the live `board`, not this -- only what's
  // actually painted on screen should lag.
  const displayBoard = current?.board ?? playerGlowBoard ?? board;
  // Whether Board.tsx's own enlarge/glow cue should be showing at all --
  // NOT the same thing as displayBoard resolving to a frozen snapshot vs.
  // the live board. currentChainLocation (what Board derives enlargedKey
  // from) only gets cleared by chain_end, so once the notice/flash window
  // below ends and displayBoard falls back to the live `board`, that scalar
  // is still sitting there set for the entire rest of the chain's
  // resolution (e.g. through a follow-up cost/target-selection prompt on
  // the same card) -- reproduced live as the glow staying "stuck" on
  // through a whole selection phase instead of playing its normal ~1s
  // pulse and clearing. Gating on the two windows that actually manage
  // their own timing (the opponent-notice queue's `current`, until
  // dismissed, and `playerGlowActive`'s 1s timer) keeps the glow scoped to
  // just that.
  const chainGlowActive = current !== null || playerGlowActive;

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
        <div className="header-brand">
          <h1>Duel Puzzdle</h1>
          {board.puzzleTitle && <span className="puzzle-title">{board.puzzleTitle}</span>}
        </div>

        {/* DOM-nested inside the header (not a sibling after it) purely so
            the mobile-landscape breakpoint can lay it out as a normal flex
            child of .app-header, sitting in whatever gap is actually left
            after the (ellipsis-truncated) title instead of a hardcoded
            guess -- see the position:static override in App.css. Desktop's
            position:fixed is unaffected by DOM position (fixed elements are
            positioned against the viewport regardless of where they sit in
            the tree), so this is a no-op there. */}
        <div className="side-controls">
          <button
            className="archive-button"
            onClick={() => setShowArchive(true)}
            title="Play a previous day's puzzle (doesn't affect the leaderboard)"
          >
            🗄 Archive
          </button>

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

          <button
            className="btn small"
            onClick={() => setShowLeaderboard(true)}
            disabled={viewingDate !== null}
            title={viewingDate !== null ? "Disabled while viewing an archived puzzle" : "Today's top solvers"}
          >
            Leaderboard
          </button>

          <button className="btn small" onClick={() => setShowFeedback(true)} title="Report a bug or suggest a puzzle">
            Feedback
          </button>
        </div>

        <div className="connection-status" title={connected ? "Connected" : "Disconnected"}>
          <span className={`dot ${connected ? "connected" : "disconnected"}`} />
          <span className="connection-status-label">{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <ResetCountdown />
        <AuthPanel user={user} accessToken={session?.access_token} signInWithEmail={signInWithEmail} signOut={signOut} />
      </header>

      {showWelcomeBack && <WelcomeBackModal onClose={dismissWelcomeBack} />}

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showArchive && (
        <ArchiveModal
          currentDate={viewingDate}
          onSelect={(date) => { goToPuzzle(date); setShowArchive(false); }}
          onClose={() => setShowArchive(false)}
        />
      )}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {showWinModal && (
        <WinModal
          winSummary={board.winSummary}
          communityPosition={board.communityPosition}
          claimToken={board.claimToken}
          isArchived={viewingDate !== null}
          signInWithEmail={signInWithEmail}
          onClose={() => setShowWinModal(false)}
        />
      )}

      {showLossModal && (
        <LossModal
          message={board.statusMessage}
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

      {viewingDate !== null && (
        <div className="notice-banner archive-banner">
          <span>Viewing an archived puzzle ({viewingDate})</span>
          <button className="btn small" onClick={() => goToPuzzle(null)}>Back to Today</button>
        </div>
      )}

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
          glowActive={chainGlowActive}
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
          label={curatedSelect?.label ?? (effectivePromptKind === "sum" ? sumLabel : `Select ${effectivePromptKind}${forWhom}`)}
          count={selection.length}
          min={effectivePrompt.min as number}
          max={effectivePrompt.max as number}
          canConfirm={selection.length >= (effectivePrompt.min as number) && selection.length <= (effectivePrompt.max as number)}
          onConfirm={() => respond({ indices: selection })}
          canFinish={effectivePromptKind === "tribute" && Boolean(effectivePrompt.can_cancel)}
          finishLabel="Cancel"
          onFinish={() => respond({ cancel: true })}
          rejected={retried}
          note={curatedSelect?.note}
        />
      )}

      {effectivePromptKind === "select_unselect" && effectivePrompt && !pileView && (
        <SelectionBar
          label={curatedSelect?.label ?? `Select/unselect cards${forWhom}`}
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
          rejected={retried}
          note={curatedSelect?.note}
        />
      )}

      {menu && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          items={[
            ...(menu.materials && menu.materials.length > 0
              ? [{
                  key: "materials",
                  label: "View Materials",
                  onClick: () => {
                    setPileView({ label: `${menu.card?.name ?? "Card"}'s Materials`, cards: menu.materials as CardRef[] });
                    setMenu(null);
                  },
                }]
              : []),
            ...groupMenuOptions(menu.options).map(({ action, entries }) => {
              // A lone entry for this action dispatches straight through, as
              // before. 2+ entries sharing one action (e.g. Ancient City -
              // Rainbow Ruins' 2 separate "Activate" ignition effects) means
              // the field genuinely can't distinguish them without a
              // follow-up picker -- collapse to one button that opens it.
              if (entries.length > 1 && menu.card) {
                const card = menu.card;
                return {
                  key: action,
                  label: idleOptionLabel(entries[0].option),
                  onClick: () => {
                    setEffectPicker({ card, items: entries });
                    setMenu(null);
                  },
                };
              }
              const { option, idx } = entries[0];
              return {
                key: idx,
                label: option.action === "Change Position"
                  ? repositionLabel(menu.card)
                  : idleOptionLabel(option),
                onClick: () => {
                  const c = option.card ?? menu.card;
                  // Card-less options (battle_phase/end_phase from the phase
                  // menu) go straight to the server -- they have no placement
                  // or confirm step to dispatch through.
                  if (c) dispatchIdleChoice(c, option, idx);
                  else respond({ choice: idx });
                  setMenu(null);
                },
              };
            }),
            // Change Position never auto-commits (see handleCardMenu) and is
            // once per turn, so its menu gets an explicit way to back out --
            // clicking anywhere outside still closes it too. Same reasoning
            // for a face-down Spell/Trap's lone "Activate", and for a
            // grouped multi-effect "Activate" that opens the picker below --
            // see isFaceDownSpellTrap.
            ...(menu.options.some(({ option }) => option.action === "Change Position")
              || isFaceDownSpellTrap(menu.card)
              || groupMenuOptions(menu.options).some((g) => g.entries.length > 1)
              ? [{ key: "cancel", label: "Cancel", onClick: () => setMenu(null) }]
              : []),
          ]}
          disableOutsideClose={confirmAction !== null}
          onClose={() => setMenu(null)}
        />
      )}

      {effectPicker && (
        <PromptOverlay
          prompt={{
            prompt: "option",
            options: effectPicker.items.map(({ option }) => option.desc ?? 0),
            card: effectPicker.card,
          }}
          respond={(response) => {
            const { option, idx } = effectPicker.items[response.choice as number];
            dispatchIdleChoice(option.card ?? effectPicker.card, option, idx);
            setEffectPicker(null);
          }}
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
