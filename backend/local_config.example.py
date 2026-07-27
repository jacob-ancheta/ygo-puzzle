# Copy this file to local_config.py (which is gitignored) and edit the paths
# below to match your machine's ygopro-core / ygopro-scripts checkout.

# Only needed on Windows if mingw's DLL dependencies aren't already on PATH.
MINGW_BIN = r"C:\msys64\mingw64\bin"

# Path to the compiled ygopro-core shared library (libygo.dll / libygo.so).
DLL_PATH = r"C:\path\to\ygopro-core\libygo.dll"

# Path to a checkout of ygopro-scripts (card script files).
SCRIPTS_DIR = r"C:\path\to\ygopro-scripts"

# Optional. Uncomment to let your LOCAL backend serve/play a future-dated
# puzzle file early (e.g. via the frontend's VITE_WS_URL=...?date=YYYY-MM-DD
# override), for previewing a puzzle before you push it live. Never set this
# in production -- there is no equivalent of local_config.py on Render, so
# leaving it commented out here is exactly what keeps the live site's
# future-puzzle clamp intact. A local win against a previewed puzzle still
# never touches the real leaderboard (server.py's is_current_puzzle check is
# separate and unaffected by this).
# ALLOW_FUTURE_PUZZLES = True

# Optional. Uncomment to let your LOCAL backend send the opponent's real
# Deck contents to the client (still only a count in production/on Render --
# see duel_engine.py's initial_board_state), so the opponent's Deck pile
# becomes clickable/browsable during authoring the same way the player's own
# already is. Purely a puzzle-authoring convenience for checking draw order
# -- never reveals anything to a real player, since this file doesn't exist
# outside your own machine.
# REVEAL_OPPONENT_DECK = True
