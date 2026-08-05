#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# reset-and-verify.sh — cold-start verification of the e2e suite
# =============================================================================
#
# Wipes the tenant, restarts the services whose code the e2e depends on, then
# runs scripts/e2e/http-workflow.sh TWICE: once against an empty tenant (proves
# the suite provisions its own fixtures) and once against the result (proves
# the apply is idempotent, all-noop). Finally greps the worker log for proof
# that the core-NATS fallback path actually executed.
#
# Usage:
#   ./scripts/e2e/reset-and-verify.sh              # full cycle
#   ./scripts/e2e/reset-and-verify.sh --skip-reset    # keep tenant state
#   ./scripts/e2e/reset-and-verify.sh --skip-restart  # pods already current
#
# Flags:
#   --tenant=NAME    tenant to reset and run against (default: acme)
#   --skip-reset     do not wipe — use when only re-running the suite
#   --skip-restart   do not restart pods — use when nothing was redeployed
#   -h, --help
#
# Assumes the dev cluster is in DEV-MODE (./dev-mode.sh): services run
# `bun --watch` off the hostPath-mounted repo, so "redeploy" is a pod restart,
# not an image rebuild. For a service NOT in dev-mode use rebuild-redeploy.sh.
#
# ── Two ordering constraints this script exists to enforce ───────────────────
#
# 1. THE DB CONSTRAINT. `channel_accounts` carries a CHECK enumerating the
#    allowed channels. Adding a channel to it only reaches an existing tenant
#    when channel-service re-runs `ensureSchema` on a fresh connection pool —
#    i.e. after a restart. Skip that and the run dies three minutes in with a
#    PostgresError that reads like a code bug. Phase 3 verifies it explicitly
#    rather than trusting the restart.
#
# 2. VALIDATION ORDER. provisioning-service rejects an unknown channel `type`
#    (SUPPORTED_CHANNEL_TYPES) BEFORE channel-service ever sees the request, so
#    both must be restarted before the suite runs, not after it fails.
#
# ── What it delegates, and the one thing it does NOT ─────────────────────────
#
# The wipe is `scripts/reset/reset-tenant.sh --apply`, which already truncates
# workflow_definitions, agents, channel_accounts, http_adapters,
# adapter_endpoints and manifest_revisions — everything the suite creates
# EXCEPT the hosted service. `registered_services` is deliberately absent from
# that script's table list: truncating the row would strand the Knative Service
# in the tenant namespace, because only registry-service's DELETE route removes
# both. So the hosted service is deleted here, through the API.
#
# ── If it fails ──────────────────────────────────────────────────────────────
#
#   curl exit 7 / HTTP 000 at stage 1
#       the port-forward died with the api-gateway pod (it targets the pod by
#       name). Phase 2 waits for you to bring it back.
#   "unsupported type 'e2e-tests'"
#       provisioning-service was not restarted.
#   "violates check constraint channel_accounts_channel_check"
#       phase 3's gate was skipped, or channel-service has not re-run
#       ensureSchema for this tenant yet.
#   serviceCall FAILED with CIRCUIT_OPEN
#       sample-echo was cold. The suite's own ksvc-Ready gate should prevent
#       this — check a pod exists in <tenant>-dev-ns.
#   stage 1b 404 on the adapter
#       a stale E2E_ENDPOINT_ADAPTER_ID is pinned in scripts/e2e/.env. Unset it
#       and let the suite resolve the connector by name.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TENANT="acme"
SKIP_RESET=0
SKIP_RESTART=0

NAMESPACE="platform-services-dev"
SUPPORT_NS="support-services-dev"
PG_POD="postgres-shared-1"
API_URL="${E2E_API_URL:-http://localhost:8080}"
HOST_HEADER="api-gateway.platform-services-dev.dev.local"
EMAIL="yclawd@demo.io"
PASSWORD="admin123"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
step() { echo -e "\n${CYAN}── $* ──${NC}"; }

usage() { sed -n '5,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant=*)    TENANT="${1#*=}" ;;
    --tenant)      shift; TENANT="$1" ;;
    --skip-reset)  SKIP_RESET=1 ;;
    --skip-restart) SKIP_RESTART=1 ;;
    -h|--help)     usage; exit 0 ;;
    *) err "unknown flag: $1"; usage; exit 1 ;;
  esac
  shift
done

command -v jq >/dev/null || { err "jq is required"; exit 1; }
command -v kubectl >/dev/null || { err "kubectl is required"; exit 1; }

