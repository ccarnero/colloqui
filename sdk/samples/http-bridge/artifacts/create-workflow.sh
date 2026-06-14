#!/usr/bin/env bash
set -euo pipefail

# Create a platform workflow that reacts to messages arriving on the http channel
# and appends "-received" to the message text via an inline jsFunction step.
#
# Chain it sets up:
#   message on http channel  ──►  workflow trigger (message_received, channels:["http"])
#                                   └─►  jsFunction: ctx.request.text + "-received"
#
# This is the platform half of the http-bridge sample: the bridge SENDS messages into
# the http channel; this workflow REACTS to them. Bind the two together by running the
# bridge (see ../README.md) and posting a message — the workflow fires automatically.
#
# Usage:
#   ./create-workflow.sh
#   YOIZEN_TENANT=acme YOIZEN_EMAIL=you@acme.com YOIZEN_PASSWORD=••• ./create-workflow.sh
#
# Requires: curl, jq. Targets the dev cluster by default.

BASE_URL="${YOIZEN_BASE_URL:-http://api-gateway.platform-services-dev.dev.local}"
HOST_HEADER="${YOIZEN_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
TENANT="${YOIZEN_TENANT:-acme}"
EMAIL="${YOIZEN_EMAIL:-yclawd@demo.io}"
PASSWORD="${YOIZEN_PASSWORD:-admin123}"

WORKFLOW_NAME="http-bridge-append-received"
APPLICATION="http-bridge-sample"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq   >/dev/null || { echo "jq is required" >&2; exit 1; }

# --- 1. Login: email + password -> access token -----------------------------------
echo "==> Logging in as ${EMAIL} (tenant ${TENANT})"
TOKEN="$(curl -sS -X POST "${BASE_URL}/api/auth/login" \
  -H "Host: ${HOST_HEADER}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}" \
  | jq -r '.access_token // empty')"

if [[ -z "${TOKEN}" ]]; then
  echo "Login failed — check YOIZEN_EMAIL / YOIZEN_PASSWORD / YOIZEN_TENANT" >&2
  exit 1
fi

# --- 2. Reuse the workflow if it already exists (idempotent) -----------------------
echo "==> Checking for an existing '${WORKFLOW_NAME}' workflow"
WORKFLOW_ID="$(curl -sS -X GET "${BASE_URL}/api/workflows" \
  -H "Host: ${HOST_HEADER}" \
  -H "x-yoizen-tenant: ${TENANT}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | jq -r ".[] | select(.name == \"${WORKFLOW_NAME}\") | .id" | head -1)"

if [[ -n "${WORKFLOW_ID}" ]]; then
  echo "==> Workflow already exists: ${WORKFLOW_ID}"
  exit 0
fi

# --- 3. Create the workflow --------------------------------------------------------
# Inline JS uses single quotes so it nests inside the JSON double-quoted "code" string.
echo "==> Creating workflow '${WORKFLOW_NAME}'"
RESPONSE="$(curl -sS -X POST "${BASE_URL}/api/workflows" \
  -H "Host: ${HOST_HEADER}" \
  -H "Content-Type: application/json" \
  -H "x-yoizen-tenant: ${TENANT}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "$(cat <<JSON
{
  "name": "${WORKFLOW_NAME}",
  "application": "${APPLICATION}",
  "actions": [
    {
      "name": "appendReceived",
      "activity": "jsFunction",
      "args": {
        "code": "(ctx) => { const text = ctx.request.text ?? ''; const out = text + '-received'; console.log('[http-bridge-wf]', ctx.request.from, '->', out); return out; }"
      }
    }
  ],
  "trigger": {
    "type": "message_received",
    "mode": "shared",
    "config": { "channels": ["http"], "providers": ["http"] }
  }
}
JSON
)")"

WORKFLOW_ID="$(echo "${RESPONSE}" | jq -r '.id // empty')"
if [[ -z "${WORKFLOW_ID}" ]]; then
  echo "Workflow creation failed: ${RESPONSE}" >&2
  exit 1
fi

echo "==> Created workflow: ${WORKFLOW_ID}"
echo "    Trigger: message_received on channels=[http]"
echo "    Action:  jsFunction appendReceived  (ctx.request.text + '-received')"
