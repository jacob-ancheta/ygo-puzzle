# Duel Puzzdle

**A daily Yu-Gi-Oh! dueling puzzle, in the spirit of Wordle.**

Every day brings a new pre-set duel: a fixed board, a fixed hand, and one real solution. Find the exact sequence of plays that wins the duel under the real rules, against an opponent AI.

**Play it now: [duelpuzzdle.xyz](https://duelpuzzdle.xyz)**


<img width="1611" height="855" alt="image" src="https://github.com/user-attachments/assets/373d9857-5a68-4a0b-a513-c04eab7425dc" />


## How it works

- **A real duel engine, not a simulation of one.** The backend embeds [ygopro-core](https://github.com/Fluorohydride/ygopro-core) (the open-source C++ engine used by real Yu-Gi-Oh duel simulators) together with the official [ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) card scripts, driven live over a WebSocket. Every card behaves exactly as it does in the game: full chains, quick effects, negation windows, etc.
- **One new puzzle a day**, rotating at 4pm EST, everyone gets the same board on the same day.
- **Leaderboard** for today's puzzle, with optional sign-in to track your record. You get to show off all your medals each time you hit the leaderboard!
- **Playable on desktop and mobile.**

<img width="842" height="583" alt="image" src="https://github.com/user-attachments/assets/9ccd7c82-66e0-4740-9dca-8d54ad8b71e7" />

Each day's puzzle is authored as a simple Python file describing the board: what's on each field, what's in each hand, what's face-down, what's in the graveyard. That file is loaded straight into a live instance of the real duel engine, so from the very first move you're playing against actual game rules, not a hand-written approximation of them.

## Tech stack

| | |
|---|---|
| **Frontend** | React + TypeScript + Vite, deployed on Vercel |
| **Backend** | FastAPI (Python) over WebSocket, deployed on Render |
| **Duel engine** | [ygopro-core](https://github.com/Fluorohydride/ygopro-core) (C++, via ctypes) + [ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) |
| **Auth / leaderboard** | Supabase |
| **Analytics** | Vercel Web Analytics |

## Acknowledgments

- [Fluorohydride/ygopro-core](https://github.com/Fluorohydride/ygopro-core) and [Fluorohydride/ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) — the real duel engine and card scripts this project is built on.
- Assisted development with [Claude](https://claude.com).
- Card data sourced from the official [ygopro-database](https://github.com/mycard/ygopro-database).

