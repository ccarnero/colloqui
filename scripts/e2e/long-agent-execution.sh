#!/usr/bin/env bash
set -euo pipefail

# Auto-load scripts/e2e/.env if present (same convention as http-workflow.sh):
# every var below has a script-level ${VAR:-default} fallback, so anything set
# in .env wins over the hardcoded default. See scripts/e2e/README.md.
E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

# ---------------------------------------------------------------------------
# Long-running agent execution e2e — T03 of
# manual-loops/agents/long-running-agent-executions.md.
#
# Proves the async execution contract for an agent execution that takes LONGER
# than any default HTTP client timeout, on the REAL pipeline (api-gateway ->
# ai-agent-gateway -> JetStream -> agent-ai-service -> Redis projector), with
# the slowness injected by T02's deterministic, env-gated delay hook
# (`AGENT_TEST_DELAY_ENABLED` + per-execution `__test_delay_ms`,
# services/agent-ai-service/src/nats-handlers/test-delay.ts).
#
# The five evidence points of the SPEC, and where each is asserted:
#
#   1. IMMEDIATE HANDLE (stage 6) — `POST /api/runtime/executions` carrying
#      `metadata.__test_delay_ms` returns 202 + `{executionId, status:
#      "accepted"}` in < HANDLE_MAX_S seconds, measured with curl's own
#      `%{time_total}`, and the curl process EXITS (connection closed) while
#      the execution is still non-terminal — asserted right after by a GET
#      that must report `pending`/`started`. The SSE variants
#      (`POST /runtime/executions/stream`) are deliberately NOT used: they
#      hold a connection for the whole wait, which is exactly what decision 2
#      of the SPEC forbids.
#   2. CONTENTION PROBE (stage 7) — while the long execution waits, one
#      normal `e2e-http-log`-style workflow run (jsFunction + endpointCall +
#      serviceCall, the action shape http-workflow.sh builds for its
#      `e2e-http-log` workflow) is fired
#      over its own http channel and must reach COMPLETED within
#      PROBE_BUDGET_S, AND the long execution must still be non-terminal at
#      that moment (proving the two really overlapped). Per T01 finding 1 the
#      agent-ai consumer is SERIAL per tenant, so the probe deliberately
#      touches neither agent-ai-service nor its consumer.
#   3. COMPLETION (stage 9) — poll `GET /api/runtime/executions/:id` (single
#      Redis GET; tolerates pending/started, per T01 finding 2) until
#      terminal; assert `state == completed`, wall-clock duration from submit
#      >= the injected delay, the echoed reply carries this run's nonce, and
#      model/provider/usage are present. Stage 10 additionally greps
#      agent-ai-service for the hook's own `[test-delay] End after <n>ms`
#      line for THIS executionId and asserts n >= the delay — direct proof
#      the wait happened inside the execution, not somewhere else.
#   4. ZERO REDELIVERIES (stage 11) — the agent-ai durable consumer's
#      JetStream info (`/jsz` on the nats pod's monitoring port) is captured
#      before the submit and after completion: `num_redelivered` must not
#      have grown and `num_ack_pending` must have drained to 0.
#   5. RESOURCE EVIDENCE (stages 5/8/12) — `kubectl top pod` for
#      agent-ai-service + ai-agent-gateway before / during-the-wait / after,
#      all three printed. Only ONE resource assertion can fail the run: the
#      during-wait CPU of agent-ai-service against a deliberately generous
#      ceiling (CPU_CEILING_MILLICORES, default 500m vs ~10m observed idle) —
#      a sleeping execution must look like sleep, not like a busy-wait.
#      Memory is report-only.
#
# T04 — THE WORKFLOW PATH (stages 13-15), appended AFTER the direct path's
# execution has completed and its JetStream message is acked, because the
# agent-ai consumer is SERIAL per tenant (T01 finding 1): a second long agent
# execution started earlier would simply queue. A nonce-scoped workflow whose
# only action is an `agentCall` against the SAME ephemeral agent is triggered
# the way production does it — ONE webhook POST to that workflow's own private
# http channel — and the delay travels in the action args
# (`args.metadata.__test_delay_ms`), NOT in the webhook body, which
# structurally cannot carry it. `stage_run_agent_workflow` documents both
# routes that were tested live and why the webhook trigger is the only one
# that carries the key AND keeps the run's causal chain intact.
# The run must: complete; carry no Temporal `failure` (heartbeats, emitted
# every 15s against a 30s heartbeatTimeout, covered the whole wait); last at
# least the injected delay; echo this run's nonce back through the agent; and
# produce EXACTLY ONE agent `execution_completed` (plus exactly one
# `execution_requested`, zero `execution_failed`) on its tracking chain — the
# no-duplicate/no-retry guard that matters because the 120s wait sits right at
# JetStream's 2-minute duplicate window. The normal-workflow contention probe
# runs alongside this wait too (stage 13b).
#
# ISOLATION (T01 finding 5 — hard requirement, not a preference): this run
# provisions its OWN nonce-suffixed echo agent. The shared, fixed
# `e2e-http-agent-echo` agent of http-workflow.sh must NEVER be delayed —
# a 120s delay on it would blow that suite's 120s poll budget and turn G2b
# red. Channel + workflow names are nonce-suffixed too, for the same reason
# http-workflow.sh does it (workflow apply's `update()` is a no-op stub, so a
# reused workflow name could never be re-pointed at a fresh channel).
#
# Exit code 0 = every assertion above held; 1 = any stage failed. An EXIT trap
# tears down this run's manifest resources (workflows, http account, ephemeral
# agent), skipped under E2E_KEEP=1.
# ---------------------------------------------------------------------------

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
TENANT="${E2E_TENANT:-acme}"
EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
PASSWORD="${E2E_PASSWORD:-admin123}"

# SPEC decision 1: the delay is a PARAMETER of the e2e. Default 120000 ms
# (decision 3), hard-capped service-side at 600000 ms (T02).
DELAY_MS="${E2E_LONG_DELAY_MS:-120000}"
DELAY_S=$(( DELAY_MS / 1000 ))
# Evidence point 1's bound: the submit call must return a handle this fast.
HANDLE_MAX_S="${E2E_LONG_HANDLE_MAX_S:-5}"
# Evidence point 2's bound: a normal workflow run's budget while the long
# execution is in flight. Same class of budget as http-workflow.sh's
# POLL_TIMEOUT_S (120s) but deliberately capped BELOW the delay, so "the probe
# finished inside the long execution's wait" is provable, not incidental.
PROBE_BUDGET_S="${E2E_LONG_PROBE_BUDGET_S:-90}"
# Completion poll bound: the delay itself plus margin for JetStream delivery,
# the mock LLM, the Redis projector hop and poll granularity.
COMPLETION_TIMEOUT_S="${E2E_LONG_COMPLETION_TIMEOUT_S:-$(( DELAY_S + 180 ))}"
# Evidence point 5's ONLY failing threshold. Idle agent-ai-service measures
# ~10m on this dev cluster; 500m is ~50x that and still far below a real
# busy-wait (which would pin a core at ~1000m).
CPU_CEILING_MILLICORES="${E2E_LONG_CPU_CEILING_MILLICORES:-500}"
# How long the preflight waits for a just-rebuilt agent-ai-service to finish
# draining its previous revision (see stage_preflight_revision_settled).
SETTLE_TIMEOUT_S="${E2E_LONG_SETTLE_TIMEOUT_S:-180}"

# --- T04 (workflow agentCall path) ------------------------------------------
# Its own delay parameter (SPEC decision 1), defaulting to the SAME 120s target
# as the direct path so the default run proves decision 3 on BOTH paths. Lower
# it (e.g. E2E_WORKFLOW_DELAY_MS=30000) only to shorten a local iteration —
# the assertions stay identical, just against a smaller number.
WORKFLOW_DELAY_MS="${E2E_WORKFLOW_DELAY_MS:-120000}"
WORKFLOW_DELAY_S=$(( WORKFLOW_DELAY_MS / 1000 ))
# Poll bound for the Temporal run. Generous vs the Temporal budgets it must
# fit inside (startToClose 15m, heartbeatTimeout 30s with a heartbeat every
# 15s, AGENT_CALL_TIMEOUT_MS 900s — T01 finding 4).
WORKFLOW_COMPLETION_TIMEOUT_S="${E2E_WORKFLOW_COMPLETION_TIMEOUT_S:-$(( WORKFLOW_DELAY_S + 180 ))}"
# Tracking-chain read bound (ingester Postgres read behind the gateway) —
# same class of budget as http-workflow.sh's CHAIN_TIMEOUT_S.
CHAIN_TIMEOUT_S="${E2E_LONG_CHAIN_TIMEOUT_S:-120}"

# Where JetStream's monitoring endpoint lives (evidence point 4). `/jsz` is
# read with wget from inside the nats pod — the nats image ships wget but no
# curl and no `nats` CLI (verified live), and there is no NATS ingress.
NATS_NAMESPACE="${E2E_NATS_NAMESPACE:-support-services-dev}"
NATS_POD="${E2E_NATS_POD:-nats-0}"
NATS_CONTAINER="${E2E_NATS_CONTAINER:-nats}"
NATS_MONITOR_PORT="${E2E_NATS_MONITOR_PORT:-8222}"
# Per-tenant ingress stream (`INGRESS-<TENANT>`, uppercased — verified live:
# INGRESS-ACME) and the durable the agent-ai consumer binds on every tenant
# stream (`DURABLE_NAME` in
# services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:18).
INGRESS_STREAM="${E2E_INGRESS_STREAM:-INGRESS-$(echo "$TENANT" | tr '[:lower:]' '[:upper:]')}"
AGENT_AI_DURABLE="${E2E_AGENT_AI_DURABLE:-agent-ai-service-consumer}"

