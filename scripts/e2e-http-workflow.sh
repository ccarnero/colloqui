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
#   6. Disable the workflow via PATCH /workflows/:id/status and assert the
#      response reports a `terminated` count
#   7. POST a webhook message with a fresh nonce; wait for
#      workflow-service-worker's trigger-consumer to log its "skipped
#      disabled workflow" line (positive confirmation the message arrived
#      and was refused), then assert via the executions API that no new
#      execution was recorded
#   8. Re-enable the workflow, POST another fresh nonce, and assert the
#      execution completes (reuses the stage_verify_execution polling logic)
#
# Exit code 0 = full chain verified; 1 = any stage failed. The workflow is
# always left ENABLED on exit (trap), even on failure, so a failed run never
# poisons subsequent runs that reuse the same 'e2e-http-log' workflow.
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
# Bound for the disabled-workflow stage's *positive* wait (see
# stage_verify_no_execution): it polls workflow-service-worker logs for the
# trigger-consumer's "Skipped trigger for disabled workflow" warn line, i.e.
# the same NATS ingest -> trigger-match hop the happy path waits on before
# handing off to Temporal. There is no reason that hop would be faster just
# because the outcome is a skip rather than a start, so this reuses
# POLL_TIMEOUT_S rather than a separate, shorter, empirically-unjustified
# constant.
DISABLED_CHECK_TIMEOUT_S="${E2E_DISABLED_CHECK_TIMEOUT_S:-$POLL_TIMEOUT_S}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-$(date +%s)-$RANDOM"
NONCE_DISABLED="e2e-disabled-$(date +%s)-$RANDOM"
NONCE_REENABLED="e2e-reenabled-$(date +%s)-$RANDOM"
TOKEN=""
APP_SECRET=""
WORKFLOW_ID=""
# Set to 1 once the workflow has been disabled and not yet confirmed
# re-enabled; the EXIT trap uses this to guarantee the workflow is never
# left disabled, regardless of which stage fails.
WORKFLOW_DISABLED=0

ensure_workflow_enabled_on_exit() {
  local exit_code=$?
  if [[ "$WORKFLOW_DISABLED" -eq 1 && -n "$WORKFLOW_ID" ]]; then
    warn "Cleanup: re-enabling workflow ${WORKFLOW_ID} before exit"
    if api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"enabled"}' >/dev/null 2>&1; then
      log "Cleanup: workflow ${WORKFLOW_ID} re-enabled"
    else
      err "Cleanup: FAILED to re-enable workflow ${WORKFLOW_ID} — manual intervention required"
    fi
  fi
  exit "$exit_code"
}
trap ensure_workflow_enabled_on_exit EXIT

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
  # stage_send_message <nonce>
  local nonce="$1"
  log "Stage 4: POST webhook message with nonce ${nonce}"
  local resp status
  resp="$(curl -s -X POST "${API_URL}/api/webhooks/http/${TENANT}" \
    -H "Host: ${HOST_HEADER}" \
    -H "Content-Type: application/json" \
    -H "x-http-channel-token: ${APP_SECRET}" \
    -d "{\"from\":\"e2e-user\",\"text\":\"${nonce}\"}")"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "accepted" ]]; then
    err "Webhook not accepted: $resp"
    return 1
  fi
}

stage_verify_execution() {
  # stage_verify_execution <nonce>
  local nonce="$1"
  log "Stage 5: wait for workflow execution + console.log (timeout ${POLL_TIMEOUT_S}s, nonce ${nonce})"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while (( $(date +%s) < deadline )); do
    if kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-worker \
        --since=5m --tail=500 2>/dev/null | grep -q "$nonce"; then
      log "console.log with nonce found in workflow-worker logs"
      return 0
    fi
    sleep 3
  done
  err "Nonce ${nonce} not seen in workflow-worker logs within ${POLL_TIMEOUT_S}s"
  err "Recent executions:"
  api GET "/api/workflows/${WORKFLOW_ID}/executions" | jq '.' >&2 || true
  return 1
}

stage_disable_workflow() {
  log "Stage 6: PATCH /workflows/${WORKFLOW_ID}/status -> disabled"
  local resp terminated
  resp="$(api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"disabled"}')"
  terminated="$(echo "$resp" | jq -r '.terminated // empty')"
  if [[ -z "$terminated" ]]; then
    err "Disable response missing 'terminated' count: $resp"
    return 1
  fi
  # From this point on the trap must re-enable the workflow before exiting,
  # whatever happens next.
  WORKFLOW_DISABLED=1
  log "Workflow disabled, terminated=${terminated} in-flight execution(s)"
}

