#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the ai-system-variables sample end-to-end.
# Prerequisite: run ./setup.sh once first to provision the system variables,
# connector, agent, HTTP instance and workflow. This script never creates or
# modifies platform objects — it only POSTs sample customer messages to the
# ingest URL and prints the live policy-flip recipe.
. ../lib/resolve-env.sh

WORKFLOW_NAME="${SYSVARS_WORKFLOW_NAME:-ai-system-variables}"
INSTANCE="${SYSVARS_HTTP_EXTERNAL_ID:-ai-system-variables}"
SEND_DELAY_S="${SYSVARS_RUN_DELAY_S:-2}"

step() { echo "[run] $*"; }
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

# ----- 1. Login + verify workflow exists -------------------------------------
TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || { echo "[run] login failed" >&2; exit 1; }

step "1/3 verifying workflow '${WORKFLOW_NAME}' exists (run ./setup.sh first if this fails)..."
WF_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/workflows" \
  | jq -r --arg n "$WORKFLOW_NAME" \
      '[.[] | select(.name==$n)] | if length==0 then empty else .[0].id end')"
[ -n "$WF_ID" ] || {
  echo "[run] workflow '${WORKFLOW_NAME}' not found — run ./setup.sh first" >&2; exit 1; }
step "    workflow found (id=${WF_ID})"

# ----- 2. Show the current policy (the system variables the run depends on) ---
# GET /api/admin/system-variables -> { variables: [ {id, name, value, ...} ], total }
step "2/3 current system variables (these ARE the workflow's configuration):"
VARS="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/admin/system-variables?limit=100")"
COMPANY_NAME="$(echo "$VARS" | jq -r '(.variables // []) | map(select(.name=="companyName")) | .[0].value // "(missing!)"')"
ESCALATION_PRIORITY="$(echo "$VARS" | jq -r '(.variables // []) | map(select(.name=="escalationPriority")) | .[0].value // "(missing!)"')"
BRAND_VOICE="$(echo "$VARS" | jq -r '(.variables // []) | map(select(.name=="brandVoice")) | .[0].value // "(missing!)"')"
ESCALATION_VAR_ID="$(echo "$VARS" | jq -r '(.variables // []) | map(select(.name=="escalationPriority")) | .[0].id // empty')"
step "    companyName        = ${COMPANY_NAME}"
step "    escalationPriority = ${ESCALATION_PRIORITY}   <- messages classified at THIS priority take the 🚨 arm"
step "    brandVoice         = ${BRAND_VOICE}"

# ----- 3. Drive it -------------------------------------------------------------
SECRET="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r --arg e "$INSTANCE" '[.[] | select(.externalId==$e) | .appSecret] | .[0] // empty')"
[ -n "$SECRET" ] || { echo "[run] could not resolve the '${INSTANCE}' instance token — run ./setup.sh first" >&2; exit 1; }

INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${INSTANCE}"
step "3/3 posting sample customer messages to the dedicated instance URL: ${INSTANCE_URL}"

# send_message <from> <text> — each POST triggers one full run:
# agentCall classification (brand-voiced prompt) -> jsFunction parse ->
# conditional routed against the escalationPriority variable -> Telegram.
send_message() {
  local from="$1" text="$2" body resp
  body="$(jq -n --arg from "$from" --arg text "$text" \
    '{from: $from, text: $text, metadata: {source: "ai-system-variables/run.sh"}}')"
  step "  -> [${from}] ${text}"
  resp="$(curl -s -X POST "$INSTANCE_URL" -H 'content-type: application/json' \
    -H "x-http-channel-token: ${SECRET}" -d "$body")"
  echo "$resp" | jq -c .
}

# The agent should classify this one at the escalation priority ("high" by
# default) -> 🚨 escalation arm.
send_message "furious-customer" \
  "This is the THIRD time my internet goes down this week and nobody calls me back. Fix it TODAY or I am cancelling everything!"
sleep "$SEND_DELAY_S"

# Calm question -> low/normal priority -> ✅ default arm.
send_message "calm-customer" \
  "Hi! Quick question — does my plan include roaming in Uruguay? No rush, thanks!"

step "sent — check Telegram. Both notifications are stamped with the companyName"
step "variable, e.g.:"
step '  "🚨 [Acme Telco] escalation — priority: high" + the brand-voiced summary'
step '  "✅ [Acme Telco] handled — priority: low"     + the brand-voiced summary'
step "The agentCall goes through a real LLM, so allow a few seconds per message."
echo
step "── try this: flip the routing policy LIVE (no workflow edit) ──────────────"
step "Only messages classified 'urgent' will escalate after:"
if [ -n "$ESCALATION_VAR_ID" ]; then
  step "  curl -X PATCH '${YOIZEN_BASE_URL}/api/admin/system-variables/${ESCALATION_VAR_ID}' \\"
else
  step "  curl -X PATCH '${YOIZEN_BASE_URL}/api/admin/system-variables/<id>' \\"
fi
step "    -H 'Host: ${YOIZEN_HOST_HEADER}' -H 'x-yoizen-tenant: ${YOIZEN_TENANT}' \\"
step "    -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \\"
step "    -d '{\"value\":\"urgent\"}'"
step "Same for the brand: PATCH companyName or brandVoice and re-run ./run.sh."
step "NOTE: workflow-service caches system variables per tenant for 5 minutes —"
step "allow up to 5 min before new executions pick up the change."
