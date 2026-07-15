// Mirrors the JSON contract produced by backend/duel_engine.py's `run()` generator
// and backend/server.py's WebSocket wrapper.

export interface CardRef {
  code: number;
  name: string;
  type?: number;
  attack?: number;
  defense?: number;
  level?: number;
  desc?: string;
  image_full?: string;
  image_cropped?: string;
}

export interface Location {
  controller: number;
  location: string;
  location_id: number;
  sequence: number;
  position: number;
}

export type ServerEvent =
  | { type: "error"; message: string; suggestions?: Record<string, { code: number; name: string }[]> }
  | ({ type: "event" } & AnyEvent)
  | ({ type: "prompt" } & AnyPrompt);

interface BaseEvent {
  event: string;
  [key: string]: unknown;
}

export type AnyEvent = BaseEvent;

interface BasePrompt {
  prompt: string;
  player?: number;
  error?: string;
  note?: string;
  [key: string]: unknown;
}

export type AnyPrompt = BasePrompt;

export interface BoardStateEvent {
  event: "board_state";
  lp: { player: number; opponent: number };
  opponent_field: { card: CardRef; zone: number; position: "attack" | "defense" }[];
  player_hand: CardRef[];
  player_deck_count: number;
  player_extra: CardRef[];
}

export interface IdleBattleOption {
  category: number;
  index: number;
  action: string;
  card?: CardRef;
  // Which physical card this option is for -- present whenever `card` is,
  // and needed to tell apart multiple copies of the same card (e.g. 2 in
  // hand), which otherwise share a `card.code` and would be indistinguishable.
  location?: { controller: number; location_id: number; sequence: number };
  desc?: number;
  can_attack_directly?: boolean;
}