# Pre-existing dev-cluster fixtures reused by the contention-probe workflow —
# same ids/rationale as http-workflow.sh (raw strings, never manifest refs:
# they are NOT manifest-created, and substitute-symbolic-refs.ts passes a
# plain string at an allowlisted key through byte-identical).
ENDPOINT_ADAPTER_ID="${E2E_ENDPOINT_ADAPTER_ID:-a2dcbf77-7b4f-4a7b-b8ac-3e48c6496f0d}"
SERVICE_CALL_SERVICE_ID="${E2E_SERVICE_CALL_SERVICE_ID:-8272b109-e5c5-47d8-b533-bce1d8610495}"
SERVICE_CALL_SERVICE_SLUG="${E2E_SERVICE_CALL_SERVICE_SLUG:-sample-echo}"

# This run's manifest identity. The manifest NAME is fixed (its revision just
# increments); every RESOURCE name carries the nonce — including the agent,
# which is the whole point of the isolation rule above.
MANIFEST_NAME="e2e-long-agent-execution"
ACCOUNT_EXTERNAL_PREFIX="manifest:e2e-long-agent"
CHANNEL_NAME_PREFIX="e2e-long-agent"
WORKFLOW_NAME_PREFIX="e2e-long-probe"
AGENT_NAME_PREFIX="e2e-long-agent-echo"
# T04: the agentCall workflow and the PRIVATE http channel its trigger is
# pinned to. Stage 13 posts exactly one webhook to this channel (with its own
# appSecret) to start the run — the production trigger path, which is what
# keeps the run's causal chain intact for the stage-15 chain assertion. The
# channel is separate from the probe channel so a contention-probe webhook can
# never also start a 120s agent execution. The delay is NOT in that webhook
# body (the trigger consumer's request shape is fixed and would bury it under
# `request.envelope`); it rides in the workflow's own action args as
# `args.metadata.__test_delay_ms` — see stage_run_agent_workflow for both
# routes tested live and the rationale. Both names share the
# ACCOUNT_EXTERNAL_PREFIX/`e2e-long-agent` stem so the existing cleanup sweeps
# reclaim them unchanged.
AGENT_WORKFLOW_NAME_PREFIX="e2e-long-agentflow"
AGENTFLOW_CHANNEL_NAME_PREFIX="e2e-long-agentflow-ch"

# macOS mDNS resolves *.dev.local in ~5s even with /etc/hosts entries;
# --resolve skips DNS. Override/disable via E2E_RESOLVE_IP. (Identical to
# http-workflow.sh — and load-bearing here: evidence point 1 asserts a < 5s
# handle, which a 5s mDNS tax alone would blow.)
E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"
API_SCHEME="${API_URL%%://*}"
API_HOST_PORT="${API_URL#*://}"
API_HOST_PORT="${API_HOST_PORT%%/*}"
if [[ "$API_HOST_PORT" == *:* ]]; then
  API_PORT="${API_HOST_PORT##*:}"
elif [[ "$API_SCHEME" == "https" ]]; then
  API_PORT=443
else
  API_PORT=80
fi
RESOLVE_ARGS=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  RESOLVE_ARGS=(--resolve "${HOST_HEADER}:${API_PORT}:${E2E_RESOLVE_IP}")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-long-$(date +%s)-$RANDOM"
PROBE_NONCE="e2e-long-probe-$(date +%s)-$RANDOM"
# T04: a SECOND probe nonce, for the contention probe that runs alongside the
# workflow-path long execution (stage 13). Distinct so the two probe runs can
# never be confused in the executions list.
PROBE_NONCE_WF="e2e-long-probe-wf-$(date +%s)-$RANDOM"
# T04: the request nonce of the agentCall workflow run — echoed back by the
# mock provider, so the run's own result proves it reached the real agent.
WORKFLOW_NONCE="e2e-long-wf-$(date +%s)-$RANDOM"
CHANNEL_NAME="${CHANNEL_NAME_PREFIX}-${NONCE}"
WORKFLOW_NAME="${WORKFLOW_NAME_PREFIX}-${NONCE}"
AGENT_NAME="${AGENT_NAME_PREFIX}-${NONCE}"
AGENT_WORKFLOW_NAME="${AGENT_WORKFLOW_NAME_PREFIX}-${NONCE}"
AGENTFLOW_CHANNEL_NAME="${AGENTFLOW_CHANNEL_NAME_PREFIX}-${NONCE}"

TOKEN=""
APP_SECRET=""
AGENTFLOW_APP_SECRET=""
ACCOUNT_ID=""
AGENT_ID=""
WORKFLOW_ID=""
# T04 handles, captured by stage_apply_manifest / stage_run_agent_workflow.
AGENT_WORKFLOW_ID=""
AGENTFLOW_ACCOUNT_ID=""
AGENT_RUN_EXECUTION_ID=""
AGENT_RUN_START_EPOCH=0
AGENT_RUN_CORRELATION_ID=""
# The long execution's handle + timing, captured by stage_submit_long_execution.
EXECUTION_ID=""
SUBMIT_EPOCH=0
COMPLETED_EPOCH=0
# JetStream consumer counters (evidence point 4).
REDELIVERED_BEFORE=""
ACK_PENDING_BEFORE=""

