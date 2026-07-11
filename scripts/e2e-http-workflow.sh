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
#   9. Capture the correlation_id of the happy-path run (stage 4/5's nonce)
#      via the log-workflow's execution detail (`result.causal.correlation_id`)
#  10. GET /api/tracking/chains/:correlationId via the gateway and assert the
#      chain has >=5 events, a numeric summary.orphan_count, and at least one
#      span with duration_ms > 0. The nonzero span requires a real runtime
#      execution (workflow-service's fast jsFunction path never emits
#      `execution_started`), so stages 3a/3b idempotently provision an echo
#      agent + a second workflow with an `agentCall` action sharing the same
#      http trigger, so its events land on the same correlation.
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
# Stage 3a/3b: idempotent echo agent + agent-calling workflow sharing the
# same http trigger, so the happy-path run also produces a real runtime
# execution (agent-ai-service) whose span has duration_ms > 0 (see stage 10).
AGENT_NAME="e2e-http-agent-echo"
AGENT_WORKFLOW_NAME="e2e-http-agent"
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
# Stage 10's own poll bound, independent of POLL_TIMEOUT_S: the chain read
# is a Postgres query behind the ingester, not a Temporal/NATS hop, but it
# still races the agentCall runtime execution (agent-ai-service via
# ai-agent-gateway), which can be slower than the plain jsFunction path.
CHAIN_TIMEOUT_S="${E2E_CHAIN_TIMEOUT_S:-120}"

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
AGENT_ID=""
AGENT_WORKFLOW_ID=""
CORRELATION_ID=""
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

