#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-fanout-telegram sample end-to-end — SDK-powered. The actual
# prereq-shelling/login/list/ingest logic lives in src/index.ts, run via
# `@yoizen/platform-sdk`; this script only resolves the dev environment (via
# ../../lib/resolve-env.sh, same as every other sample's run.sh) and execs the
# Node app with those env vars in scope.
#
# Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
# once first to provision the workflow and its dedicated HTTP account (see
# README.md). This script never creates or modifies platform objects itself
# (it may shell out to the still-imperative http-connectors/setup.sh — see
# src/index.ts). The Telegram recipient chat id lives in the manifest's
# `systemVariables` section now, not an env var here.
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see integrations/channels/http-fanout-telegram/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see integrations/channels/http-fanout-telegram/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