cleanup_e2e_resources() {
  # Best-effort, idempotent, account-scoped teardown of THIS run's footprint
  # (same contract as http-workflow.sh's cleanup: every call `|| true`-ish,
  # never changes the run's exit status, matched by NAME PREFIX so a crashed
  # prior run's stragglers are reclaimed too). E2E_KEEP=1 skips it.
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    warn "Cleanup: E2E_KEEP=1 set — leaving this run's workflow/account/ephemeral agent in place"
    return 0
  fi
  log "Cleanup: removing this run's probe workflow, http account, and ephemeral agent (best-effort)"
  local id
  local wf_ids
  wf_ids="$(api GET /api/workflows 2>/dev/null \
    | jq -r ".[] | select(.name | startswith(\"${WORKFLOW_NAME_PREFIX}\") or startswith(\"${AGENT_WORKFLOW_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $wf_ids; do
    cleanup_delete "workflow" "/api/workflows/${id}" "${id}"
  done
  local acc_ids
  acc_ids="$(api GET "/api/channels/accounts?channel=http" 2>/dev/null \
    | jq -r ".[] | select(.externalId | startswith(\"${ACCOUNT_EXTERNAL_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $acc_ids; do
    cleanup_delete "http account" "/api/channels/accounts/${id}" "${id}"
  done
  # Ephemeral agents — matched by PREFIX so this never touches the shared,
  # fixed `e2e-http-agent-echo` agent of http-workflow.sh.
  local agent_ids
  agent_ids="$(api GET /api/admin/agents 2>/dev/null \
    | jq -r ".agents[]? | select(.name | startswith(\"${AGENT_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $agent_ids; do
    cleanup_delete "ephemeral agent" "/api/admin/agents/${id}" "${id}"
  done
  log "Cleanup: done"
}

cleanup_delete() {
  # cleanup_delete <label> <path> <id>
  # Best-effort DELETE reporting the REAL HTTP status (curl exits 0 on 4xx/5xx
  # without -f, so `if api DELETE` would log false successes). Only 2xx/404
  # count as success. Never returns non-zero.
  local label="$1" path="$2" id="$3"
  local combined status body
  # '{}' body: api()/api_status() always send Content-Type: application/json,
  # and a DELETE with an EMPTY body 400s at the gateway.
  combined="$(api_status DELETE "$path" '{}' 2>/dev/null || true)"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  case "$status" in
    2??|404) log "Cleanup: deleted ${label} ${id} (status ${status})" ;;
    *) warn "Cleanup: failed to delete ${label} ${id} (status ${status}: ${body}) — non-fatal" ;;
  esac
}

on_exit() {
  local exit_code=$?
  cleanup_e2e_resources
  exit "$exit_code"
}
trap on_exit EXIT

api() {
  # api <method> <path> [json-body] — same transport/timeout guards as
  # http-workflow.sh. NOTE: the long wait is NEVER wrapped in one curl
  # (T01 finding 3) — stage_wait_completion polls with these same bounded
  # calls instead.
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status() {
  # api_status <method> <path> [json-body] — body plus a final line holding
  # the HTTP status; split with api_status_body/api_status_code.
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -w '\n%{http_code}' -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status_body() { local combined="$1"; printf '%s' "${combined%$'\n'*}"; }
api_status_code() { local combined="$1"; printf '%s' "${combined##*$'\n'}"; }

# --------------------------------------------------------------------------
# Stage 0 — preflight. Everything this run structurally depends on is checked
# HERE with an actionable message, so a missing dev-overlay env fails in two
# seconds instead of producing a mysteriously fast "long" execution.
# --------------------------------------------------------------------------
stage_preflight() {
  log "Stage 0: preflight (delay=${DELAY_MS}ms, handle budget=${HANDLE_MAX_S}s, probe budget=${PROBE_BUDGET_S}s, completion timeout=${COMPLETION_TIMEOUT_S}s)"
  command -v jq >/dev/null || { err "jq is required"; return 1; }
  command -v kubectl >/dev/null || { err "kubectl is required (resource + JetStream evidence)"; return 1; }

  if (( DELAY_MS <= 0 )); then
    err "E2E_LONG_DELAY_MS must be a positive number of milliseconds (got '${DELAY_MS}')"
    return 1
  fi
  if (( DELAY_MS > 600000 )); then
    err "E2E_LONG_DELAY_MS=${DELAY_MS} exceeds the service-side hard cap of 600000ms (T02) — the hook would clamp it and the duration assertion would be meaningless"
    return 1
  fi
  if (( PROBE_BUDGET_S >= DELAY_S )); then
    err "E2E_LONG_PROBE_BUDGET_S=${PROBE_BUDGET_S} must be strictly smaller than the delay (${DELAY_S}s), otherwise the contention probe cannot prove it ran DURING the wait"
    return 1
  fi
  # Same three guards for the T04 workflow-path delay.
  if (( WORKFLOW_DELAY_MS <= 0 )); then
    err "E2E_WORKFLOW_DELAY_MS must be a positive number of milliseconds (got '${WORKFLOW_DELAY_MS}')"
    return 1
  fi
  if (( WORKFLOW_DELAY_MS > 600000 )); then
    err "E2E_WORKFLOW_DELAY_MS=${WORKFLOW_DELAY_MS} exceeds the service-side hard cap of 600000ms (T02) — the hook would clamp it and the duration assertion would be meaningless"
    return 1
  fi
  if (( PROBE_BUDGET_S >= WORKFLOW_DELAY_S )); then
    err "E2E_LONG_PROBE_BUDGET_S=${PROBE_BUDGET_S} must be strictly smaller than the workflow delay (${WORKFLOW_DELAY_S}s), otherwise stage 13b's probe cannot prove it ran DURING the agentCall wait"
    return 1
  fi

  # The delay hook's gate (T02 decision 4). Declared in
  # knative/services/overlays/local/{postgres-dev,mongo-dev}/env-patches.yaml,
  # but `rebuild-redeploy.sh` only patches the IMAGE — it never re-applies the
  # overlay — so a freshly rebuilt cluster can legitimately lack it.
  local delay_env
  delay_env="$(kubectl get ksvc agent-ai-service -n "$NAMESPACE" \
    -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' 2>/dev/null || true)"
  if ! grep -q '^AGENT_TEST_DELAY_ENABLED=true$' <<<"$delay_env"; then
    err "AGENT_TEST_DELAY_ENABLED=true is NOT live on ksvc/agent-ai-service in ${NAMESPACE} — the delay hook would be inert and this e2e would prove nothing."
    err "Fix: kubectl apply -k knative/services/overlays/local/postgres-dev   (the overlay declares it; rebuild-redeploy.sh only patches the image)"
    err "Env currently declared on the ksvc: $(echo "$delay_env" | tr '\n' ' ')"
    return 1
  fi
  log "Preflight: AGENT_TEST_DELAY_ENABLED=true is live on ksvc/agent-ai-service"

  if ! grep -q '^RUNTIME_ALLOW_MOCK_PROVIDER=true$' <<<"$delay_env"; then
    err "RUNTIME_ALLOW_MOCK_PROVIDER=true is NOT live on ksvc/agent-ai-service — the ephemeral echo agent (provider 'mock') would fail every execution."
    err "Fix: kubectl apply -k knative/services/overlays/local/postgres-dev"
    return 1
  fi
  log "Preflight: RUNTIME_ALLOW_MOCK_PROVIDER=true is live on ksvc/agent-ai-service"

  # Resource evidence needs metrics-server; JetStream evidence needs the nats
  # pod's monitoring endpoint. Both are hard dependencies of stages 5/8/11/12.
  if ! kubectl top pod -n "$NAMESPACE" --no-headers >/dev/null 2>&1; then
    err "'kubectl top pod' is unavailable in ${NAMESPACE} (metrics-server down?) — evidence point 5 cannot be produced"
    return 1
  fi
  log "Preflight: 'kubectl top pod' available in ${NAMESPACE}"

  local probe
  probe="$(consumer_info_json || true)"
  if [[ -z "$probe" || "$probe" == "null" ]]; then
    err "Could not read JetStream consumer '${AGENT_AI_DURABLE}' on stream '${INGRESS_STREAM}' via ${NATS_POD}:${NATS_MONITOR_PORT}/jsz — evidence point 4 cannot be produced"
    err "Checked: kubectl exec -n ${NATS_NAMESPACE} ${NATS_POD} -c ${NATS_CONTAINER} -- wget -qO- 'http://localhost:${NATS_MONITOR_PORT}/jsz?consumers=true&streams=true'"
    return 1
  fi
  log "Preflight: JetStream consumer visible — $(echo "$probe" | jq -c '{num_ack_pending, num_redelivered, num_pending}')"

  # A leftover in-flight (un-acked) message would make evidence point 4
  # unreadable: this run could not tell its own ack-pending from someone
  # else's, and a stale redelivery landing mid-run would look like OUR
  # redelivery. Fail fast, loudly, with the wait-it-out instruction.
  local pending_before
  pending_before="$(echo "$probe" | jq -r '.num_ack_pending')"
  if [[ "$pending_before" != "0" ]]; then
    err "Consumer '${AGENT_AI_DURABLE}' already has num_ack_pending=${pending_before} on '${INGRESS_STREAM}' — another agent execution is still in flight (or a killed pod left one un-acked, which JetStream redelivers only after the 900s ackWait)."
    err "Evidence point 4 (zero redeliveries + ack-pending drain) is only meaningful from a clean baseline — wait for it to reach 0 and re-run."
    return 1
  fi

  stage_preflight_revision_settled
}

stage_preflight_revision_settled() {
  # A draining OLD revision pod is fatal to this e2e in a way no other stage
  # can detect: the durable consumer is bound per POD, so an execution picked
  # up by a revision that is being scaled away is lost mid-delay (observed
  # live 2026-07-30 — the message stayed un-acked until the 900s ackWait, the
  # run timed out at stage 9 with state 'started', and the orphan poisoned the
  # next run's consumer baseline). `rebuild-redeploy.sh` returns as soon as
  # the NEW revision is Ready, so running this script immediately after a
  # rebuild is exactly when that overlap exists. Wait it out, bounded.
  local latest
  latest="$(kubectl get ksvc agent-ai-service -n "$NAMESPACE" \
    -o jsonpath='{.status.latestReadyRevisionName}' 2>/dev/null || true)"
  if [[ -z "$latest" ]]; then
    err "Could not resolve ksvc/agent-ai-service's latestReadyRevisionName in ${NAMESPACE}"
    return 1
  fi
  log "Preflight: waiting for agent-ai-service pods to settle on revision ${latest} (timeout ${SETTLE_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + SETTLE_TIMEOUT_S ))
  local stale=""
  while (( $(date +%s) < deadline )); do
    stale="$(kubectl get pods -n "$NAMESPACE" -l serving.knative.dev/service=agent-ai-service \
      -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.name}{" "}{.metadata.labels.serving\.knative\.dev/revision}{"\n"}{end}' 2>/dev/null \
      | awk -v r="$latest" 'NF && $2 != r { print $1 " (revision " $2 ")" }' || true)"
    if [[ -z "$stale" ]]; then
      log "Preflight: only revision ${latest} is running — no draining pod can steal this run's execution"
      return 0
    fi
    log "Preflight: still draining — ${stale//$'\n'/, }"
    sleep 5
  done
  err "agent-ai-service still has non-latest revision pods running after ${SETTLE_TIMEOUT_S}s: ${stale//$'\n'/, }"
  err "An execution picked up by a draining revision is lost mid-delay — wait for the rollout to finish and re-run."
  return 1
}

# --------------------------------------------------------------------------
# Evidence helpers — JetStream consumer info (point 4) and kubectl top (5).
# --------------------------------------------------------------------------
consumer_info_json() {
  # Echoes the agent-ai durable's consumer_detail object for this tenant's
  # ingress stream, or nothing. The nats image ships neither curl nor the
  # `nats` CLI (verified live), so `/jsz` is read with wget from inside the
  # pod — same "query the source of truth directly" pattern http-workflow.sh
  # uses for Postgres.
  kubectl exec -n "$NATS_NAMESPACE" "$NATS_POD" -c "$NATS_CONTAINER" -- \
    wget -qO- "http://localhost:${NATS_MONITOR_PORT}/jsz?consumers=true&streams=true" 2>/dev/null \
    | jq -c --arg s "$INGRESS_STREAM" --arg d "$AGENT_AI_DURABLE" \
        '[.account_details[]?.stream_detail[]? | select(.name == $s) | .consumer_detail[]? | select(.name == $d)][0] // empty' \
    || true
}

snapshot_resources() {
  # snapshot_resources <label> — prints `kubectl top pod` for both services.
  # REPORT evidence: never fails the run (a transient metrics gap must not
  # flip the exit code); the only failing resource check is the explicit CPU
  # ceiling in stage_snapshot_during.
  local label="$1"
  log "Resource snapshot [${label}]:"
  local top
  top="$(kubectl top pod -n "$NAMESPACE" \
      -l serving.knative.dev/service=agent-ai-service --no-headers 2>/dev/null || true)"
  if [[ -z "$top" ]]; then
    warn "  agent-ai-service: no metrics returned (report-only, not fatal)"
  else
    echo "$top" | while read -r line; do log "  agent-ai-service  ${line}"; done
  fi
  top="$(kubectl top pod -n "$NAMESPACE" \
      -l serving.knative.dev/service=ai-agent-gateway --no-headers 2>/dev/null || true)"
  if [[ -z "$top" ]]; then
    warn "  ai-agent-gateway: no metrics returned (report-only, not fatal)"
  else
    echo "$top" | while read -r line; do log "  ai-agent-gateway  ${line}"; done
  fi
}

agent_ai_cpu_millicores() {
  # Echoes the highest CPU reading (in millicores) across agent-ai-service
  # pods, or nothing when metrics are unavailable. `kubectl top` prints either
  # `<n>m` or a whole-core `<n>`; both are normalised here.
  kubectl top pod -n "$NAMESPACE" -l serving.knative.dev/service=agent-ai-service \
      --no-headers 2>/dev/null \
    | awk '{ v=$2; if (v ~ /m$/) { sub(/m$/, "", v); n=v+0 } else { n=v*1000 } if (n>max) max=n } END { if (max != "") print max }'
}

# --------------------------------------------------------------------------
# Stages 1-4 — login + declarative provisioning (one IntegrationManifest,
# exactly like http-workflow.sh: channel + ephemeral agent + probe workflow).
# --------------------------------------------------------------------------
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

e2e_manifest_body() {
  # One IntegrationManifest declaring everything this run needs:
  #  - an http channel (per-run name -> per-run `manifest:<name>` externalId),
  #  - the EPHEMERAL echo agent (nonce-suffixed; provider 'mock' = the dev
  #    echo provider gated by RUNTIME_ALLOW_MOCK_PROVIDER). The delay is NOT
  #    a property of the agent — it travels per execution in
  #    `metadata.__test_delay_ms`, so this agent is only "slow" for the one
  #    execution stage 6 submits,
  #  - the contention-probe workflow: the same action shape http-workflow.sh
  #    builds for its `e2e-http-log` workflow — the `logMessage` jsFunction +
  #    `probeEndpoint` endpointCall + `probeService` serviceCall trio —
  #    which deliberately touches NEITHER agent-ai-service NOR its serial
  #    per-tenant consumer (T01 finding 1),
  #  - (T04) the agentCall workflow, whose single action targets the SAME
  #    ephemeral agent via the `agentRef` substitution, plus its own private
  #    http channel. That channel exists so this workflow's `message_received`
  #    trigger is pinned somewhere OTHER than the probe channel: sharing the
  #    probe channel (the http-workflow.sh pattern) would make every
  #    contention-probe webhook ALSO start a 120s agent execution, which the
  #    serial per-tenant consumer would then queue behind the direct long
  #    execution. Stage 13 posts exactly one webhook to it.
  #    The delay travels in the ACTION ARGS (`args.metadata.__test_delay_ms`),
  #    not in the webhook body — see stage_run_agent_workflow for the two
  #    routes that were checked and why this is the only one that carries the
  #    key AND keeps the causal chain intact. `metadata` is an extra key on
  #    `AgentChatRequest`: the action validator only type-checks the fields it
  #    knows (workflow-action.validator.ts's isAgentCallArgs), the manifest
  #    substitution walker passes unrecognised keys through byte-identical,
  #    and `agent-call.activity.ts` forwards the whole args object into
  #    `submitExecution` — so it lands at `input.metadata` exactly like the
  #    direct path's body field.
  # Raw `adapterId`/`serviceId` strings are pre-existing dev fixtures, never
  # `{connectorRef}`/`{serviceRef}` objects — same rationale as
  # http-workflow.sh.
  cat <<JSON
{
  "apiVersion": "yoizen.io/v1",
  "kind": "IntegrationManifest",
  "metadata": { "name": "${MANIFEST_NAME}" },
  "spec": {
    "channels": [
      { "name": "${CHANNEL_NAME}", "type": "http", "direction": "inbound" },
      { "name": "${AGENTFLOW_CHANNEL_NAME}", "type": "http", "direction": "inbound" }
    ],
    "agents": [
      {
        "name": "${AGENT_NAME}",
        "profile": {
          "system_prompt": "You are the long-execution e2e echo agent. Echo the user's message back verbatim.",
          "model_config": { "provider": "mock", "model": "echo" }
        }
      }
    ],
    "workflows": [
      {
        "name": "${WORKFLOW_NAME}",
        "definition": {
          "application": "e2e",
          "actions": [
            {
              "name": "logMessage",
              "activity": "jsFunction",
              "args": {
                "code": "(ctx) => { console.log('[e2e-long-probe]', ctx.request.from, ctx.request.text); return ctx.request.text; }"
              }
            },
            {
              "name": "probeEndpoint",
              "activity": "endpointCall",
              "args": {
                "adapterId": "${ENDPOINT_ADAPTER_ID}",
                "method": "GET",
                "url": "/api/v2/pokemon/ditto"
              }
            },
            {
              "name": "probeService",
              "activity": "serviceCall",
              "args": {
                "serviceId": "${SERVICE_CALL_SERVICE_ID}",
                "serviceSlug": "${SERVICE_CALL_SERVICE_SLUG}",
                "method": "POST",
                "path": "/anything",
                "data": { "nonce": "{{request.text}}" }
              }
            }
          ],
          "trigger": {
            "type": "message_received",
            "mode": "shared",
            "config": {
              "channels": ["http"],
              "providers": ["http"],
              "accountIds": [ { "channelRef": "${CHANNEL_NAME}" } ]
            }
          }
        }
      },
      {
        "name": "${AGENT_WORKFLOW_NAME}",
        "definition": {
          "application": "e2e",
          "actions": [
            {
              "name": "callAgent",
              "activity": "agentCall",
              "args": {
                "agentId": { "agentRef": "${AGENT_NAME}" },
                "message": "{{request.text}}",
                "metadata": { "__test_delay_ms": ${WORKFLOW_DELAY_MS} }
              }
            }
          ],
          "trigger": {
            "type": "message_received",
            "mode": "shared",
            "config": {
              "channels": ["http"],
              "providers": ["http"],
              "accountIds": [ { "channelRef": "${AGENTFLOW_CHANNEL_NAME}" } ]
            }
          }
        }
      }
    ]
  }
}
JSON
}

stage_apply_manifest() {
  log "Stage 2: PUT+plan+apply manifest '${MANIFEST_NAME}' (channels=['${CHANNEL_NAME}','${AGENTFLOW_CHANNEL_NAME}'], agent='${AGENT_NAME}', workflows=['${WORKFLOW_NAME}','${AGENT_WORKFLOW_NAME}'])"
  local body put_resp put_revision
  body="$(e2e_manifest_body)"
  put_resp="$(api PUT "/api/provisioning/manifests/${MANIFEST_NAME}" "$body")"
  put_revision="$(echo "$put_resp" | jq -r '.revision // empty')"
  if [[ -z "$put_revision" ]]; then
    err "Manifest PUT did not return a revision: $put_resp"
    return 1
  fi
  log "Manifest '${MANIFEST_NAME}' PUT -> revision ${put_revision}"

  local plan_resp
  # '{}' body: api() always sets Content-Type: application/json, so an
  # empty-body POST 400s at the gateway.
  plan_resp="$(api POST "/api/provisioning/manifests/${MANIFEST_NAME}/plan" '{}')"
  log "Plan verdicts: $(echo "$plan_resp" | jq -c '[.resources[] | {kind, name, verdict}]')"

  local apply_resp applied_count
  apply_resp="$(api POST "/api/provisioning/manifests/${MANIFEST_NAME}/apply" '{}')"
  applied_count="$(echo "$apply_resp" | jq -r '.appliedCount // empty')"
  if [[ -z "$applied_count" ]]; then
    err "Manifest apply failed or returned no appliedCount: $apply_resp"
    return 1
  fi
  log "Manifest applied: appliedCount=${applied_count} noopCount=$(echo "$apply_resp" | jq -r '.noopCount // 0')"

  ACCOUNT_ID="$(echo "$apply_resp" | jq -r --arg n "$CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
  AGENTFLOW_ACCOUNT_ID="$(echo "$apply_resp" | jq -r --arg n "$AGENTFLOW_CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
  AGENT_ID="$(echo "$apply_resp" | jq -r --arg n "$AGENT_NAME" '.resources[] | select(.name == $n) | .externalId')"
  WORKFLOW_ID="$(echo "$apply_resp" | jq -r --arg n "$WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
  AGENT_WORKFLOW_ID="$(echo "$apply_resp" | jq -r --arg n "$AGENT_WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
  if [[ -z "$ACCOUNT_ID" || -z "$AGENTFLOW_ACCOUNT_ID" || -z "$AGENT_ID" || -z "$WORKFLOW_ID" || -z "$AGENT_WORKFLOW_ID" ]]; then
    err "Manifest apply response missing an expected externalId (channel=${ACCOUNT_ID:-<empty>} agentflowChannel=${AGENTFLOW_ACCOUNT_ID:-<empty>} agent=${AGENT_ID:-<empty>} workflow=${WORKFLOW_ID:-<empty>} agentWorkflow=${AGENT_WORKFLOW_ID:-<empty>}): $apply_resp"
    return 1
  fi
  log "Resolved externalIds: channel=${ACCOUNT_ID} agentflowChannel=${AGENTFLOW_ACCOUNT_ID} agent=${AGENT_ID} workflow=${WORKFLOW_ID} agentWorkflow=${AGENT_WORKFLOW_ID}"
}

stage_fetch_channel_secret() {
  # The apply engine never returns appSecret (channels-writer.ts keeps only
  # externalId); GET /api/channels/accounts/:id returns it unmasked. Both
  # channels need one: the probe channel (stages 7/13b) and the agentflow
  # channel (stage 13).
  log "Stage 3: fetch appSecrets for channel accounts ${ACCOUNT_ID} (probe) and ${AGENTFLOW_ACCOUNT_ID} (agentflow)"
  local resp
  resp="$(api GET "/api/channels/accounts/${ACCOUNT_ID}")"
  APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  if [[ -z "$APP_SECRET" ]]; then
    err "GET /api/channels/accounts/${ACCOUNT_ID} did not return appSecret: $resp"
    return 1
  fi
  resp="$(api GET "/api/channels/accounts/${AGENTFLOW_ACCOUNT_ID}")"
  AGENTFLOW_APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  if [[ -z "$AGENTFLOW_APP_SECRET" ]]; then
    err "GET /api/channels/accounts/${AGENTFLOW_ACCOUNT_ID} did not return appSecret: $resp"
    return 1
  fi
}

stage_publish_agent() {
  # Agent PUBLISH is runtime activation, not a manifest property (agentSchema
  # has no such field) — an explicit POST after apply, same as http-workflow.sh.
  log "Stage 4: ensure ephemeral agent ${AGENT_ID} ('${AGENT_NAME}') is published"
  local get_resp agent_status
  get_resp="$(api GET "/api/admin/agents/${AGENT_ID}")"
  agent_status="$(echo "$get_resp" | jq -r '.status // empty')"
  if [[ "$agent_status" == "published" ]]; then
    log "Agent ${AGENT_ID} already published"
    return 0
  fi
  local publish_resp publish_status
  publish_resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
  publish_status="$(echo "$publish_resp" | jq -r '.status // empty')"
  if [[ "$publish_status" != "published" ]]; then
    err "Agent publish failed: $publish_resp"
    return 1
  fi
  log "Agent ready: ${AGENT_ID} (published)"
}

# --------------------------------------------------------------------------
# Stage 5 — BEFORE snapshots (evidence points 4 + 5 baseline).
# --------------------------------------------------------------------------
stage_snapshot_before() {
  log "Stage 5: baseline snapshots (JetStream consumer + resources) BEFORE the long execution"
  local info
  info="$(consumer_info_json)"
  if [[ -z "$info" ]]; then
    err "Could not read consumer info for '${AGENT_AI_DURABLE}' on '${INGRESS_STREAM}'"
    return 1
  fi
  REDELIVERED_BEFORE="$(echo "$info" | jq -r '.num_redelivered')"
  ACK_PENDING_BEFORE="$(echo "$info" | jq -r '.num_ack_pending')"
  log "JetStream [before]: $(echo "$info" | jq -c '{num_ack_pending, num_redelivered, num_pending, delivered}')"
  snapshot_resources "before"
}

# --------------------------------------------------------------------------
# Stage 6 — EVIDENCE POINT 1: immediate handle, connection closed.
# --------------------------------------------------------------------------
stage_submit_long_execution() {
  log "Stage 6: submit the long execution (agent ${AGENT_ID}, __test_delay_ms=${DELAY_MS}) — asserting a handle in < ${HANDLE_MAX_S}s"
  local payload
  payload="$(jq -nc --arg a "$AGENT_ID" --arg m "$NONCE" --argjson d "$DELAY_MS" \
    '{agentId: $a, message: $m, metadata: {__test_delay_ms: $d}}')"

  # Deliberately NOT api_status(): this call also needs curl's own
  # %{time_total} for the handle-latency assertion. Same transport/timeout
  # guards otherwise. curl RETURNING is itself the "connection closed"
  # evidence — nothing streams here, and the follow-up GET below proves the
  # result had not been produced when the socket closed.
  local args=(-s --connect-timeout 10 --max-time 45 -w '\n%{http_code}\n%{time_total}'
    -X POST "${API_URL}/api/runtime/executions"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}"
    -H "Authorization: Bearer ${TOKEN}"
    -d "$payload")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")

  SUBMIT_EPOCH="$(date +%s)"
  local combined
  combined="$(curl "${args[@]}")"
  local time_total status body
  time_total="${combined##*$'\n'}"
  combined="${combined%$'\n'*}"
  status="${combined##*$'\n'}"
  body="${combined%$'\n'*}"

  log "Submit responded: status=${status} time_total=${time_total}s body=${body}"
  if [[ "$status" != "202" ]]; then
    err "POST /api/runtime/executions returned ${status} (expected 202): ${body}"
    return 1
  fi
  EXECUTION_ID="$(echo "$body" | jq -r '.executionId // empty')"
  local accepted
  accepted="$(echo "$body" | jq -r '.status // empty')"
  if [[ -z "$EXECUTION_ID" || "$accepted" != "accepted" ]]; then
    err "Submit response is not a valid handle (executionId='${EXECUTION_ID:-<empty>}' status='${accepted:-<empty>}'): ${body}"
    return 1
  fi
  if ! awk -v t="$time_total" -v max="$HANDLE_MAX_S" 'BEGIN { exit !(t < max) }'; then
    err "Handle took ${time_total}s, above the ${HANDLE_MAX_S}s budget — the submit path is not returning immediately"
    return 1
  fi
  log "Immediate handle OK: executionId=${EXECUTION_ID} in ${time_total}s (< ${HANDLE_MAX_S}s), connection closed"

  # The other half of evidence point 1: the socket closed BEFORE any result
  # existed. A separate, later process (this GET) sees a non-terminal state.
  local combined2 status2 body2 state2
  combined2="$(api_status GET "/api/runtime/executions/${EXECUTION_ID}")"
  status2="$(api_status_code "$combined2")"
  body2="$(api_status_body "$combined2")"
  state2="$(echo "$body2" | jq -r '.state // empty')"
  if [[ "$status2" != "200" ]]; then
    err "GET /api/runtime/executions/${EXECUTION_ID} right after submit returned ${status2}: ${body2}"
    return 1
  fi
  case "$state2" in
    pending|started)
      log "Confirmed: execution is '${state2}' immediately after the handle — no result was delivered on the submit connection"
      ;;
    *)
      err "Execution reached state '${state2}' immediately after submit — the ${DELAY_MS}ms delay hook did NOT fire (is AGENT_TEST_DELAY_ENABLED live on the RUNNING revision?): ${body2}"
      return 1
      ;;
  esac
}

# --------------------------------------------------------------------------
# Stage 7 (and, for T04, stage 13b) — EVIDENCE POINT 2: contention probe
# DURING the wait. Parameterised over WHICH long execution it must overlap:
#   - "direct"   -> the T03 execution submitted over POST /runtime/executions
#   - "workflow" -> the T04 Temporal run whose agentCall is waiting
# Both variants run the SAME normal workflow (jsFunction + endpointCall +
# serviceCall, no agent hop), so the probe's own cost is identical.
# --------------------------------------------------------------------------
long_work_state() {
  # long_work_state <target> — echoes exactly one of:
  #   running          the long unit of work is still in flight
  #   <terminal state> whatever terminal state the API reported
  #   unreadable       the status could NOT be read (transport/JSON failure)
  #
  # "unreadable" is deliberately NOT collapsed into "running": every caller
  # uses this function as a HARD assertion input ("is it still waiting?"), so
  # a swallowed curl/jq failure must never be able to satisfy that assertion.
  # Both branches retry once before giving up, because a single timeout inside
  # an otherwise healthy run is a transport blip, not evidence.
  local target="$1"
  local attempt state
  for attempt in 1 2; do
    case "$target" in
      direct)
        # `|| true`: a curl/jq failure must not abort the script under
        # pipefail — it is reported as "unreadable" below instead.
        state="$(api GET "/api/runtime/executions/${EXECUTION_ID}" | jq -r '.state // empty')" || true
        case "$state" in
          pending|started) printf 'running'; return 0 ;;
          "") ;;  # unreadable — retry once, then report it as such
          *) printf '%s' "$state"; return 0 ;;
        esac
        ;;
      workflow)
        state="$(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions/${AGENT_RUN_EXECUTION_ID}" \
          | jq -r '.status // empty')" || true
        case "$state" in
          RUNNING|PENDING) printf 'running'; return 0 ;;
          "") ;;  # unreadable — retry once, then report it as such
          *) printf '%s' "$state"; return 0 ;;
        esac
        ;;
      *)
        printf 'unknown-target'
        return 0
        ;;
    esac
    if (( attempt == 1 )); then
      # >&2 — this function's stdout IS its return value (callers use
      # `$(long_work_state ...)`), so diagnostics must go to stderr only.
      warn "Could not read the ${target} long execution's status (empty response) — retrying once" >&2
      sleep 3
    fi
  done
  printf 'unreadable'
}

