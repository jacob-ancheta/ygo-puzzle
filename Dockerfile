# syntax=docker/dockerfile:1.7
# The line above is a BuildKit parser directive, not a comment -- it MUST be
# the very first line of the file, before even this comment block, or the
# --mount=type=secret step below (which needs BuildKit) is silently ignored.

# Backend-only image (frontend is a separate static Vite build, deployed to
# Vercel rather than served from here). Proves the actual unknown in the
# deploy roadmap: does ygopro-core (the ctypes duel engine) + its Lua card
# scripts build and run on Linux at all.
#
# Both stages deliberately share the same base image (python:3.14-slim) so
# the shared library built in the first stage links against the exact same
# glibc/libstdc++ the second stage runs against -- a .so built on a newer
# base than the runtime fails to load there (undefined GLIBC_x.y symbol
# versions), so "build on whatever's convenient" isn't safe here.
#
# premake (the build tool ygopro-core's own CI uses) is deliberately not
# used: driven directly by g++ instead, replicating exactly what
# premake/lua.lua and premake/dll.lua configure. This sidesteps needing a
# prebuilt premake5 binary at all, whose own glibc requirement is an
# unrelated problem from the one this Dockerfile actually needs to solve.

# ---------- stage 1: build ygopro-core's libocgcore.so ----------
FROM python:3.14-slim AS engine-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential wget git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Lua 5.4.8, built from source (not the distro package) -- matches
# ygopro-core's own CI, and premake/lua.lua compiles it as C++
# (compileas "C++"), so a system liblua .so with C linkage wouldn't match
# the symbols ocgcore expects anyway.
RUN wget -q https://www.lua.org/ftp/lua-5.4.8.tar.gz \
    && tar -xzf lua-5.4.8.tar.gz \
    && mv lua-5.4.8 lua \
    && rm lua-5.4.8.tar.gz

# Pinned to the exact commit verified against this project (see
# backend/local_config.py's Windows counterpart) -- upstream Fluorohydride/ygopro-core.
RUN git init ygopro-core \
    && cd ygopro-core \
    && git remote add origin https://github.com/Fluorohydride/ygopro-core.git \
    && git fetch --depth 1 origin db4fd16a99991802511b9a89e0025dd2f51f5e36 \
    && git checkout FETCH_HEAD

# lua as a static lib, compiled as C++ (matches premake/lua.lua's
# `compileas "C++"` -- ocgcore's own C++ code calls into it directly, not
# through a C-linkage boundary).
WORKDIR /build/lua/src
RUN g++ -c -O2 -fPIC -DLUA_USE_LINUX -std=c++14 \
    $(ls *.c | grep -Ev '^(lua|luac|linit|onelua)\.c$') \
    && ar rcs liblua.a *.o

# ocgcore itself as a shared lib (matches premake/dll.lua: all *.cpp, PIC,
# C++14, linked against the lua static lib above).
WORKDIR /build/ygopro-core
RUN g++ -shared -fPIC -O2 -DLUA_USE_LINUX -std=c++14 \
    -I/build/lua/src \
    *.cpp /build/lua/src/liblua.a \
    -o /build/libocgcore.so

# ---------- stage 2: runtime ----------
FROM python:3.14-slim AS runtime

# libocgcore.so is a C++ shared library -- python:slim doesn't ship libstdc++
# by default. libgomp1 covers OpenMP if the engine (or its libstdc++) needs
# it; harmless to include either way.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=engine-build /build/libocgcore.so /app/libocgcore.so

# Card script data -- shallow, pinned clone of upstream Fluorohydride/ygopro-scripts
# (same pattern as the engine above; this repo is pure Lua data, no build step).
RUN git init ygopro-scripts \
    && cd ygopro-scripts \
    && git remote add origin https://github.com/Fluorohydride/ygopro-scripts.git \
    && git fetch --depth 1 origin 72a1be24bb5a4eab9af3a71e53561abcd467aff6 \
    && git checkout FETCH_HEAD \
    && rm -rf .git

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/*.py /app/backend/
COPY backend/cards.db /app/backend/cards.db

# Written here, before the puzzle clone+validate step below, since
# validate_puzzles.py needs DLL_PATH/SCRIPTS_DIR to actually load the
# engine at build time -- not just what server.py needs at startup.
RUN printf '%s\n' \
    'MINGW_BIN = ""' \
    'DLL_PATH = "/app/libocgcore.so"' \
    'SCRIPTS_DIR = "/app/ygopro-scripts"' \
    > /app/backend/local_config.py

# Puzzle content lives in a separate PRIVATE repo, not this one -- this repo
# is public, and committing puzzle files straight into it used to mean
# anyone browsing GitHub could read a future/unplayed puzzle's full board
# state and solution days before it actually went live (reproduced live:
# several future-dated puzzles were sitting here, fully spoiled, before
# their go-live day). The repo URL itself isn't sensitive (it just says
# "puzzles live over there") -- only the token that can actually clone it
# is, so that's the one thing kept out of the Dockerfile itself: it's
# mounted from a Render "Secret File" for just this one RUN step and is
# never written to any image layer (unlike a plain ARG/ENV would be).
# TODO(jacob): create the private repo and set the puzzles_repo_token
# secret file in Render before this build will succeed -- see README.
#
# validate_puzzles.py then loads every puzzle file into the real engine
# right here, at build time -- a bad puzzle (typo'd card name, a board the
# engine rejects) fails the build, so Render just keeps serving the last
# good image instead of shipping a broken puzzle.
#
# PUZZLES_CACHEBUST exists purely to defeat Docker layer caching -- nothing
# in *this* repo changes when a puzzle is pushed to the separate private
# puzzles repo, so without this, Docker sees an identical RUN command and
# happily reuses the previous build's result verbatim (confirmed live: a
# real deploy served stale puzzle content because this exact step got
# CACHED). Render passes service env vars through as Docker build args
# automatically, and the puzzles repo's own deploy workflow bumps this env
# var to a fresh value via Render's API right before triggering each
# deploy -- so its value changes on every real puzzle push, which is
# exactly what invalidates this layer's cache each time.
ARG PUZZLES_CACHEBUST=0
RUN --mount=type=secret,id=puzzles_repo_token,dst=/run/secrets/puzzles_repo_token \
    echo "cachebust=$PUZZLES_CACHEBUST" && \
    git clone --depth 1 \
        "https://oauth2:$(cat /run/secrets/puzzles_repo_token)@github.com/jacob-ancheta/ygo-puzzle-puzzles.git" \
        /tmp/puzzles-repo \
    && mkdir -p /app/backend/puzzles \
    && cp /tmp/puzzles-repo/*.py /app/backend/puzzles/ \
    && rm -rf /tmp/puzzles-repo \
    && cd /app/backend && python validate_puzzles.py

COPY backend/card_images /app/backend/card_images

EXPOSE 8000
WORKDIR /app/backend
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
