#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: telegram-transform-reply  (Telegram analog of the http-bridge sample)
# =============================================================================
#
# A Telegram message in -> a workflow transforms it (echo + a millisecond
# timestamp) -> the bot replies over Telegram to the SAME chat.
#
# Provisions a Telegram channel account + the transform/reply workflow (and
# optionally registers the webhook + drives a synthetic inbound update) —
# SDK-powered (sdk/GROWTH-PLAN.md P3.1). The actual provisioning logic
# (login, dedup, webhook registration, simulate-inbound) lives in
# src/setup.ts, run via `@yoizen/platform-sdk`; this script only resolves the
# dev environment (via ../../lib/resolve-env.sh, same as every other sample's
# setup.sh) and execs the Node app with those env vars in scope.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md
# for env vars, prerequisites, and usage.
# =============================================================================
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see integrations/channels/telegram-transform-reply/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see integrations/channels/telegram-transform-reply/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
