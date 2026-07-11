import type { CardRef, Location } from "./protocol";

export const LOC = {
  DECK: 1,
  HAND: 2,
  MZONE: 4,
  SZONE: 8,
  GY: 16,
  BANISHED: 32,
  EXTRA: 64,
  OVERLAY: 128,
};

export const POS = {
  FACEUP_ATTACK: 0x1,
  FACEDOWN_ATTACK: 0x2,
  FACEUP_DEFENSE: 0x4,
  FACEDOWN_DEFENSE: 0x8,
};

const TYPE_LINK = 0x4000000;
export const TYPE_FIELD = 0x80000;
// Sequence 5 in the Spell/Trap zone row is the Field Zone -- separate from
// the 5 regular Spell/Trap zones (0-4) and only ever legal for Field Spells.
export const FIELD_ZONE_SEQ = 5;

export interface ZoneCard extends CardRef {
  position?: number;
}

export interface BoardState {
  lp: { 0: number; 1: number };
  turnPlayer: number;
  phase: string;
  zones: Record<string, ZoneCard>;
  hand: { 0: ZoneCard[]; 1: ZoneCard[] };
  deck: { 0: ZoneCard[]; 1: number };
  extra: { 0: ZoneCard[]; 1: number };
  gy: { 0: ZoneCard[]; 1: ZoneCard[] };
  banished: { 0: ZoneCard[]; 1: ZoneCard[] };
  status: "playing" | "win" | "loss" | "ended";
  statusMessage: string;
  // Only meaningful once status === "win" -- the "win" event fires for
  // either side (server.py/duel_engine.py's MSG_WIN carries whichever
  // player actually won), so this disambiguates "you won" from "the
  // opponent won" for anything that should only react to the former (e.g.
  // the win modal/leaderboard recording).
  playerWon?: boolean;
  // Only set when playerWon is true. undefined = not a player win yet;
  // null = signed-in-eligible win but no leaderboard data (anonymous
  // player, or the backend's record_win call failed) -- both cases show a
  // congrats-only modal with no rank/position.
  winSummary?: { rank: number | null; overall_position: number | null } | null;
  // A rough "X people have solved this" count, set whenever playerWon is
  // true regardless of sign-in status -- not tamper-resistant (see
  // server.py's record_completion), so only ever used as a fallback
  // display for anonymous players, never as the real leaderboard position.
  communityPosition?: number | null;
  // The card whose effect is currently resolving on the chain, if any --
  // generic yes/no prompts (MSG_SELECT_YESNO) carry no card reference of
  // their own, so this is the best available hint for "what is this asking
  // about" while one is showing.
  currentChainCard?: CardRef;
  // Where that card is chaining from -- in particular `.controller` tells
  // the UI whether the *opponent* just activated something (used to trigger
  // the enlarge-on-activation cue and, when the priority toggle is off, to
  // show a passive "Resolving X" notice instead of a real response prompt).
  currentChainLocation?: Location;
  // The chain link number the currently-chaining card occupies -- flashed on
  // the enlarge cue so it's clear *which* link in the chain is resolving.
  currentChainLink?: number;
  // Append-only log of every opponent-controlled "chaining" event seen this
  // duel, in order -- App.tsx's notice queue drains this (tracking how many
  // it has already consumed) instead of watching currentChainLocation via a
  // useEffect. Deriving the queue from a *reducer-appended* array rather
  // than detecting a scalar's transitions is what makes it immune to
  // multiple WS messages landing in the same React batch: applyEvent runs
  // once per message regardless of batching, so every entry still lands
  // here even when several "chaining" events are committed together (e.g.
  // Futsu reborning Murakumo triggers Murakumo's own "if Special Summoned"
  // effect on the same tick) -- a watcher keyed on the *current* scalar
  // would only ever observe the last of those and silently drop the rest.
  //
  // Each entry also carries a full board *snapshot*, taken at the instant
  // that card's own "chaining" event fired (its own currentChain* fields
  // updated, but nothing about what its effect actually *does* applied
  // yet). The server resolves the whole chain -- Futsu reborning Murakumo,
  // Murakumo's own "if Special Summoned" trigger destroying the player's
  // monsters -- in one uninterrupted burst of events with no prompt in
  // between (nothing for a human to decide), so if the display just
  // tracked live board state, all of that would land on screen before the
  // 2s-per-notice reveal pacing ever caught up: monsters would appear
  // destroyed before the Futsu/Murakumo notices even showed. Rendering
  // from `current.board` (see App.tsx) while a notice is up freezes the
  // visible board at that link's moment instead, so each notice's glow and
  // popup reflect what the board actually looked like when it fired --
  // the live board only becomes visible again once every notice has been
  // dismissed.
  chainNotices: { card: CardRef; chainLink?: number; board: BoardState }[];
  // The card currently being summoned, between "summoning"/"spsummoning"
  // and the "place" prompt that asks where -- shown alone in the hand row
  // while placement is in progress, whether it actually came from hand or
  // not (banished/GY/Extra Deck).
  placingCard?: CardRef;
}

