#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
. ../lib/resolve-env.sh

SERVICE_NAME="${HOSTED_SERVICE_NAME:-sample-echo}"
ROUTE_PREFIX="${HOSTED_ROUTE_PREFIX:-/samples/hosted-echo}"
WAIT_SECONDS="${HOSTED_ROUTE_CACHE_WAIT_SECONDS:-16}"
WORKFLOW_NAME="${HOSTED_WORKFLOW_NAME:-hosted-service-telegram}"
HTTP_EXTERNAL_ID="${HOSTED_HTTP_EXTERNAL_ID:-hosted-services-api}"

step() { echo "[run] $*"; }
api() { curl -s -H "Host: ${YOIZEN_HOST_HEADER}" -H "x-yoizen-tenant: ${YOIZEN_TENANT}" "$@"; }

TOKEN="$(api -X POST "${YOIZEN_BASE_URL}/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}" \
  | jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || { echo "[run] login failed" >&2; exit 1; }

step "verifying hosted service '${SERVICE_NAME}' exists (run ./setup.sh first if this fails)..."
SERVICE_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/registry/services" \
  | jq -r --arg n "$SERVICE_NAME" '[.[] | select(.name==$n)] | .[0].id // empty')"
[ -n "$SERVICE_ID" ] || { echo "[run] service '${SERVICE_NAME}' not found — run ./setup.sh first" >&2; exit 1; }
step "service found (id=${SERVICE_ID})"

step "checking route '${ROUTE_PREFIX}'..."
ROUTE_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/registry/services/${SERVICE_ID}/routes" \
  | jq -r --arg p "$ROUTE_PREFIX" '[.[] | select(.pathPrefix==$p)] | .[0].id // empty')"
[ -n "$ROUTE_ID" ] || { echo "[run] route '${ROUTE_PREFIX}' not found — run ./setup.sh first" >&2; exit 1; }
step "route found (id=${ROUTE_ID})"

if [ "$WAIT_SECONDS" != "0" ]; then
  step "waiting ${WAIT_SECONDS}s for gateway dynamic-route cache..."
  sleep "$WAIT_SECONDS"
fi

URL="${YOIZEN_BASE_URL}${ROUTE_PREFIX}/health"
step "calling ${URL}"
RESP="$(api -H "Authorization: Bearer ${TOKEN}" "$URL")"
printf '%s\n' "$RESP" | jq . 2>/dev/null || printf '%s\n' "$RESP"

step "checking optional workflow '${WORKFLOW_NAME}'..."
WF_ID="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/workflows" \
  | jq -r --arg n "$WORKFLOW_NAME" '[.[] | select(.name==$n)] | .[0].id // empty')"
SECRET="$(api -H "Authorization: Bearer ${TOKEN}" "${YOIZEN_BASE_URL}/api/channels/accounts?channel=http" \
  | jq -r --arg e "$HTTP_EXTERNAL_ID" \
      'if type=="array" then ([.[] | select(.externalId==$e)] | .[0].appSecret // empty) else empty end')"

if [ -n "$WF_ID" ] && [ -n "$SECRET" ]; then
  MSG_TEXT="${RUN_TEXT:-hello hosted service workflow} [$(date +%s)]"
  BODY="$(jq -n --arg from "hosted-services-api/run.sh" --arg text "$MSG_TEXT" \
    '{ from: $from, text: $text }')"
  INSTANCE_URL="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"
  step "driving workflow via ${INSTANCE_URL}"
  WF_RESP="$(api -X POST "$INSTANCE_URL" \
    -H 'content-type: application/json' \
    -H "x-http-channel-token: ${SECRET}" \
    -d "$BODY")"
  printf '%s\n' "$WF_RESP" | jq . 2>/dev/null || printf '%s\n' "$WF_RESP"
  step "sent — check Telegram for a message prefixed 'HOSTED SERVICE SAMPLE'."
else
  step "workflow not configured — run ./setup.sh with TELEGRAM_CHAT_ID to enable Telegram notification."
fi

step "done — if direct invoke returned 502, inspect the Knative Service readiness and image /health support."
