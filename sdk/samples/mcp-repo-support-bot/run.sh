#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the mcp-repo-support-bot sample — SDK-powered via `@yoizen/platform-sdk`.
# The actual provisioning + one-exchange drive logic lives in src/index.ts
# (which defaults SIMULATE_INBOUND=1 and delegates to src/setup.ts's main());
# this script only resolves the dev environment (via ../lib/resolve-env.sh,
# same as every other sample's run.sh) and execs the Node app.
#
# Without a real TELEGRAM_BOT_TOKEN the chain still executes (observable), only
# the outbound Telegram reply 404s. Put a real token in ./.env (see env.example)
# and re-run with RECREATE=1 for real delivery.
. ../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see sdk/samples/mcp-repo-support-bot/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see sdk/samples/mcp-repo-support-bot/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