// Best-effort, client-side guess at which of the player's own zones are
// open, used only to let a Summon/Set action show its zone-glow (and a free
// Cancel) *before* the choice is sent to the server -- the server is still
// the sole authority once a guessed zone is actually clicked (see App.tsx's
// pendingPlacement auto-confirm effect, which falls back to the real
// "place" prompt if this guess turns out wrong, e.g. an unusual zone lock
// this couldn't know about). Field Spells can *only* go in the Field Zone
// (sequence 5), never the 5 regular Spell/Trap zones (0-4) -- guessing the
// wrong set here is exactly what let a Field Spell show the ordinary
// zones as selectable.
export function guessOpenZones(board: BoardState, locationId: number, isFieldSpell: boolean): number[] {
  if (isFieldSpell) {
    return board.zones[zoneKey(0, LOC.SZONE, FIELD_ZONE_SEQ)] ? [] : [FIELD_ZONE_SEQ];
  }
  const open: number[] = [];
  for (let sequence = 0; sequence < 5; sequence++) {
    if (!board.zones[zoneKey(0, locationId, sequence)]) open.push(sequence);
  }
  return open;
}

export function zoneKey(controller: number, locationId: number, sequence: number): string {
  return `${controller}:${locationId}:${sequence}`;
}

export function createInitialBoard(): BoardState {
  return {
    lp: { 0: 8000, 1: 8000 },
    turnPlayer: 0,
    phase: "",
    zones: {},
    hand: { 0: [], 1: [] },
    deck: { 0: [], 1: 0 },
    extra: { 0: [], 1: 0 },
    gy: { 0: [], 1: [] },
    banished: { 0: [], 1: [] },
    status: "playing",
    statusMessage: "",
    chainNotices: [],
  };
}

function removeByCode(list: ZoneCard[], code: number): ZoneCard[] {
  const idx = list.findIndex((c) => c.code === code);
  if (idx === -1) return list;
  const copy = list.slice();
  copy.splice(idx, 1);
  return copy;
}

function removeFrom(board: BoardState, loc: Location, code: number): BoardState {
  const b = { ...board };
  switch (loc.location_id) {
    case LOC.MZONE:
    case LOC.SZONE: {
      const zones = { ...b.zones };
      delete zones[zoneKey(loc.controller, loc.location_id, loc.sequence)];
      b.zones = zones;
      break;
    }
    case LOC.HAND:
      b.hand = { ...b.hand, [loc.controller]: removeByCode(b.hand[loc.controller as 0 | 1], code) } as typeof b.hand;
      break;
    case LOC.DECK:
      if (loc.controller === 0) {
        b.deck = { ...b.deck, 0: removeByCode(b.deck[0], code) };
      } else {
        b.deck = { ...b.deck, 1: Math.max(0, b.deck[1] - 1) };
      }
      break;
    case LOC.EXTRA:
      if (loc.controller === 0) {
        b.extra = { ...b.extra, 0: removeByCode(b.extra[0], code) };
      } else {
        b.extra = { ...b.extra, 1: Math.max(0, b.extra[1] - 1) };
      }
      break;
    case LOC.GY:
      b.gy = { ...b.gy, [loc.controller]: removeByCode(b.gy[loc.controller as 0 | 1], code) } as typeof b.gy;
      break;
    case LOC.BANISHED:
      b.banished = { ...b.banished, [loc.controller]: removeByCode(b.banished[loc.controller as 0 | 1], code) } as typeof b.banished;
      break;
    default:
      break;
  }
  return b;
}