TOKEN=""

api() {
  # api <method> <path> [body]
  #
  # `Content-Type: application/json` is set ONLY when there is a body. The
  # gateway rejects a bodyless request that declares a JSON content type with
  # 400 "Body cannot be empty" — verified: the same DELETE returns 404 without
  # the header and 400 with it. http-workflow.sh documents the same gotcha for
  # its own DELETEs; this helper avoids it by construction.
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}" -H "x-yoizen-tenant: ${TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}"
}

api_code() {
  # api_code <method> <path> — emits only the HTTP status.
  local method="$1" path="$2"
  local args=(-s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 45
    -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}" -H "x-yoizen-tenant: ${TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  curl "${args[@]}"
}

login() {
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}")" || true
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]]
}

# ── Phase 1 — wipe ───────────────────────────────────────────────────────────

if [[ "$SKIP_RESET" == "1" ]]; then
  warn "Phase 1 skipped (--skip-reset): tenant state left as-is"
else
  step "Phase 1/5 — wipe tenant '${TENANT}'"

  log "Delegating resource-definition tables to reset-tenant.sh"
  "${REPO_ROOT}/scripts/reset/reset-tenant.sh" --tenant "$TENANT" --apply --yes

  # The one thing reset-tenant.sh deliberately does not cover — see header.
  log "Deleting the hosted service through the API (so its ksvc goes too)"
  if ! login; then
    err "Could not log in — cannot delete the hosted service, so the next run"
    err "would NOT be cold. Aborting rather than reporting a false cold start."
    exit 1
  fi

  sid="$(api GET "/api/registry/services?name=sample-echo" | jq -r '.[0].id // empty')" || true
  if [[ -z "${sid:-}" ]]; then
    log "No hosted service to delete"
  else
    # Check the status. An earlier version discarded it and logged success
    # unconditionally, so a 400 from the Content-Type gotcha above went
    # unnoticed for two runs — the service survived and the "cold" run was
    # quietly warm.
    code="$(api_code DELETE "/api/registry/services/${sid}")"
    if [[ "$code" != "204" && "$code" != "200" && "$code" != "404" ]]; then
      err "DELETE /api/registry/services/${sid} returned ${code}, expected 204."
      err "The hosted service survives, so the next run would not be cold."
      exit 1
    fi
    # Trust the read, not the status: confirm it is actually gone.
    still="$(api GET "/api/registry/services?name=sample-echo" | jq -r '.[0].id // empty')" || true
    if [[ -n "${still:-}" ]]; then
      err "Hosted service ${still} still present after DELETE returned ${code}."
      exit 1
    fi
    log "Deleted hosted service ${sid} (HTTP ${code}, absence verified)"
  fi
fi

# ── Phase 2 — restart ────────────────────────────────────────────────────────

if [[ "$SKIP_RESTART" == "1" ]]; then
  warn "Phase 2 skipped (--skip-restart): pods left as-is"
else
  step "Phase 2/5 — restart the services the e2e depends on"

  # Every one of these imports @yoizen/shared, so they all restart regardless
  # of whether their own source changed.
  for svc in channel-service-api provisioning-service workflow-service-api api-gateway; do
    log "Deleting pod for ksvc/${svc}"
    kubectl delete pod -n "$NAMESPACE" -l "serving.knative.dev/service=${svc}" >/dev/null 2>&1 || true
  done

  for dep in channel-service-worker workflow-service-worker workflow-worker; do
    log "Rolling deploy/${dep}"
    kubectl rollout restart "deploy/${dep}" -n "$NAMESPACE" >/dev/null 2>&1 || true
  done
  for dep in channel-service-worker workflow-service-worker workflow-worker; do
    kubectl rollout status "deploy/${dep}" -n "$NAMESPACE" --timeout=180s >/dev/null 2>&1 \
      || warn "deploy/${dep} did not report ready in time — continuing"
  done

  # Deleting the api-gateway pod kills a port-forward that targets it by name.
  # Nothing this script can do about that, so wait for it to come back rather
  # than failing the whole run three phases later.
  echo
  warn "The api-gateway pod was replaced — restart ./port-forward.sh if it died."
  log "Waiting for ${API_URL} to answer (Ctrl-C to abort)"
  until curl -s -o /dev/null --connect-timeout 3 "${API_URL}/api/auth/login" \
      -X POST -H "Host: ${HOST_HEADER}" -H "Content-Type: application/json" -d '{}' 2>/dev/null; do
    sleep 3
  done
  log "Gateway is reachable"