run_contention_probe() {
  # run_contention_probe <stage-label> <nonce> <overlap-target>
  local label="$1" nonce="$2" target="$3"
  log "${label}: contention probe — fire '${WORKFLOW_NAME}' (nonce ${nonce}) while the ${target} long execution waits (budget ${PROBE_BUDGET_S}s)"
  local webhook_args=(-s --connect-timeout 10 --max-time 45 -X POST "${API_URL}/api/webhooks/http/${TENANT}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-http-channel-token: ${APP_SECRET}"
    -d "{\"from\":\"e2e-long-probe\",\"text\":\"${nonce}\"}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && webhook_args+=("${RESOLVE_ARGS[@]}")
  local resp status
  local probe_start
  probe_start="$(date +%s)"
  resp="$(curl "${webhook_args[@]}")"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "accepted" ]]; then
    err "Probe webhook not accepted: $resp"
    return 1
  fi

  local deadline=$(( probe_start + PROBE_BUDGET_S ))
  local wf_status=""
  while (( $(date +%s) < deadline )); do
    # curl/jq timeouts inside a poll loop degrade to a retry (pipefail would
    # otherwise abort the run) — same guard as http-workflow.sh.
    wf_status="$(api GET "/api/workflows/${WORKFLOW_ID}/executions?pageSize=100" \
      | jq -r ".items[]? | select(.request.text == \"${nonce}\") | .status" | head -1)" || true
    if [[ "$wf_status" == "COMPLETED" ]]; then
      local elapsed=$(( $(date +%s) - probe_start ))
      log "Contention probe COMPLETED in ${elapsed}s (budget ${PROBE_BUDGET_S}s) while the ${target} long execution was in flight"

      # The probe is only meaningful if the long work really was still
      # waiting when it finished — assert that explicitly.
      local state
      state="$(long_work_state "$target")"
      if [[ "$state" == "running" ]]; then
        log "Confirmed overlap: the ${target} long execution is still running after the probe completed"
        return 0
      fi
      if [[ "$state" == "unreadable" ]]; then
        err "Could not read the ${target} long execution's status after the probe completed (two attempts) — the overlap is UNPROVEN, and an unproven assertion is a failed one"
        return 1
      fi
      err "The ${target} long execution already reached '${state}' before the probe finished — the two did not overlap, so this run proves nothing about contention (delay too short? gate off?)"
      return 1
    fi
    sleep 3
  done
  err "Contention probe did not reach COMPLETED within ${PROBE_BUDGET_S}s (last status '${wf_status:-<none>}') — the ${target} long execution appears to be stalling unrelated work"
  err "Recent probe-workflow executions:"
  api GET "/api/workflows/${WORKFLOW_ID}/executions?pageSize=20" | jq -c '.items[]? | {id, status, request}' >&2 || true
  return 1
}

