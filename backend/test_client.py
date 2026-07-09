"""
Console test client for the FastAPI WebSocket wrapper -- proves the
engine <-> network <-> client round trip works before any React frontend
exists. Same terminal UX as the old play_puzzle script (type a number,
press enter), except every choice now travels over a websocket as JSON
instead of being read directly by ctypes in-process.

Usage:
    python test_client.py [ws://host:port/ws]
"""
import asyncio
import json
import sys

import websockets

DEFAULT_URL = "ws://127.0.0.1:8000/ws"


def card_label(card):
    return card["name"] if card else "?"


def prompt_choice(n, label="choice"):
    while True:
        raw = input(f"  enter {label} (0-{n - 1}): ").strip()
        if raw.isdigit() and 0 <= int(raw) < n:
            return int(raw)
        print("  invalid input, try again")


def render_event(item):
    event = item.get("event")
    if event == "new_turn":
        who = "(you)" if item["player"] == 0 else "(opponent)"
        print(f"\n=== Turn: player {item['player']} {who} ===")
    elif event == "new_phase":
        print(f"--- {item['phase']} ---")
    elif event == "draw":
        who = "You" if item["player"] == 0 else "Opponent"
        names = ", ".join(card_label(c) for c in item["cards"])
        print(f"{who} drew {len(item['cards'])} card(s): {names}")
    elif event == "move":
        print(f"{card_label(item['card'])} moved.")
    elif event == "summoning":
        print(f"Summoning {card_label(item['card'])}...")
    elif event == "summoned":
        print("...summon resolved.")
    elif event == "spsummoning":
        print(f"Special summoning {card_label(item['card'])}...")
    elif event == "spsummoned":
        print("...special summon resolved.")
    elif event == "chaining":
        print(f"Activating {card_label(item['card'])} (chain link {item['chain_link']}, desc {item['desc']})")
    elif event == "chain_end":
        print("Chain fully resolved.")
    elif event == "attack":
        if item["target"]:
            print("Attack declared on a monster.")
        else:
            print("Direct attack declared.")
    elif event == "battle":
        print(f"Battle: {item['attacker_atk']} ATK vs {item['defender_atk']} ATK / {item['defender_def']} DEF")
    elif event == "damage":
        who = "You" if item["player"] == 0 else "Opponent"
        print(f"{who} took {item['amount']} damage")
    elif event == "lp_update":
        who = "You" if item["player"] == 0 else "Opponent"
        print(f"{who}'s LP set to {item['lp']}")
    elif event == "win":
        who = "You" if item["winner"] == 0 else "Opponent"
        print(f"\n*** {who} WIN! (reason code {item['reason']}) ***")
    elif event == "loss":
        print(f"\n*** LOSS: {item['message']} ***")
    elif event == "retry":
        print("  (that wasn't a legal choice for this decision -- try again)")
    elif event == "puzzle_loaded":
        print(f"\nPuzzle loaded. {item['win_condition']}\n")
    else:
        print(f"[{event}] {item}")