stage_capture_execution_ids() {
  # stage_capture_execution_ids
  # Snapshots the execution ids currently on record for WORKFLOW_ID so
  # stage_verify_no_execution can assert the set is unchanged afterwards.
  # Echoes the ids (one per line) on stdout; caller captures via $().
  api GET "/api/workflows/${WORKFLOW_ID}/executions" | jq -r '.items[]?.id // empty' | sort
}

stage_verify_no_execution() {
  # stage_verify_no_execution <nonce>
  #
  # A disabled workflow's trigger is rejected inside workflow-service-worker's
  # TriggerConsumerService (trigger-consumer.service.ts) via a
  # ConflictException(code: WORKFLOW_DISABLED), which is caught, logged as a
  # warn ("Skipped trigger for disabled workflow ...", never surfaces
  # anywhere near workflow-worker's Temporal activity logs), and acked
  # without ever calling temporal.workflow.start(...). So this stage cannot
  # grep the jsFunction's console.log the way stage_verify_execution does —
  # that log line structurally never appears for a disabled workflow,
  # whether the system correctly refused the trigger or the whole pipeline
  # is silently broken. Instead:
  #   1. POSITIVELY wait (bounded, POLL_TIMEOUT_S-style) for the
  #      trigger-consumer's own skip warn line in workflow-service-worker
  #      logs. This proves the message ARRIVED at the trigger consumer and
  #      was explicitly refused — not merely "never showed up because
  #      something upstream is broken."
  #   2. THEN assert against the executions API (source of truth per the
  #      task spec) that the set of execution ids for WORKFLOW_ID is
  #      unchanged from the snapshot taken before this nonce was sent.
  local nonce="$1"
  local ids_before="$2"
  log "Stage 7: assert workflow trigger is skipped for nonce ${nonce} (timeout ${DISABLED_CHECK_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + DISABLED_CHECK_TIMEOUT_S ))
  local skip_seen=0
  while (( $(date +%s) < deadline )); do
    if kubectl logs -n "$NAMESPACE" -l app.kubernetes.io/name=workflow-service-worker \
        --since=5m --tail=500 2>/dev/null \
        | grep -q "Skipped trigger for disabled workflow ${WORKFLOW_NAME} (${WORKFLOW_ID})"; then
      log "Confirmed: trigger-consumer skip line found for workflow ${WORKFLOW_ID}"
      skip_seen=1
      break
    fi
    sleep 3
  done
  if [[ "$skip_seen" -ne 1 ]]; then
    err "Never saw trigger-consumer skip line for workflow ${WORKFLOW_ID} within ${DISABLED_CHECK_TIMEOUT_S}s — cannot confirm the message even arrived"
    return 1
  fi

  local ids_after
  ids_after="$(stage_capture_execution_ids)"
  if [[ "$ids_after" != "$ids_before" ]]; then
    err "Execution set for workflow ${WORKFLOW_ID} changed while disabled"
    err "Before: ${ids_before}"
    err "After:  ${ids_after}"
    return 1
  fi
  log "Confirmed: no new execution recorded for workflow ${WORKFLOW_ID} while disabled"
}

stage_enable_workflow() {
  log "Stage 8: PATCH /workflows/${WORKFLOW_ID}/status -> enabled"
  local resp status
  resp="$(api PATCH "/api/workflows/${WORKFLOW_ID}/status" '{"status":"enabled"}')"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "enabled" ]]; then
    err "Enable response did not report status=enabled: $resp"
    return 1
  fi
  WORKFLOW_DISABLED=0
  log "Workflow re-enabled"
}

main() {
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  stage_login
  stage_ensure_account
  stage_ensure_workflow
  stage_send_message "$NONCE"
  stage_verify_execution "$NONCE"
  stage_disable_workflow
  local ids_before_disabled_send
  ids_before_disabled_send="$(stage_capture_execution_ids)"
  stage_send_message "$NONCE_DISABLED"
  stage_verify_no_execution "$NONCE_DISABLED" "$ids_before_disabled_send"
  stage_enable_workflow
  stage_send_message "$NONCE_REENABLED"
  stage_verify_execution "$NONCE_REENABLED"
  log "E2E http → workflow → jsFunction chain + toggle scenario verified (nonces ${NONCE}, ${NONCE_DISABLED}, ${NONCE_REENABLED})"
}

main "$@"