stage_contention_probe() {
  run_contention_probe "Stage 7" "$PROBE_NONCE" "direct"
}

# --------------------------------------------------------------------------
# Stage 8 — EVIDENCE POINT 5 (the only failing resource check).
# --------------------------------------------------------------------------
stage_snapshot_during() {
  log "Stage 8: DURING-wait resource snapshot + CPU sanity ceiling (${CPU_CEILING_MILLICORES}m)"
  # Guard against measuring after the fact: if the execution already finished
  # this snapshot is not a "during" one at all.
  local state
  state="$(api GET "/api/runtime/executions/${EXECUTION_ID}" | jq -r '.state // empty')" || true
  if [[ "$state" != "pending" && "$state" != "started" ]]; then
    err "Execution ${EXECUTION_ID} is already '${state}' — cannot take a DURING-wait snapshot"
    return 1
  fi
  snapshot_resources "during (execution ${EXECUTION_ID} state=${state})"

  # Mid-flight redelivery sample (evidence point 4). `num_redelivered` in
  # JetStream's consumer info is a GAUGE of messages CURRENTLY in a
  # redelivered state, not a cumulative counter — verified live 2026-07-30:
  # a killed-pod message showed `num_redelivered: 1` from redelivery until it
  # was acked, then dropped back to 0. So the before/after comparison of
  # stage 11 alone could miss a redelivery that started AND finished inside
  # the run; this extra sample (plus stage 10's "exactly one [test-delay]
  # Start for this executionId") closes that gap.
  local info_mid redelivered_mid
  info_mid="$(consumer_info_json)"
  if [[ -n "$info_mid" ]]; then
    redelivered_mid="$(echo "$info_mid" | jq -r '.num_redelivered')"
    log "JetStream [during]: $(echo "$info_mid" | jq -c '{num_ack_pending, num_redelivered, num_pending}')"
    if [[ "$redelivered_mid" != "$REDELIVERED_BEFORE" ]]; then
      err "num_redelivered changed while the execution was still waiting: ${REDELIVERED_BEFORE} -> ${redelivered_mid} — the in-flight message is being redelivered"
      return 1
    fi
  else
    warn "Could not sample consumer info during the wait (report-only here; stage 11 still asserts the before/after comparison)"
  fi

  local cpu
  cpu="$(agent_ai_cpu_millicores)"
  if [[ -z "$cpu" ]]; then
    warn "agent-ai-service CPU metrics unavailable for the during-wait snapshot — ceiling check skipped (report-only)"
    return 0
  fi
  log "agent-ai-service CPU during the wait: ${cpu}m (generous ceiling ${CPU_CEILING_MILLICORES}m)"
  if (( cpu > CPU_CEILING_MILLICORES )); then
    err "agent-ai-service burned ${cpu}m CPU while an execution was merely SLEEPING (ceiling ${CPU_CEILING_MILLICORES}m) — that looks like a busy-wait, not a sleep"
    return 1
  fi
  log "CPU ceiling OK: a waiting execution looks like sleep, not a busy-wait"
}

