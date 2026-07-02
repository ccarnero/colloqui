#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the ai-agent-triage sample end-to-end.
# Prerequisite: run ./setup.sh once first to provision the connector, agent,
# HTTP instance and workflow. This script never creates or modifies platform
# objects — it only POSTs sample customer messages to the ingest URL.
. ../lib/resolve-env.sh

WORKFLOW_NAME="${TRIAGE_WORKFLOW_NAME:-ai-agent-triage}"
INSTANCE="${TRIAGE_HTTP_EXTERNAL_ID:-ai-agent-triage}"
SEND_DELAY_S="${TRIAGE_RUN_DELAY_S:-2}"

step() { echo "[run] $*"; }
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

# ----- 1. Login + verify workflow exists -------------------------------------
TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || { echo "[run] login failed" >&2; exit 1; }

step "1/2 verifying workflow '${WORKFLOW_NAME}' exists (run ./setup.sh first if this fails)..."
WF_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/workflows" \
  | jq -r --arg n "$WORKFLOW_NAME" \
      '[.[] | select(.name==$n)] | if length==0 then empty else .[0].id end')"
[ -n "$WF_ID" ] || {
  echo "[run] workflow '${WORKFLOW_NAME}' not found — run ./setup.sh first" >&2; exit 1; }
step "    workflow found (id=${WF_ID})"

# ----- 2. Drive it ------------------------------------------------------------
SECRET="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r --arg e "$INSTANCE" '[.[] | select(.externalId==$e) | .appSecret] | .[0] // empty')"
[ -n "$SECRET" ] || { echo "[run] could not resolve the '${INSTANCE}' instance token — run ./setup.sh first" >&2; exit 1; }

INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${INSTANCE}"
step "2/2 posting sample customer messages to the dedicated instance URL: ${INSTANCE_URL}"

# send_message <from> <text> — each POST triggers one full triage run:
# agentCall classification -> jsFunction parse -> Telegram notification.
send_message() {
  local from="$1" text="$2" body resp
  body="$(jq -n --arg from "$from" --arg text "$text" \
    '{from: $from, text: $text, metadata: {source: "ai-agent-triage/run.sh"}}')"
  step "  -> [${from}] ${text}"
  resp="$(curl -s -X POST "$INSTANCE_URL" -H 'content-type: application/json' \
    -H "x-http-channel-token: ${SECRET}" -d "$body")"
  echo "$resp" | jq -c .
}

send_message "angry-customer" \
  "I want my money back RIGHT NOW. This is the THIRD time my order arrived broken and nobody answers my emails!"
sleep "$SEND_DELAY_S"

send_message "curious-customer" \
  "Hi! Quick question — my order shipped on Monday, when should I expect it to arrive in Rosario?"
sleep "$SEND_DELAY_S"

send_message "happy-customer" \
  "Just wanted to say the replacement arrived today and it works perfectly. Thanks for the great support!"

step "sent — check Telegram. Each message produces one triage summary like:"
step '  "🎧 Triage — priority: urgent | sentiment: negative | intent: refund"'
step "  followed by the one-line summary and the original text."
step "The agentCall goes through a real LLM, so allow a few seconds per message."