function addTo(board: BoardState, loc: Location, card: ZoneCard): BoardState {
  const b = { ...board };
  switch (loc.location_id) {
    case LOC.MZONE:
    case LOC.SZONE: {
      const zones = { ...b.zones };
      zones[zoneKey(loc.controller, loc.location_id, loc.sequence)] = { ...card, position: loc.position };
      b.zones = zones;
      break;
    }
    case LOC.HAND:
      b.hand = { ...b.hand, [loc.controller]: [...b.hand[loc.controller as 0 | 1], card] } as typeof b.hand;
      break;
    case LOC.DECK:
      if (loc.controller === 0) {
        b.deck = { ...b.deck, 0: [...b.deck[0], card] };
      } else {
        b.deck = { ...b.deck, 1: b.deck[1] + 1 };
      }
      break;
    case LOC.EXTRA:
      if (loc.controller === 0) {
        b.extra = { ...b.extra, 0: [...b.extra[0], card] };
      } else {
        b.extra = { ...b.extra, 1: b.extra[1] + 1 };
      }
      break;
    case LOC.GY:
      b.gy = { ...b.gy, [loc.controller]: [...b.gy[loc.controller as 0 | 1], card] } as typeof b.gy;
      break;
    case LOC.BANISHED:
      b.banished = { ...b.banished, [loc.controller]: [...b.banished[loc.controller as 0 | 1], card] } as typeof b.banished;
      break;
    default:
      break;
  }
  return b;
}

