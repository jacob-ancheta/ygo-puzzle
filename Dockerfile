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
COPY backend/puzzles /app/backend/puzzles
COPY backend/card_images /app/backend/card_images

RUN printf '%s\n' \
    'MINGW_BIN = ""' \
    'DLL_PATH = "/app/libocgcore.so"' \
    'SCRIPTS_DIR = "/app/ygopro-scripts"' \
    > /app/backend/local_config.py

EXPOSE 8000
WORKDIR /app/backend
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