# --------------------------------------------------------------------------
# Stage 9 — EVIDENCE POINT 3: completion, duration, payload.
# --------------------------------------------------------------------------
stage_wait_completion() {
  log "Stage 9: poll GET /api/runtime/executions/${EXECUTION_ID} until terminal (timeout ${COMPLETION_TIMEOUT_S}s)"
  local deadline=$(( SUBMIT_EPOCH + COMPLETION_TIMEOUT_S ))
  local body="" state=""
  while (( $(date +%s) < deadline )); do
    # Pre-terminal states are NOT failures (T01 finding 2): the projector
    # writes the terminal row only after `execution_completed`.
    body="$(api GET "/api/runtime/executions/${EXECUTION_ID}")" || true
    state="$(echo "$body" | jq -r '.state // empty')" || true
    case "$state" in
      completed|failed)
        COMPLETED_EPOCH="$(date +%s)"
        break
        ;;
      pending|started|"")
        sleep 3
        ;;
      *)
        log "Unexpected state '${state}' — continuing to poll"
        sleep 3
        ;;
    esac
  done

  if [[ "$state" != "completed" ]]; then
    err "Execution ${EXECUTION_ID} did not reach 'completed' within ${COMPLETION_TIMEOUT_S}s (last state '${state:-<none>}'): ${body}"
    return 1
  fi

  local elapsed=$(( COMPLETED_EPOCH - SUBMIT_EPOCH ))
  log "Execution ${EXECUTION_ID} completed after ${elapsed}s (injected delay ${DELAY_S}s)"
  if (( elapsed < DELAY_S )); then
    err "Execution completed in ${elapsed}s, FASTER than the injected ${DELAY_S}s delay — it did not really wait"
    return 1
  fi

  # Result payload completeness (the caller must get everything the buffered
  # path promises, not just a status flip).
  local reply model provider usage
  reply="$(echo "$body" | jq -r '.result.reply // empty')"
  model="$(echo "$body" | jq -r '.result.model // empty')"
  provider="$(echo "$body" | jq -r '.result.provider // empty')"
  usage="$(echo "$body" | jq -c '.result.usage // empty')"
  log "Result payload: model='${model}' provider='${provider}' usage=${usage:-<none>} reply='${reply}'"
  if [[ -z "$reply" ]]; then
    err "Completed execution carries an empty reply: ${body}"
    return 1
  fi
  if [[ "$reply" != *"$NONCE"* ]]; then
    err "Completed execution's reply does not echo this run's nonce ${NONCE}: ${reply}"
    return 1
  fi
  if [[ -z "$model" || -z "$provider" || -z "$usage" ]]; then
    err "Completed execution's result payload is incomplete (model='${model}' provider='${provider}' usage='${usage}'): ${body}"
    return 1
  fi
  log "Completion OK: terminal state, duration >= delay, and a complete result payload"
}

