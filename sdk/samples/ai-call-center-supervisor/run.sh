#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the ai-call-center-supervisor sample end-to-end: posts two contrasting
# customer messages to this sample's dedicated HTTP instance and tells you what
# to expect on Telegram.
# Prerequisite: run ./setup.sh once first. This script never creates or
# modifies platform objects.
. ../lib/resolve-env.sh

WORKFLOW_NAME="${SUPERVISOR_WORKFLOW_NAME:-ai-call-center-supervisor}"
AGENT_NAME="${AI_AGENT_NAME:-ai-sample-supervisor}"
INSTANCE="${SUPERVISOR_HTTP_EXTERNAL_ID:-ai-call-center-supervisor}"
PAUSE_S="${SUPERVISOR_RUN_PAUSE_SECONDS:-3}"

step() { echo "[run] $*"; }
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

# ----- 1. Login + verify workflow exists --------------------------------------
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

# ----- 2. Resolve the instance token ------------------------------------------
SECRET="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r --arg e "$INSTANCE" '[.[] | select(.externalId==$e) | .appSecret] | .[0] // empty')"
[ -n "$SECRET" ] || { echo "[run] could not resolve the '${INSTANCE}' instance token — run ./setup.sh first" >&2; exit 1; }

INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${INSTANCE}"

post_message() {
  local from="$1" text="$2"
  local body resp
  body="$(jq -n --arg from "$from" --arg text "$text" \
    '{ from: $from, text: $text, metadata: { source: "ai-call-center-supervisor/run.sh" } }')"
  resp="$(curl -s -X POST "$INSTANCE_URL" -H 'content-type: application/json' \
    -H "x-http-channel-token: ${SECRET}" -d "$body")"
  printf '%s\n' "$resp" | jq . 2>/dev/null || printf '%s\n' "$resp"
}

# ----- 3. Drive it: one angry message, one calm one ----------------------------
step "2/3 posting the ANGRY message (expect a 🚨 SUPERVISOR ESCALATION on Telegram)"
post_message "cust-1001" "${SUPERVISOR_RUN_TEXT_ANGRY:-third time my bill is wrong, I want a \$200 refund or I cancel}"

step "    pausing ${PAUSE_S}s between messages..."
sleep "$PAUSE_S"

step "3/3 posting the CALM message (expect a ✅ AUTO-RESOLVED summary on Telegram)"
post_message "cust-2002" "${SUPERVISOR_RUN_TEXT_CALM:-how do I update my email address?}"

echo
step "sent both. What happens now, per message:"
step "  lookupCustomer (serviceCall → sample-crm echo)  →  buildTriageInput (jsFunction)"
step "  →  triage (agentCall '${AGENT_NAME}' agent)  →  decide (jsFunction)  →  route (conditional)"
step "The LLM triage takes a few seconds — then the bot DMs the supervisor chat:"
step "  🚨 SUPERVISOR ESCALATION ... for the angry \$200-refund message"
step "  ✅ AUTO-RESOLVED ...        for the calm email-address question"
step "If nothing arrives, check the workflow executions in the admin console and"
step "that the Knative 'sample-crm' service can cold-start (first call may be slow)."
