#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# 01-telegram-channel — provisions the customer-facing Telegram channel
# account for the crm-support-telegram demo.
# =============================================================================
#
# Thin bash wrapper over src/01-telegram-channel.ts (mirrors the
# sdk/examples/reference-pattern pattern). The actual provisioning logic (account
# create-or-update by bot token, TELEGRAM_TEST_CHAT_ID auto-discovery,
# webhook registration against TG_PUBLIC_URL) lives there, run via
# `@yoizen/platform-sdk`; this script only checks prerequisites and execs the
# TypeScript entrypoint with the caller's environment in scope.
#
# Required env (not resolved here — see README.md "Environment variables"):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL,
#   TELEGRAM_BOT_TOKEN, TG_PUBLIC_URL
# Optional: TELEGRAM_TEST_CHAT_ID (or TELEGRAM_CHAT_ID), YOIZEN_HOST_HEADER
#
# The orchestrator and later numbered scripts never parse this script's
# stdout — they re-resolve the account by name/bot-token through the SDK
# themselves. This script's final lines print the resolved account id and
# webhook state purely for human/CI readability.
# =============================================================================

if ! command -v node >/dev/null 2>&1; then
  echo "[01-telegram-channel] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[01-telegram-channel] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[01-telegram-channel] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/01-telegram-channel.ts
else
  exec npx tsx src/01-telegram-channel.ts
fi
