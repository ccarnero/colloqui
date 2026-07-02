#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-bridge sample end-to-end.
# Prerequisite: run ./setup.sh once first to provision the workflow and its
# dedicated HTTP account. This script never creates or modifies platform objects.
. ../lib/resolve-env.sh

WORKFLOW_NAME="${BRIDGE_WORKFLOW_NAME:-http-bridge}"
INSTANCE="${BRIDGE_HTTP_EXTERNAL_ID:-http-bridge}"

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

MSG_TEXT="${RUN_TEXT:-hola desde run.sh} [$(date +%s)]"
INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${INSTANCE}"

step "2/2 posting test payload to the dedicated instance URL: ${INSTANCE_URL}"
RESP="$(curl -s -X POST "$INSTANCE_URL" -H 'content-type: application/json' \
  -H "x-http-channel-token: ${SECRET}" \
  -d "{\"from\":\"run.sh\",\"text\":\"${MSG_TEXT}\",\"metadata\":{\"source\":\"http-bridge/run.sh\"}}")"
echo "$RESP" | jq .
step "sent — check Telegram for the echoed payload + timestamp."
