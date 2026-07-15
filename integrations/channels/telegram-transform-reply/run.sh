#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# One-shot: resolve the dev env, require a real bot token, then provision the
# Telegram account + workflow — SDK-powered (sdk/GROWTH-PLAN.md P3.1). The
# actual token-check + provisioning-delegation logic lives in src/index.ts,
# run via `@yoizen/platform-sdk`; this script only resolves the dev
# environment (via ../../lib/resolve-env.sh, same as every other sample's
# run.sh) and execs the Node app with those env vars in scope.
#
# Needs a real bot token — put it in ./.env (see .env.example) or pass inline.
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see integrations/channels/telegram-transform-reply/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see integrations/channels/telegram-transform-reply/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