fi

# ── Phase 3 — the schema gate ────────────────────────────────────────────────

step "Phase 3/5 — verify the channel CHECK constraint reached this tenant"

CONSTRAINT=""
DEADLINE=$(( $(date +%s) + 120 ))
while (( $(date +%s) < DEADLINE )); do
  CONSTRAINT="$(kubectl exec -n "$SUPPORT_NS" "$PG_POD" -- \
    psql -U postgres -d "tenant_${TENANT}" -Atc \
    "select pg_get_constraintdef(oid) from pg_constraint where conname = 'channel_accounts_channel_check';" \
    2>/dev/null)" || true
  [[ "$CONSTRAINT" == *"e2e-tests"* ]] && break
  sleep 3
done

if [[ "$CONSTRAINT" != *"e2e-tests"* ]]; then
  err "The channel_accounts CHECK does not include 'e2e-tests' for tenant '${TENANT}'."
  err "Got: ${CONSTRAINT:-<none>}"
  err "channel-service has not re-run ensureSchema for this tenant. Restart"
  err "channel-service-api and re-run — the suite would fail on the sink account."
  exit 1
fi
log "Constraint includes e2e-tests"

# ── Phase 4 — the suite, cold then warm ──────────────────────────────────────

step "Phase 4/5 — run the suite twice (cold, then warm)"

log "Run 1 of 2 — COLD (expects appliedCount=2: both fixtures created)"
COLD_LOG="$(mktemp)"
if ! E2E_API_URL="$API_URL" "${SCRIPT_DIR}/http-workflow.sh" > "$COLD_LOG" 2>&1; then
  err "Cold run FAILED — full output at ${COLD_LOG}"
  tail -30 "$COLD_LOG"
  exit 1
fi
grep -E "Prerequisites manifest applied" "$COLD_LOG" || true

# Assert it, do not merely announce it. Without this the phase passed while
# reporting appliedCount=1 — the wipe had silently left the hosted service
# behind, so the run that was supposed to prove cold-start provisioning never
# exercised it.
if ! grep -q "appliedCount=2" "$COLD_LOG"; then
  err "The cold run did not report appliedCount=2 — the tenant was NOT empty,"
  err "so this run did not prove cold-start provisioning. Check phase 1."
  err "Full output at ${COLD_LOG}"
  exit 1
fi
log "Cold run passed and both fixtures were created from nothing"

log "Run 2 of 2 — WARM (expects noopCount=2: fixtures reconciled, not duplicated)"
WARM_LOG="$(mktemp)"
if ! E2E_API_URL="$API_URL" "${SCRIPT_DIR}/http-workflow.sh" > "$WARM_LOG" 2>&1; then
  err "Warm run FAILED — full output at ${WARM_LOG}"
  tail -30 "$WARM_LOG"
  exit 1
fi
grep -E "Prerequisites manifest applied" "$WARM_LOG" || true

if ! grep -q "noopCount=2" "$WARM_LOG"; then
  err "The second run did not report noopCount=2 — the apply is not idempotent."
  err "Full output at ${WARM_LOG}"
  exit 1
fi
log "Warm run passed and was idempotent"

# ── Phase 5 — prove the fallback path ran ────────────────────────────────────

step "Phase 5/5 — prove the core-NATS fallback actually executed"

# `serviceBusCall` reporting ok is necessary but not sufficient: it would also
# read ok if the publish had gone to a STREAMED subject. Only this log line
# distinguishes the fallback path, which is the whole point of the fix it
# guards (service-bus.activity.ts probes $JS.API.STREAM.NAMES to tell "no
# stream bound" apart from "JetStream is down").
FALLBACK="$(kubectl logs -n "$NAMESPACE" deploy/workflow-worker --tail=4000 2>/dev/null \
  | grep -c "falling back to core NATS" || true)"

if [[ "${FALLBACK:-0}" -lt 1 ]]; then
  err "No 'falling back to core NATS' line in the worker log."
  err "serviceBusCall may have reported ok without exercising the fallback."
  exit 1
fi
log "Fallback path executed (${FALLBACK} occurrence(s))"

echo
log "${GREEN}All five phases passed.${NC}"
log "Cold run log: ${COLD_LOG}"
log "Warm run log: ${WARM_LOG}"
