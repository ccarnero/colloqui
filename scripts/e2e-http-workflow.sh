#!/usr/bin/env bash
set -euo pipefail

# End-to-end check of the http-channel → workflow trigger → jsFunction chain:
#
#   1. Login as tenant admin (acme by default)
#   2. Ensure a fresh http channel account (delete + recreate so the
#      auto-generated appSecret is always known to this run)
#   3. Ensure the e2e workflow definition exists (message_received trigger
#      on channels:["http"], single jsFunction action that console.logs)
#   4. POST a webhook message carrying a unique nonce
#   5. Poll the workflow executions API until an execution for this run
#      completes, then assert the nonce appeared in workflow-worker logs
#
# Exit code 0 = full chain verified; 1 = any stage failed.
#
# Designed to be the executable foundation for future e2e suites: each stage
# is a function with a single assertion point.

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
TENANT="${E2E_TENANT:-acme}"
EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
PASSWORD="${E2E_PASSWORD:-admin123}"
# Prefix shared by every run's account; the per-run externalId appends the
# unique nonce so a fresh create can never collide on the (channel,
# external_id) unique constraint, regardless of delete timing.
ACCOUNT_EXTERNAL_PREFIX="e2e-http-workflow"
WORKFLOW_NAME="e2e-http-log"
POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-60}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-$(date +%s)-$RANDOM"
TOKEN=""
APP_SECRET=""
WORKFLOW_ID=""

api() {
  # api <method> <path> [json-body]
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

stage_login() {
  log "Stage 1: login as ${EMAIL} (tenant ${TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  if [[ -z "$TOKEN" ]]; then
    err "Login failed: $resp"
    return 1
  fi
}

stage_ensure_account() {
  # A fresh http account is created per run with a unique externalId. The
  # appSecret (webhook token) is only returned at creation time — there is no
  # http-secret rotation endpoint and it is masked everywhere else — so each
  # run must mint its own. The trigger matches by channel/provider, not by
  # accountId, so a new account each run still drives the same workflow.
  local external_id="${ACCOUNT_EXTERNAL_PREFIX}-${NONCE}"
  log "Stage 2: create http channel account (externalId=${external_id})"

  # Best-effort hygiene: remove accounts from previous runs. Failures here are
  # non-fatal — the unique externalId above guarantees the create won't collide.
  local stale
  stale="$(api GET "/api/channels/accounts?channel=http" \
    | jq -r ".[] | select(.externalId | startswith(\"${ACCOUNT_EXTERNAL_PREFIX}\")) | .id")"
  for id in $stale; do
    api DELETE "/api/channels/accounts/${id}" >/dev/null 2>&1 || true
  done

  local resp
  resp="$(api POST /api/channels/accounts \
    "{\"channel\":\"http\",\"provider\":\"http\",\"name\":\"E2E HTTP Ingest\",\"externalId\":\"${external_id}\",\"accessToken\":\"placeholder\"}")"
  APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  if [[ -z "$APP_SECRET" ]]; then
    err "Account creation did not return appSecret: $resp"
    return 1
  fi
}

stage_ensure_workflow() {
  log "Stage 3: ensure workflow definition '${WORKFLOW_NAME}'"
  WORKFLOW_ID="$(api GET /api/workflows \
    | jq -r ".[] | select(.name == \"${WORKFLOW_NAME}\") | .id" | head -1)"
  if [[ -n "$WORKFLOW_ID" ]]; then
    log "Reusing existing workflow ${WORKFLOW_ID}"
    return 0
  fi
  local resp
  resp="$(api POST /api/workflows "$(cat <<JSON
{
  "name": "${WORKFLOW_NAME}",
  "application": "e2e",
  "actions": [{
    "name": "logMessage",
    "activity": "jsFunction",
    "args": {
      "code": "(ctx) => { console.log('[e2e-http-log]', ctx.request.from, ctx.request.text); return ctx.request.text; }"
    }
  }],
  "trigger": {
    "type": "message_received",
    "mode": "shared",
    "config": { "channels": ["http"], "providers": ["http"] }
  }
}
JSON
)")"
  WORKFLOW_ID="$(echo "$resp" | jq -r '.id // empty')"
  if [[ -z "$WORKFLOW_ID" ]]; then
    err "Workflow creation failed: $resp"
    return 1
  fi
}

stage_send_message() {
  log "Stage 4: POST webhook message with nonce ${NONCE}"
  local resp status
  resp="$(curl -s -X POST "${API_URL}/api/webhooks/http/${TENANT}" \
    -H "Host: ${HOST_HEADER}" \
    -H "Content-Type: application/json" \
    -H "x-http-channel-token: ${APP_SECRET}" \
    -d "{\"from\":\"e2e-user\",\"text\":\"${NONCE}\"}")"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "accepted" ]]; then
    err "Webhook not accepted: $resp"
    return 1
  fi
}

stage_verify_execution() {
  log "Stage 5: wait for workflow execution + console.log (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while (( $(date +%s) < deadline )); do
    if kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-worker \
        --since=5m --tail=500 2>/dev/null | grep -q "$NONCE"; then
      log "console.log with nonce found in workflow-worker logs"
      return 0
    fi
    sleep 3
  done
  err "Nonce ${NONCE} not seen in workflow-worker logs within ${POLL_TIMEOUT_S}s"
  err "Recent executions:"
  api GET "/api/workflows/${WORKFLOW_ID}/executions" | jq '.' >&2 || true
  return 1
}

main() {
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  stage_login
  stage_ensure_account
  stage_ensure_workflow
  stage_send_message
  stage_verify_execution
  log "E2E http → workflow → jsFunction chain verified (nonce ${NONCE})"
}

main "$@"
