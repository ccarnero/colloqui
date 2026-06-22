#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-fanout-telegram sample end-to-end.
# Prerequisite: run ./setup.sh once first to provision the workflow and its
# dedicated HTTP account. This script never creates or modifies platform objects.
. ../lib/resolve-env.sh

: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required (your numeric chat id — put it in ./.env)}"

WORKFLOW_NAME="${FANOUT_WORKFLOW_NAME:-http-fanout-telegram}"
INSTANCE="${FANOUT_HTTP_EXTERNAL_ID:-http-fanout-telegram}"

step() { echo "[run] $*"; }

# ----- 1. Prerequisites ------------------------------------------------------
step "1/3 ensuring connectors (jsonplaceholder/pokeapi/catfacts/httpbin)..."
( cd ../http-connectors && ./setup.sh ) >/dev/null
step "    connectors ready"

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  step "2/3 ensuring telegram account (TELEGRAM_BOT_TOKEN provided)..."
  ( cd ../telegram-transform-reply && ./setup.sh ) >/dev/null
  step "    telegram account ready"
else
  step "2/3 no TELEGRAM_BOT_TOKEN — assuming an active telegram account already exists"
fi

# ----- 2. Login + verify workflow exists -------------------------------------
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || { echo "[run] login failed" >&2; exit 1; }

step "3/3 verifying workflow '${WORKFLOW_NAME}' exists (run ./setup.sh first if this fails)..."
WF_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/workflows" \
  | jq -r --arg n "$WORKFLOW_NAME" \
      '[.[] | select(.name==$n)] | if length==0 then empty else .[0].id end')"
[ -n "$WF_ID" ] || {
  echo "[run] workflow '${WORKFLOW_NAME}' not found — run ./setup.sh first" >&2; exit 1; }
step "    workflow found (id=${WF_ID})"

# ----- 3. Drive it -----------------------------------------------------------
SECRET="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r --arg e "$INSTANCE" '[.[] | select(.externalId==$e) | .appSecret] | .[0] // empty')"
[ -n "$SECRET" ] || { echo "[run] could not resolve the '${INSTANCE}' instance token — run ./setup.sh first" >&2; exit 1; }

MSG_TEXT="${RUN_TEXT:-hola desde run.sh} [$(date +%s)]"
send() {  # send <url>
  api -X POST "$1" -H 'content-type: application/json' -H "x-http-channel-token: ${SECRET}" \
    -d "{\"from\":\"run.sh\",\"text\":\"${MSG_TEXT}\"}"
}

INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${INSTANCE}"
LEGACY_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}"

step "driving via the dedicated instance URL: ${INSTANCE_URL}"
RESP="$(send "$INSTANCE_URL")"
if [ "$(echo "$RESP" | jq -r '.status // empty')" != "accepted" ]; then
  step "instance URL not accepted (needs the Option-B redeploy?) — using token-only legacy URL"
  RESP="$(send "$LEGACY_URL")"
fi
echo "$RESP" | jq .
step "sent — check Telegram for the joined summary (post + pokemon + cat fact)."