export function applyEvent(board: BoardState, item: Record<string, unknown>): BoardState {
  const event = item.event as string;

  switch (event) {
    case "board_state": {
      let b = createInitialBoard();
      const lp = item.lp as { player: number; opponent: number };
      b.lp = { 0: lp.player, 1: lp.opponent };
      const opponentField = item.opponent_field as { card: CardRef; zone: number; position: string }[];
      const playerField = (item.player_field ?? []) as { card: CardRef; zone: number; position: string }[];
      const zones: Record<string, ZoneCard> = {};
      for (const entry of opponentField) {
        zones[zoneKey(1, LOC.MZONE, entry.zone)] = {
          ...entry.card,
          position: entry.position === "attack" ? POS.FACEUP_ATTACK : POS.FACEUP_DEFENSE,
        };
      }
      for (const entry of playerField) {
        zones[zoneKey(0, LOC.MZONE, entry.zone)] = {
          ...entry.card,
          position: entry.position === "attack" ? POS.FACEUP_ATTACK : POS.FACEUP_DEFENSE,
        };
      }
      b.zones = zones;
      b.hand = { 0: item.player_hand as CardRef[], 1: [] };
      b.deck = { 0: item.player_deck as CardRef[], 1: 0 };
      b.extra = { 0: item.player_extra as CardRef[], 1: 0 };
      b.banished = { 0: (item.player_banished ?? []) as CardRef[], 1: [] };
      b.gy = { 0: [], 1: (item.opponent_graveyard ?? []) as CardRef[] };
      return b;
    }

    case "new_turn":
      return { ...board, turnPlayer: item.player as number };

    case "new_phase":
      return { ...board, phase: item.phase as string };

    case "lp_update": {
      const player = item.player as number;
      return { ...board, lp: { ...board.lp, [player]: item.lp as number } as typeof board.lp };
    }

    // The engine reports these as deltas rather than always following up
    // with an authoritative "lp_update" -- apply the delta ourselves. If an
    // "lp_update" does arrive later for the same change, it just overwrites
    // with the same (already correct) total, so this is safe either way.
    case "damage":
    case "pay_lpcost": {
      const player = item.player as number;
      const amount = (item.amount ?? item.cost) as number;
      const current = board.lp[player as 0 | 1];
      return { ...board, lp: { ...board.lp, [player]: Math.max(0, current - amount) } as typeof board.lp };
    }

    case "recover": {
      const player = item.player as number;
      const amount = item.amount as number;
      const current = board.lp[player as 0 | 1];
      return { ...board, lp: { ...board.lp, [player]: current + amount } as typeof board.lp };
    }

    case "move": {
      const card = item.card as CardRef;
      const from = item.from as Location;
      const to = item.to as Location;
      let b = removeFrom(board, from, card.code);
      b = addTo(b, to, card);
      return b;
    }

    case "pos_change": {
      const card = item.card as CardRef;
      const position = item.position as number;
      const zones = { ...board.zones };
      for (const key of Object.keys(zones)) {
        if (zones[key].code === card.code) {
          zones[key] = { ...zones[key], position };
        }
      }
      return { ...board, zones };
    }

    case "draw": {
      const player = item.player as number;
      const cards = item.cards as CardRef[];
      if (player === 0) {
        let deck0 = board.deck[0];
        for (const card of cards) deck0 = removeByCode(deck0, card.code);
        return {
          ...board,
          hand: { ...board.hand, 0: [...board.hand[0], ...cards] },
          deck: { ...board.deck, 0: deck0 },
        };
      }
      return board;
    }

    case "stats_update": {
      const updates = item.cards as { controller: number; sequence: number; attack: number; defense: number }[];
      const zones = { ...board.zones };
      for (const u of updates) {
        const key = zoneKey(u.controller, LOC.MZONE, u.sequence);
        const existing = zones[key];
        if (!existing) continue;
        // Link Monsters have no DEF -- get_atk_def() always reports 0 for
        // them, which would otherwise clobber the "hide DEF" convention
        // (existing.defense left undefined/-1) used elsewhere for display.
        const isLink = existing.type !== undefined && (existing.type & TYPE_LINK) !== 0;
        zones[key] = { ...existing, attack: u.attack, ...(isLink ? {} : { defense: u.defense }) };
      }
      return { ...board, zones };
    }

    case "summoning":
    case "spsummoning":
      return { ...board, placingCard: item.card as CardRef };

    case "summoned":
    case "spsummoned":
      return { ...board, placingCard: undefined };

    case "chaining": {
      const card = item.card as CardRef;
      const location = item.location as Location;
      const chainLink = item.chain_link as number;
      // This card's own currentChain* fields are updated *before* the
      // snapshot is taken, so the frozen board a notice shows already has
      // this card glowing/flagged as the active link -- see the
      // chainNotices field comment for why the snapshot exists at all.
      const withChainState: BoardState = { ...board, currentChainCard: card,
        currentChainLocation: location, currentChainLink: chainLink };
      const chainNotices = location.controller === 1
        ? [...board.chainNotices, { card, chainLink, board: withChainState }]
        : board.chainNotices;
      return { ...withChainState, chainNotices };
    }

    case "chain_end":
      return { ...board, currentChainCard: undefined, currentChainLocation: undefined, currentChainLink: undefined };

    case "win": {
      const isPlayerWin = item.winner === 0;
      const lb = item.leaderboard as { rank: number | null; overall_position: number | null } | null | undefined;
      return {
        ...board,
        status: "win",
        statusMessage: isPlayerWin ? "You win!" : "Opponent wins.",
        playerWon: isPlayerWin,
        winSummary: isPlayerWin ? (lb ?? null) : undefined,
        // Separate from winSummary -- a rough "X people have solved this"
        // count, not tamper-resistant (no dedup for anonymous replays), so
        // it's only ever a fallback for display when there's no real
        // (signed-in) position.
        communityPosition: isPlayerWin ? ((item.community_position as number | null | undefined) ?? null) : undefined,
      };
    }

    case "loss":
      return { ...board, status: "loss", statusMessage: (item.message as string) ?? "Puzzle not solved." };

    case "duel_ended":
    case "unsupported":
    case "unhandled":
      // The server always sends duel_ended right after win/loss (the
      // generator naturally exhausting is just the next step once a duel
      // is decided) -- without this guard it silently clobbered the real
      // result with "no more messages from the engine" every single time.
      if (board.status === "win" || board.status === "loss") return board;
      return { ...board, status: "ended", statusMessage: (item.message as string) ?? event };

    default:
      return board;
  }
}
