# Duel Puzzdle

**A daily Yu-Gi-Oh! dueling puzzle, in the spirit of Wordle.**

Every day brings a new pre-set duel: a fixed board, a fixed hand, and one real solution. Find the exact sequence of plays that wins the duel — under the real rules, against a real (if occasionally ruthless) opponent AI.

🔗 **Play it now: [duelpuzzdle.xyz](https://duelpuzzdle.xyz)**

<!-- IMAGE 1: A screenshot of the main board mid-puzzle (desktop view), showing
     the field, hand, and card detail panel. This is the "hero" shot -- insert
     it right below this line. -->

## What makes it different

Most Yu-Gi-Oh "puzzles" you find online are just descriptions — you read the board state and work it out on paper. Duel Puzzdle actually **plays out**: every card interaction, every chain, every ruling is resolved by the genuine Yu-Gi-Oh duel engine, the same one real simulators are built on. If your line doesn't respect priority, timing, or a card's actual wording, it won't work — exactly like the real game.

- 🕹️ **A real duel engine, not a simulation of one.** The backend embeds [ygopro-core](https://github.com/Fluorohydride/ygopro-core) (the open-source C++ engine used by real Yu-Gi-Oh duel simulators) together with the official [ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) card scripts, driven live over a WebSocket. Every card behaves exactly as it does in the real game — full chains, quick effects, negation windows, the works.
- 🧩 **One new puzzle a day**, rotating at 4pm Eastern — everyone gets the same board on the same day.
- 🏆 **Leaderboard** for today's puzzle, with optional sign-in to track your record.
- 📱 **Playable on desktop and mobile.**

<!-- IMAGE 2: Optional -- a screenshot of the leaderboard or the win modal
     after solving a puzzle. Insert it here if you want a second image; skip
     this section entirely if one hero image is enough. -->

## How it works

Each day's puzzle is authored as a simple Python file describing the board: what's on each field, what's in each hand, what's face-down, what's in the graveyard. That file is loaded straight into a live instance of the real duel engine, so from the very first move you're playing against actual game rules, not a hand-written approximation of them.

## Tech stack

| | |
|---|---|
| **Frontend** | React + TypeScript + Vite, deployed on Vercel |
| **Backend** | FastAPI (Python) over WebSocket, deployed on Render |
| **Duel engine** | [ygopro-core](https://github.com/Fluorohydride/ygopro-core) (C++, via ctypes) + [ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) |
| **Auth / leaderboard** | Supabase |
| **Analytics** | Vercel Web Analytics |

## Running it locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
cp local_config.example.py local_config.py   # point this at your own ygopro-core/ygopro-scripts checkout
uvicorn server:app --reload
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Acknowledgments

- [Fluorohydride/ygopro-core](https://github.com/Fluorohydride/ygopro-core) and [Fluorohydride/ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) — the real duel engine and card scripts this project is built on.
- Card data sourced from the official [ygopro-database](https://github.com/mycard/ygopro-database).
- Built with [Claude](https://claude.com).

## License

*(add a license here if you want this repo to have one)*
