#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# One-shot: resolve the dev env, then provision the Telegram account + workflow.
# Needs a real bot token — put it in ./.env (see .env.example) or pass inline.
. ../lib/resolve-env.sh

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "[run] TELEGRAM_BOT_TOKEN is required (from @BotFather)." >&2
  echo "[run]   cp .env.example .env   # then edit it" >&2
  exit 1
fi

echo "[run] provisioning telegram account + workflow..."
# setup.sh reads TG_* (exported by resolve-env.sh) + TELEGRAM_BOT_TOKEN, and the
# optional TG_PUBLIC_URL / SIMULATE_INBOUND / TELEGRAM_TEST_CHAT_ID from .env/env.
exec ./setup.sh