api_status() {
  # api_status <method> <path> [json-body]
  # Same request as api(), but callers need the HTTP status alongside the
  # body (api() hides it). Emits the body followed by a final line holding
  # only the status code; api_status_body/api_status_code split the two via
  # plain bash parameter expansion (no sed/grep — keeps this shellcheck -x
  # clean and avoids embedded-newline edge cases in the response body).
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status_body() {
  # api_status_body <combined-output> — everything before the final line.
  local combined="$1"
  printf '%s' "${combined%$'\n'*}"
}

api_status_code() {
  # api_status_code <combined-output> — the final line (status code).
  local combined="$1"
  printf '%s' "${combined##*$'\n'}"
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

stage_ensure_agent() {
  # Idempotent: look up '${AGENT_NAME}' by name (GET /api/admin/agents ->
  # {agents:[...],total} — NOT a bare array), create if missing, publish if
  # not already published. provider MUST be "mock" (the dev echo provider,
  # gated by RUNTIME_ALLOW_MOCK_PROVIDER=true in provider-registry.service.ts)
  # — any other provider name is unsupported and the runtime execution ends
  # execution_failed, which would leave every span at duration_ms == 0 (see
  # BLOCKED.md).
  log "Stage 3a: ensure agent '${AGENT_NAME}'"
  local list_resp
  list_resp="$(api GET /api/admin/agents)"
  AGENT_ID="$(echo "$list_resp" | jq -r ".agents[]? | select(.name == \"${AGENT_NAME}\") | .id" | head -1)"

  local agent_status=""
  if [[ -n "$AGENT_ID" ]]; then
    log "Reusing existing agent ${AGENT_ID}"
    agent_status="$(echo "$list_resp" | jq -r ".agents[]? | select(.id == \"${AGENT_ID}\") | .status")"
  else
    local create_resp
    create_resp="$(api POST /api/admin/agents "$(cat <<JSON
{
  "name": "${AGENT_NAME}",
  "system_prompt": "You are the e2e echo agent. Echo the user's message back verbatim.",
  "model_config": { "provider": "mock", "model": "echo" }
}
JSON
)")"
    AGENT_ID="$(echo "$create_resp" | jq -r '.id // empty')"
    if [[ -z "$AGENT_ID" ]]; then
      err "Agent creation failed: $create_resp"
      return 1
    fi
    agent_status="$(echo "$create_resp" | jq -r '.status // empty')"
    log "Agent created: ${AGENT_ID}"
  fi

  if [[ "$agent_status" != "published" ]]; then
    log "Publishing agent ${AGENT_ID}"
    local publish_resp publish_status
    # api() always sets Content-Type: application/json; an empty body then
    # 400s with "Body cannot be empty" — an explicit '{}' is required.
    publish_resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
    publish_status="$(echo "$publish_resp" | jq -r '.status // empty')"
    if [[ "$publish_status" != "published" ]]; then
      err "Agent publish failed: $publish_resp"
      return 1
    fi
  fi
  log "Agent ready: ${AGENT_ID} (published)"
}

stage_ensure_agent_workflow() {
  # Idempotent workflow '${AGENT_WORKFLOW_NAME}' with a single agentCall
  # action, sharing the SAME shared message_received http trigger config as
  # '${WORKFLOW_NAME}' so its runtime execution (and resulting nonzero-ms
  # span) lands on the same correlation as the happy-path run.
  log "Stage 3b: ensure agent workflow '${AGENT_WORKFLOW_NAME}'"
  AGENT_WORKFLOW_ID="$(api GET /api/workflows \
    | jq -r ".[] | select(.name == \"${AGENT_WORKFLOW_NAME}\") | .id" | head -1)"
  if [[ -n "$AGENT_WORKFLOW_ID" ]]; then
    # The agent (stage 3a) may have been deleted + recreated under a new
    # id since this workflow was last provisioned; reusing a stale
    # agentCall.args.agentId makes every execution fail with a 404 from
    # agent-ai-service. Reconcile before reusing.
    local existing_def existing_agent_id
    existing_def="$(api GET "/api/workflows/${AGENT_WORKFLOW_ID}")"
    existing_agent_id="$(echo "$existing_def" \
      | jq -r '.actions[] | select(.activity == "agentCall") | .args.agentId // empty' | head -1)"
    if [[ "$existing_agent_id" == "$AGENT_ID" ]]; then
      log "Reusing existing agent workflow ${AGENT_WORKFLOW_ID}"
      return 0
    fi
    warn "Agent workflow ${AGENT_WORKFLOW_ID} references stale agentId ${existing_agent_id}, reconciling to ${AGENT_ID}"
    local updated_actions update_resp update_status update_body
    updated_actions="$(echo "$existing_def" | jq -c \
      --arg agentId "$AGENT_ID" \
      '.actions | map(if .activity == "agentCall" then .args.agentId = $agentId else . end)')"
    update_resp="$(api_status PUT "/api/workflows/${AGENT_WORKFLOW_ID}" "$(cat <<JSON
{
  "name": $(echo "$existing_def" | jq -c '.name'),
  "application": $(echo "$existing_def" | jq -c '.application'),
  "actions": ${updated_actions},
  "trigger": $(echo "$existing_def" | jq -c '.trigger'),
  "variables": $(echo "$existing_def" | jq -c '.variables')
}
JSON
)")"
    update_status="$(api_status_code "$update_resp")"
    update_body="$(api_status_body "$update_resp")"
    if [[ "$update_status" == "200" || "$update_status" == "201" ]]; then
      log "Reconciled agent workflow ${AGENT_WORKFLOW_ID} via PUT (new agentId ${AGENT_ID})"
      return 0
    fi
    warn "PUT reconcile failed (status ${update_status}: ${update_body}); deleting and recreating agent workflow ${AGENT_WORKFLOW_ID} instead"
    api DELETE "/api/workflows/${AGENT_WORKFLOW_ID}" >/dev/null 2>&1 || true
    AGENT_WORKFLOW_ID=""
  fi
  local resp
  resp="$(api POST /api/workflows "$(cat <<JSON
{
  "name": "${AGENT_WORKFLOW_NAME}",
  "application": "e2e",
  "actions": [{
    "name": "callAgent",
    "activity": "agentCall",
    "args": {
      "agentId": "${AGENT_ID}",
      "message": "{{request.text}}"
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
  AGENT_WORKFLOW_ID="$(echo "$resp" | jq -r '.id // empty')"
  if [[ -z "$AGENT_WORKFLOW_ID" ]]; then
    err "Agent workflow creation failed: $resp"
    return 1
  fi
  log "Agent workflow created: ${AGENT_WORKFLOW_ID}"
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

stage_capture_correlation_id() {
  # stage_capture_correlation_id <nonce>
  #
  # Resolves the correlation_id of the happy-path run via the log-workflow's
  # execution detail (`result.causal.correlation_id`). CRITICAL: assigns
  # directly to the global CORRELATION_ID rather than being invoked in a
  # command substitution — log()/warn()/err() write to stdout too, and an
  # earlier attempt at this task captured a log line instead of the id
  # because the whole function was wrapped in $(...).
  local nonce="$1"
  log "Stage 9: resolve correlation_id for nonce ${nonce} (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local execution_id=""
  while (( $(date +%s) < deadline )); do
    execution_id="$(api GET "/api/workflows/${WORKFLOW_ID}/executions?pageSize=100" \
      | jq -r ".items[]? | select(.request.text == \"${nonce}\") | .id" | head -1)"
    [[ -n "$execution_id" ]] && break
    sleep 3
  done
  if [[ -z "$execution_id" ]]; then
    err "No execution of workflow ${WORKFLOW_ID} found for nonce ${nonce} within ${POLL_TIMEOUT_S}s"
    return 1
  fi
  log "Found execution ${execution_id} for nonce ${nonce}; polling for causal.correlation_id"

  while (( $(date +%s) < deadline )); do
    local correlation_id
    correlation_id="$(api GET "/api/workflows/${WORKFLOW_ID}/executions/${execution_id}" \
      | jq -r '.result.causal.correlation_id // empty')"
    if [[ -n "$correlation_id" ]]; then
      CORRELATION_ID="$correlation_id"
      log "Captured correlation_id ${CORRELATION_ID}"
      return 0
    fi
    sleep 3
  done
  err "Execution ${execution_id} never reported result.causal.correlation_id within ${POLL_TIMEOUT_S}s"
  return 1
}

stage_verify_chain() {
  log "Stage 10: GET /api/tracking/chains/${CORRELATION_ID} (timeout ${CHAIN_TIMEOUT_S}s)"
  if [[ -z "$CORRELATION_ID" ]]; then
    err "CORRELATION_ID is empty — cannot verify chain"
    return 1
  fi
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined body status
  while (( $(date +%s) < deadline )); do
    combined="$(api_status GET "/api/tracking/chains/${CORRELATION_ID}")"
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      local events_ok orphan_ok nonzero_span_ok
      events_ok="$(echo "$body" | jq '(.events | length) >= 5')"
      orphan_ok="$(echo "$body" | jq '(.summary.orphan_count | type) == "number"')"
      nonzero_span_ok="$(echo "$body" | jq '([.spans[]? | select(.duration_ms > 0)] | length) >= 1')"
      if [[ "$events_ok" == "true" && "$orphan_ok" == "true" && "$nonzero_span_ok" == "true" ]]; then
        log "Chain verified: events>=5=${events_ok} orphan_count-numeric=${orphan_ok} nonzero-span=${nonzero_span_ok}"
        return 0
      fi
      log "Chain not yet complete (events>=5=${events_ok} orphan_count-numeric=${orphan_ok} nonzero-span=${nonzero_span_ok}); retrying"
    else
      log "Chain endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Chain assertions never satisfied for correlation ${CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s"
  err "Last response (status ${status}): ${body}"
  return 1
}

main() {
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  stage_login
  stage_ensure_account
  stage_ensure_workflow
  stage_ensure_agent
  stage_ensure_agent_workflow
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
  stage_capture_correlation_id "$NONCE"
  stage_verify_chain
  log "E2E http → workflow → jsFunction chain + toggle scenario + tracking chain verified (nonces ${NONCE}, ${NONCE_DISABLED}, ${NONCE_REENABLED}; correlation ${CORRELATION_ID})"
}

main "$@"