# --------------------------------------------------------------------------
# Stage 10 — the delay really happened INSIDE the execution (T02's own log).
# --------------------------------------------------------------------------
stage_verify_delay_hook_logs() {
  log "Stage 10: assert agent-ai-service logged the delay hook for execution ${EXECUTION_ID}"
  # Capture logs into a var THEN grep — never `kubectl logs | grep -q`: under
  # pipefail a matching grep closes the pipe, kubectl takes SIGPIPE (141) and
  # the `if` takes the FALSE branch exactly when the line WAS present
  # (documented race in http-workflow.sh's stage_verify_execution).
  local logs
  logs="$(kubectl logs -n "$NAMESPACE" -l serving.knative.dev/service=agent-ai-service \
      --since=15m --tail=10000 2>/dev/null || true)"
  if [[ -z "$logs" ]]; then
    err "No agent-ai-service logs available in ${NAMESPACE} — cannot verify the delay hook fired"
    return 1
  fi
  local start_line end_line start_count
  start_line="$(grep "\[test-delay\] Start" <<<"$logs" | grep "execution='${EXECUTION_ID}'" | tail -1 || true)"
  end_line="$(grep "\[test-delay\] End after" <<<"$logs" | grep "execution='${EXECUTION_ID}'" | tail -1 || true)"
  if [[ -z "$start_line" || -z "$end_line" ]]; then
    err "Did not find both '[test-delay] Start' and '[test-delay] End after' lines for execution ${EXECUTION_ID}"
    err "Start: ${start_line:-<none>}"
    err "End:   ${end_line:-<none>}"
    return 1
  fi
  log "Hook start: ${start_line}"
  log "Hook end:   ${end_line}"
  local waited_ms
  waited_ms="$(sed -n 's/.*\[test-delay\] End after \([0-9][0-9]*\)ms.*/\1/p' <<<"$end_line" | tail -1)"
  if [[ -z "$waited_ms" ]]; then
    err "Could not parse the waited duration out of: ${end_line}"
    return 1
  fi
  if (( waited_ms < DELAY_MS )); then
    err "The hook reported waiting ${waited_ms}ms, less than the requested ${DELAY_MS}ms"
    return 1
  fi
  log "Delay hook OK: waited ${waited_ms}ms >= ${DELAY_MS}ms inside execution ${EXECUTION_ID}"

  # Per-execution redelivery proof (evidence point 4, complementing the
  # consumer-info gauges of stages 8/11): the handler runs once per DELIVERY,
  # so a redelivered `execution_requested` would produce a SECOND
  # '[test-delay] Start' line for this same executionId. Exactly one =
  # exactly one delivery.
  start_count="$(grep -c "execution='${EXECUTION_ID}'" <<<"$(grep "\[test-delay\] Start" <<<"$logs" || true)" || true)"
  log "Deliveries of execution ${EXECUTION_ID} seen by the handler: ${start_count}"
  if [[ "$start_count" != "1" ]]; then
    err "Expected EXACTLY 1 '[test-delay] Start' line for execution ${EXECUTION_ID}, found ${start_count} — the message was delivered more than once"
    return 1
  fi
}

# --------------------------------------------------------------------------
# Stage 11 — EVIDENCE POINT 4: zero redeliveries, ack-pending drained.
# --------------------------------------------------------------------------
stage_verify_no_redeliveries() {
  log "Stage 11: JetStream consumer info AFTER completion (redeliveries + ack-pending drain)"
  # The runner acks only AFTER the handler returns (T01 finding 1), and the
  # gateway's own projector consumer also has to settle, so allow a short
  # bounded settle window before asserting the drain.
  local deadline=$(( $(date +%s) + 30 ))
  local info="" ack_pending="" redelivered=""
  while (( $(date +%s) < deadline )); do
    info="$(consumer_info_json)"
    if [[ -n "$info" ]]; then
      ack_pending="$(echo "$info" | jq -r '.num_ack_pending')"
      redelivered="$(echo "$info" | jq -r '.num_redelivered')"
      [[ "$ack_pending" == "0" ]] && break
      log "num_ack_pending=${ack_pending} — waiting for it to drain"
    fi
    sleep 3
  done
  if [[ -z "$info" ]]; then
    err "Could not read consumer info for '${AGENT_AI_DURABLE}' on '${INGRESS_STREAM}' after completion"
    return 1
  fi
  log "JetStream [after]: $(echo "$info" | jq -c '{num_ack_pending, num_redelivered, num_pending, delivered}')"
  if [[ "$redelivered" != "$REDELIVERED_BEFORE" ]]; then
    err "num_redelivered grew during the run: ${REDELIVERED_BEFORE} -> ${redelivered} — the long execution triggered at least one redelivery"
    return 1
  fi
  if [[ "$ack_pending" != "0" ]]; then
    err "num_ack_pending did not drain to 0 after completion (before=${ACK_PENDING_BEFORE}, after=${ack_pending})"
    return 1
  fi
  log "Zero redeliveries OK: num_redelivered stayed ${REDELIVERED_BEFORE}, num_ack_pending drained to 0"
}

# --------------------------------------------------------------------------
# Stage 12 — AFTER snapshot (evidence point 5, report-only).
# --------------------------------------------------------------------------
stage_snapshot_after() {
  log "Stage 12: resource snapshot AFTER completion (report-only)"
  snapshot_resources "after"
}

# --------------------------------------------------------------------------
# T04 — the WORKFLOW path: a Temporal run whose `agentCall` targets the same
# delayed agent. Sequenced strictly AFTER stage 11 (the direct execution has
# completed and its message is acked), because the agent-ai consumer is
# SERIAL per tenant (T01 finding 1): two overlapping long agent executions
# would queue, doubling the run's wall clock for no extra evidence.
#
# How the delay reaches the agent on THIS path, and how the run is started —
# BOTH routes were checked live before choosing (2026-07-30):
#   - Delay via the WEBHOOK BODY: impossible. `trigger-consumer.service.ts`
#     builds a FIXED request shape
#     (`{envelope, channel, provider, from, text, messageId, tenantId}`), so a
#     `__test_delay_ms` field in the webhook body lands at
#     `request.envelope.__test_delay_ms`, never at `request.__test_delay_ms`,
#     while the hook reads `variables.request.__test_delay_ms`.
#   - Start via `POST /api/workflows/:id/execute` with `{"request": {...}}`:
#     this DOES deliver the canonical key (`runWorkflow` sets
#     `variables.request = workflow.request`, and `agentCall` forwards
#     `{...resolvedArgs, variables: context.variables}`) — verified live, the
#     agent really waited 120s. But a directly-executed run has NO causal
#     context (only the trigger consumer supplies one from the incoming
#     envelope), so the agent execution gets its OWN correlation id and its
#     `execution_completed` lands on a DIFFERENT chain than the run's —
#     verified live: the run's chain held only workflow-service events. That
#     would gut the "the RUN's trace carries exactly one execution_completed"
#     assertion.
#   - CHOSEN: real webhook -> trigger -> workflow (the production path, causal
#     chain intact, exactly as http-workflow.sh's agent workflow), with the
#     delay carried in the ACTION ARGS as `args.metadata.__test_delay_ms`
#     (see e2e_manifest_body for why an unknown args key survives validation,
#     manifest substitution and the activity boundary). The value is this
#     script's WORKFLOW_DELAY_MS parameter, interpolated into the manifest.
# --------------------------------------------------------------------------
stage_run_agent_workflow() {
  log "Stage 13: trigger '${AGENT_WORKFLOW_NAME}' (agentCall -> agent ${AGENT_ID}, args.metadata.__test_delay_ms=${WORKFLOW_DELAY_MS}) via its own webhook channel"
  local webhook_args=(-s --connect-timeout 10 --max-time 45 -X POST "${API_URL}/api/webhooks/http/${TENANT}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-http-channel-token: ${AGENTFLOW_APP_SECRET}"
    -d "{\"from\":\"e2e-long-agentflow\",\"text\":\"${WORKFLOW_NONCE}\"}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && webhook_args+=("${RESOLVE_ARGS[@]}")

  AGENT_RUN_START_EPOCH="$(date +%s)"
  local resp status
  resp="$(curl "${webhook_args[@]}")"
  status="$(echo "$resp" | jq -r '.status // empty')"
  if [[ "$status" != "accepted" ]]; then
    err "Agentflow webhook not accepted: $resp"
    return 1
  fi

  # The trigger consumer starts the Temporal run asynchronously; poll the
  # executions list (by this run's nonce) for the id, same lookup
  # http-workflow.sh uses.
  local deadline=$(( AGENT_RUN_START_EPOCH + PROBE_BUDGET_S ))
  while (( $(date +%s) < deadline )); do
    AGENT_RUN_EXECUTION_ID="$(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions?pageSize=100" \
      | jq -r ".items[]? | select(.request.text == \"${WORKFLOW_NONCE}\") | .id" | head -1)" || true
    [[ -n "$AGENT_RUN_EXECUTION_ID" ]] && break
    sleep 2
  done
  if [[ -z "$AGENT_RUN_EXECUTION_ID" ]]; then
    err "No '${AGENT_WORKFLOW_NAME}' execution appeared for nonce ${WORKFLOW_NONCE} within ${PROBE_BUDGET_S}s — the webhook never reached the trigger consumer"
    api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions?pageSize=20" | jq -c '.items[]? | {id, status, request}' >&2 || true
    return 1
  fi
  log "Agent workflow run started: executionId=${AGENT_RUN_EXECUTION_ID} (nonce ${WORKFLOW_NONCE})"

  # Sanity: the run must NOT be finished already — otherwise the delay key
  # never reached the agent and every assertion below would be vacuous.
  local state
  state="$(long_work_state "workflow")"
  if [[ "$state" == "unreadable" ]]; then
    err "Could not read the status of agent workflow run ${AGENT_RUN_EXECUTION_ID} right after start (two attempts) — cannot establish that the run is waiting, so the stages below would assert nothing"
    return 1
  fi
  if [[ "$state" != "running" ]]; then
    err "Agent workflow run ${AGENT_RUN_EXECUTION_ID} is already '${state}' right after start — the ${WORKFLOW_DELAY_MS}ms delay did not reach the agent over the workflow path"
    err "Run detail: $(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions/${AGENT_RUN_EXECUTION_ID}")"
    return 1
  fi
  log "Agent workflow run is RUNNING — the agentCall is waiting on the delayed agent"
}

stage_contention_probe_workflow() {
  # T04's "the normal-workflow probe still passes alongside": the SAME probe
  # as stage 7, now overlapping the Temporal agentCall wait instead of the
  # direct execution.
  run_contention_probe "Stage 13b" "$PROBE_NONCE_WF" "workflow"
}

