#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-fanout-telegram sample end-to-end — SDK-powered. The actual
# prereq-shelling/login/list/ingest logic lives in src/index.ts, run via
# `@yoizen/platform-sdk`; this script only resolves the dev environment (via
# ../lib/resolve-env.sh, same as every other sample's run.sh) and execs the
# Node app with those env vars in scope.
#
# Prerequisite: run ./setup.sh once first to provision the workflow and its
# dedicated HTTP account. This script never creates or modifies platform
# objects itself (it may shell out to sibling samples' setup.sh — see
# src/index.ts).
. ../lib/resolve-env.sh

: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required (your numeric chat id — put it in ./.env)}"

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see sdk/samples/http-fanout-telegram/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see sdk/samples/http-fanout-telegram/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