def build_response(item):
    prompt = item["prompt"]

    if item.get("error"):
        print(f"  ({item['error']})")
    if item.get("note"):
        print(f"  ({item['note']})")

    if prompt in ("yesno", "effectyn"):
        label = card_label(item.get("card")) if prompt == "effectyn" else None
        header = f"Activate effect of {label}?" if label else "Yes/No prompt"
        print(f"\n[player {item['player']}] {header} (desc {item['desc']})")
        choice = prompt_choice(2, "0=No, 1=Yes")
        return {"choice": choice}

    if prompt == "option":
        print(f"\n[player {item['player']}] Select an option:")
        for i, opt in enumerate(item["options"]):
            print(f"  {i}: option (desc {opt})")
        return {"choice": prompt_choice(len(item["options"]), "option")}

    if prompt == "position":
        print(f"\n[player {item['player']}] Select a position for {card_label(item['card'])}:")
        for i, name in enumerate(item["options"]):
            print(f"  {i}: {name}")
        return {"choice": prompt_choice(len(item["options"]), "position")}

    if prompt in ("idlecmd", "battlecmd"):
        print(f"\n[player {item['player']}] {'Main phase' if prompt == 'idlecmd' else 'Battle phase'} "
              f"-- what would you like to do?")
        for i, opt in enumerate(item["options"]):
            action = opt["action"]
            if "card" in opt:
                print(f"  {i}: {action}: {card_label(opt['card'])}")
            else:
                print(f"  {i}: {action}")
        return {"choice": prompt_choice(len(item["options"]), "option")}

    if prompt in ("card", "tribute"):
        print(f"\n[player {item['player']}] Select {item['min']}-{item['max']} {prompt}(s):")
        for i, c in enumerate(item["items"]):
            print(f"  {i}: {card_label(c)}")
        chosen = []
        while len(chosen) < item["max"]:
            if len(chosen) >= item["min"]:
                raw = input("  enter index to add (or blank to finish): ").strip()
                if raw == "":
                    break
                if not raw.isdigit() or int(raw) in chosen or not (0 <= int(raw) < len(item["items"])):
                    print("  invalid"); continue
                chosen.append(int(raw))
            else:
                idx = prompt_choice(len(item["items"]), f"card {len(chosen) + 1}/{item['min']}")
                if idx in chosen:
                    print("  already chosen"); continue
                chosen.append(idx)
        return {"indices": chosen}

    if prompt == "chain":
        print(f"\n[player {item['player']}] Chain window -- activate an effect?")
        for i, opt in enumerate(item["options"]):
            tag = " (forced)" if opt.get("forced") else ""
            print(f"  {i}: Activate {card_label(opt['card'])} (desc {opt['desc']}){tag}")
        if item.get("can_pass"):
            print("  -1: Don't activate anything (pass)")
        while True:
            raw = input("  enter choice: ").strip()
            if raw == "-1" and item.get("can_pass"):
                return {"pass": True}
            if raw.isdigit() and 0 <= int(raw) < len(item["options"]):
                return {"choice": int(raw)}
            print("  invalid input, try again")

    if prompt == "place":
        print(f"\n[player {item['player']}] Select {item['count']} place(s) to put the card:")
        for i, label in enumerate(item["options"]):
            print(f"  {i}: {label}")
        chosen = []
        for pick_i in range(item["count"]):
            chosen.append(prompt_choice(len(item["options"]), f"place {pick_i + 1}/{item['count']}"))
        return {"indices": chosen}

    if prompt == "select_unselect":
        print(f"\n[player {item['player']}] Select/unselect a card ({item['min']}-{item['max']} total):")
        for i, c in enumerate(item["items"]):
            tag = " (already selected)" if c.get("already_selected") else ""
            print(f"  {i}: {card_label(c)}{tag}")
        if item.get("can_finish"):
            print("  -1: Finish/cancel")
        while True:
            raw = input("  enter choice: ").strip()
            if raw == "-1" and item.get("can_finish"):
                return {"finish": True}
            if raw.isdigit() and 0 <= int(raw) < len(item["items"]):
                return {"choice": int(raw)}
            print("  invalid input, try again")

    if prompt == "sum":
        print(f"\n[player {item['player']}] Select cards summing to {item['target']}:")
        if item["must_include"]:
            print("  (must include:", ", ".join(card_label(c) for c in item["must_include"]), ")")
        for i, c in enumerate(item["options"]):
            print(f"  {i}: {card_label(c)}")
        chosen = []
        raw = input("  enter indices comma-separated: ").strip()
        if raw:
            chosen = [int(x) for x in raw.split(",") if x.strip().isdigit()]
        return {"indices": chosen}

    if prompt == "counter":
        print(f"\n[player {item['player']}] Distribute {item['total']} counter(s) among:")
        for i, c in enumerate(item["items"]):
            print(f"  {i}: {card_label(c)} (has {c['current']})")
        alloc = [0] * len(item["items"])
        remaining = item["total"]
        while remaining > 0:
            idx = prompt_choice(len(item["items"]), "card index to allocate a counter to")
            if alloc[idx] >= item["items"][idx]["current"]:
                print("  can't allocate more than that card has"); continue
            alloc[idx] += 1
            remaining -= 1
        return {"allocation": alloc}

    if prompt in ("announce_race", "announce_attrib"):
        label = "race" if prompt == "announce_race" else "attribute"
        print(f"\n[player {item['player']}] Announce {item['count']} {label}(s) "
              f"(available bitmask {hex(item['available'])}):")
        raw = input(f"  enter {label} bitmask to declare: ").strip()
        try:
            value = int(raw, 0)
        except ValueError:
            value = 0
        return {"value": value}

    if prompt == "announce_card":
        print(f"\n[player {item['player']}] Announce a card by name:")
        return {"name": input("  enter exact card name: ").strip()}

    if prompt == "announce_number":
        print(f"\n[player {item['player']}] Announce a number:")
        for i, v in enumerate(item["options"]):
            print(f"  {i}: {v}")
        return {"choice": prompt_choice(len(item["options"]), "option")}

    if prompt == "rps":
        print(f"\n[player {item['player']}] Rock-Paper-Scissors:")
        print("  0: Rock  1: Paper  2: Scissors")
        return {"choice": prompt_choice(3, "throw")}

    raise ValueError(f"unhandled prompt type: {prompt}")


async def main(url):
    async with websockets.connect(url, max_size=None) as ws:
        while True:
            raw = await ws.recv()
            item = json.loads(raw)

            if item["type"] == "error":
                print(f"[error] {item['message']}")
                for name, options in item.get("suggestions", {}).items():
                    print(f"  '{name}' not found. Close matches:")
                    for o in options:
                        print(f"    {o['code']:>10}  {o['name']}")
                return

            if item["type"] == "event":
                render_event(item)
                if item.get("event") in ("win", "loss", "duel_ended", "unsupported", "unhandled"):
                    return
                continue

            response = build_response(item)
            await ws.send(json.dumps(response))


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    try:
        asyncio.run(main(url))
    except KeyboardInterrupt:
        pass
