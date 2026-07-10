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
  // The card whose effect is currently resolving on the chain, if any --
  // generic yes/no prompts (MSG_SELECT_YESNO) carry no card reference of
  // their own, so this is the best available hint for "what is this asking
  // about" while one is showing.
  currentChainCard?: CardRef;
  // The card currently being summoned, between "summoning"/"spsummoning"
  // and the "place" prompt that asks where -- shown alone in the hand row
  // while placement is in progress, whether it actually came from hand or
  // not (banished/GY/Extra Deck).
  placingCard?: CardRef;
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

    case "chaining":
      return { ...board, currentChainCard: item.card as CardRef };

    case "chain_end":
      return { ...board, currentChainCard: undefined };

    case "win":
      return { ...board, status: "win", statusMessage: item.winner === 0 ? "You win!" : "Opponent wins." };

    case "loss":
      return { ...board, status: "loss", statusMessage: (item.message as string) ?? "Puzzle not solved." };

    case "duel_ended":
    case "unsupported":
    case "unhandled":
      return { ...board, status: "ended", statusMessage: (item.message as string) ?? event };

    default:
      return board;
  }
}