stage_wait_agent_workflow() {
  log "Stage 14: poll the agent workflow run ${AGENT_RUN_EXECUTION_ID} to a terminal status (timeout ${WORKFLOW_COMPLETION_TIMEOUT_S}s)"
  local deadline=$(( AGENT_RUN_START_EPOCH + WORKFLOW_COMPLETION_TIMEOUT_S ))
  local body="" status=""
  while (( $(date +%s) < deadline )); do
    body="$(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions/${AGENT_RUN_EXECUTION_ID}")" || true
    status="$(echo "$body" | jq -r '.status // empty')" || true
    case "$status" in
      COMPLETED|FAILED|TIMED_OUT|CANCELED|TERMINATED) break ;;
      *) sleep 3 ;;
    esac
  done

  local elapsed=$(( $(date +%s) - AGENT_RUN_START_EPOCH ))
  if [[ "$status" != "COMPLETED" ]]; then
    err "Agent workflow run ${AGENT_RUN_EXECUTION_ID} ended '${status:-<none>}' after ${elapsed}s instead of COMPLETED — a Temporal budget (startToClose 15m / heartbeatTimeout 30s / AGENT_CALL_TIMEOUT_MS 900s) or the agent itself failed"
    err "Run detail: ${body}"
    return 1
  fi
  log "Agent workflow run COMPLETED after ${elapsed}s (injected delay ${WORKFLOW_DELAY_S}s)"

  # Temporal budget coverage, asserted deterministically from the run record:
  # a heartbeatTimeout or startToClose breach surfaces as a non-COMPLETED
  # status AND a populated `failure` (IWorkflowFailureInfo). Both must be
  # clean — the heartbeats (emitted every 15s by agent-call.activity.ts
  # against a 30s heartbeatTimeout) covered the whole wait.
  local failure
  failure="$(echo "$body" | jq -c '.failure // empty')"
  if [[ -n "$failure" && "$failure" != "null" ]]; then
    err "Agent workflow run reports a failure even though status is COMPLETED: ${failure}"
    return 1
  fi
  if (( elapsed < WORKFLOW_DELAY_S )); then
    err "Agent workflow run finished in ${elapsed}s, FASTER than the injected ${WORKFLOW_DELAY_S}s delay — the delay key did not travel over the workflow path"
    return 1
  fi
  log "No Temporal failure recorded and duration >= the injected delay — heartbeats covered the ${WORKFLOW_DELAY_S}s wait"

  # The agentCall's own result must carry the echoed nonce, proving the run
  # completed BECAUSE the agent answered (not because an action was skipped).
  # Anchored to the EXACT result path of the manifest's 'callAgent' action —
  # `result.results.callAgent.data.reply` (the activity's HttpExecutionResult:
  # `{status, data: {reply, tool_calls}, headers}`, verified live) — rather
  # than a recursive-descent grab for any `.reply`, so a reply appearing
  # somewhere else in the run record can never stand in for the agent's.
  local reply
  reply="$(echo "$body" | jq -r '.result.results.callAgent.data.reply // empty')"
  if [[ -z "$reply" ]]; then
    err "Could not find the agentCall reply at result.results.callAgent.data.reply in the run result: ${body}"
    return 1
  fi
  local call_status
  call_status="$(echo "$body" | jq -r '.result.results.callAgent.status // empty')"
  if [[ "$call_status" != "200" ]]; then
    err "The 'callAgent' action reported status '${call_status:-<none>}' instead of 200: ${body}"
    return 1
  fi
  log "agentCall reply: '${reply}'"
  if [[ "$reply" != *"$WORKFLOW_NONCE"* ]]; then
    err "The agentCall reply does not echo this run's nonce ${WORKFLOW_NONCE}: ${reply}"
    return 1
  fi
  log "Workflow path OK: the delayed agent answered with this run's nonce"
}

stage_verify_agent_run_chain() {
  # EXACTLY ONE `execution_completed` for the agent execution of this run.
  # The chain also contains the WORKFLOW's own execution_started/completed
  # pair (producer `workflow-service`, T02 of manual-loops/
  # workflow-step-events.md), so the count is scoped by producer:
  # `ai-agent-gateway` is the producer of the agent-runtime lifecycle events
  # (execution.handler.ts publishes on
  # evt.<tenant>.ai-agent-gateway.automation.platform.internal.*) — verified
  # live against tracking.tracked_events.
  #
  # `execution_requested` is counted too: a Temporal activity retry would
  # re-submit and (outside JetStream's 2-minute duplicate window) produce a
  # second one. Exactly one requested + exactly one completed + zero failed
  # is the no-duplicate, no-retry contract of T04.
  log "Stage 15: resolve the agent run's correlation_id and assert exactly ONE agent execution_completed on its chain"
  local deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  while (( $(date +%s) < deadline )); do
    # `result.causal.correlation_id` is the webhook-triggered run's inherited
    # chain (http-workflow.sh stage 9's lookup). `stepEvents.actionCausal` is
    # the same value on runs where the causal snapshot only survived on the
    # step-event context — kept as a fallback so a shape change fails loudly
    # in the assertions below rather than silently here.
    AGENT_RUN_CORRELATION_ID="$(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions/${AGENT_RUN_EXECUTION_ID}" \
      | jq -r '.result.causal.correlation_id // .result.stepEvents.actionCausal.correlation_id // empty')" || true
    [[ -n "$AGENT_RUN_CORRELATION_ID" ]] && break
    sleep 3
  done
  if [[ -z "$AGENT_RUN_CORRELATION_ID" ]]; then
    err "Agent workflow run ${AGENT_RUN_EXECUTION_ID} never reported result.causal.correlation_id within ${CHAIN_TIMEOUT_S}s"
    err "Run detail: $(api GET "/api/workflows/${AGENT_WORKFLOW_ID}/executions/${AGENT_RUN_EXECUTION_ID}")"
    return 1
  fi
  log "Agent run correlation_id=${AGENT_RUN_CORRELATION_ID}"

  local chain_deadline=$(( $(date +%s) + CHAIN_TIMEOUT_S ))
  local combined status body completed_count requested_count failed_count
  while (( $(date +%s) < chain_deadline )); do
    combined="$(api_status GET "/api/tracking/chains/${AGENT_RUN_CORRELATION_ID}")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      completed_count="$(echo "$body" | jq '[.events[]? | select(.kind == "execution_completed" and .producer == "ai-agent-gateway")] | length')"
      requested_count="$(echo "$body" | jq '[.events[]? | select(.kind == "execution_requested" and .producer == "ai-agent-gateway")] | length')"
      failed_count="$(echo "$body" | jq '[.events[]? | select(.kind == "execution_failed" and .producer == "ai-agent-gateway")] | length')"
      if [[ "$completed_count" == "1" ]]; then
        log "Chain ${AGENT_RUN_CORRELATION_ID}: agent execution_requested=${requested_count} execution_completed=${completed_count} execution_failed=${failed_count} (total events $(echo "$body" | jq '.events | length'))"
        if [[ "$requested_count" != "1" ]]; then
          err "Expected exactly 1 agent execution_requested on the chain, got ${requested_count} — the agentCall activity was retried/re-submitted"
          return 1
        fi
        if [[ "$failed_count" != "0" ]]; then
          err "Chain carries ${failed_count} agent execution_failed event(s) — the long agentCall did not survive cleanly"
          return 1
        fi
        log "Exactly ONE agent execution_completed on the run's chain — no duplicate delivery, no retry"
        return 0
      fi
      # Fast-fail on a duplicate BEFORE logging a "retrying" line: more than
      # one agent execution_completed can never become correct by waiting.
      if [[ "${completed_count:-0}" -gt 1 ]]; then
        err "Chain ${AGENT_RUN_CORRELATION_ID} carries ${completed_count} agent execution_completed events — DUPLICATE delivery for a single agentCall"
        err "Events: $(echo "$body" | jq -c '[.events[]? | {kind, producer, occurred_at}]')"
        return 1
      fi
      log "Chain has ${completed_count:-0} agent execution_completed event(s) so far; retrying"
    else
      log "Chain endpoint returned status ${status}; retrying"
    fi
    sleep 3
  done
  err "Never observed exactly one agent execution_completed on chain ${AGENT_RUN_CORRELATION_ID} within ${CHAIN_TIMEOUT_S}s (last count '${completed_count:-<none>}', last status ${status})"
  err "Last response: ${body}"
  return 1
}

main() {
  stage_preflight
  stage_login
  stage_apply_manifest
  stage_fetch_channel_secret
  stage_publish_agent
  stage_snapshot_before
  stage_submit_long_execution
  stage_contention_probe
  stage_snapshot_during
  stage_wait_completion
  stage_verify_delay_hook_logs
  stage_verify_no_redeliveries
  stage_snapshot_after
  # T04 — the workflow path, strictly AFTER the direct execution has completed
  # and been acked (serial per-tenant consumer, T01 finding 1).
  stage_run_agent_workflow
  stage_contention_probe_workflow
  stage_wait_agent_workflow
  stage_verify_agent_run_chain
  log "E2E long-running agent execution verified: immediate handle (<${HANDLE_MAX_S}s) + no held connection, contention probe completed during the wait, execution completed after >= ${DELAY_S}s with a full payload, zero JetStream redeliveries with ack-pending drained, before/during/after resource evidence captured, AND the workflow agentCall path completed after >= ${WORKFLOW_DELAY_S}s with no Temporal failure, exactly one agent execution_completed on its chain, and its own contention probe green (direct execution ${EXECUTION_ID}, workflow run ${AGENT_RUN_EXECUTION_ID}, chain ${AGENT_RUN_CORRELATION_ID})"
}

main "$@"
