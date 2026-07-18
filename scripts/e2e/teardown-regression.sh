#!/usr/bin/env bash
set -euo pipefail

# teardown-regression.sh — regression test for the mid-run driver-death
# teardown leak (live incident, confirmed 2026-07-18): manifest-apply.sh's
# EXIT-trap cleanup() used to resolve every T09/T1 showcase resource
# EXCLUSIVELY from manifest-showcase-driver.ts's final stdout JSON summary.
# When the driver dies before printing that line (crash, connection
# failure, ctrl-c), cleanup() had nothing to resolve names/ids from and
# skipped every showcase resource — leaking channels/connectors/agents/
# workflows/knowledge bases/mcpServers/skills/systemVariables (DB rows) and
# their bound k8s Secrets (`psec-*`) on every crashed run.
#
# The fix: manifest-apply.sh's cleanup() now ALSO runs an independent
# name-prefix sweep (matching THIS run's nonce suffix) across every admin
# API it already talks to, regardless of whether the driver ever produced
# JSON. This script proves that sweep actually closes the hole:
#
#   1. Runs manifest-apply.sh with E2E_SIMULATE_DRIVER_DEATH=1 — this makes
#      manifest-showcase-driver.ts process.exit(1) right after its FIRST
#      successful apply (7+ resources + 4 k8s Secrets already created),
#      BEFORE it ever assembles or prints its JSON summary. manifest-apply.sh
#      is therefore EXPECTED TO FAIL (exit != 0) — that failure is normal for
#      this test and asserted below, not a bug.
#   2. Captures the run's nonce via E2E_NONCE_OUT_FILE (manifest-apply.sh
#      writes it to that file immediately after generating it, before
#      anything else can fail — see manifest-apply.sh's NONCE section).
#   3. After manifest-apply.sh's own EXIT-trap cleanup has already run (it's
#      a synchronous foreground process — by the time step 1's command
#      returns, cleanup() already executed), independently re-queries every
#      admin API + kubectl for residue matching this run's nonce.
#   4. Exits 0 iff ZERO residue is found (the leak is fixed); exits 1 and
#      lists every leaked resource otherwise.
#
# Intentionally NOT part of run-all.sh's default sequence (see
# scripts/e2e/README.md): it deliberately provisions real resources and then
# deliberately kills the driver mid-run, which is a slower and more invasive
# check than every other stage. Run explicitly:
#
#   ./scripts/e2e/run-all.sh --only teardown-regression
#   ./scripts/e2e/teardown-regression.sh
#
# Exit code 0 = the leak is fixed (zero residue after a simulated crash);
# 1 = residue found (the fix regressed) or the death simulation itself
# failed to trigger (manifest-apply.sh unexpectedly PASSED).

E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
TENANT="${E2E_TENANT:-acme}"
TENANT_NAMESPACE="${E2E_TENANT_NAMESPACE:-${TENANT}-dev-ns}"

CHANNEL_URL="${E2E_CHANNEL_URL:-http://channel-service-api.platform-services-dev.dev.local}"
CHANNEL_HOST="${E2E_CHANNEL_HOST:-channel-service-api.platform-services-dev.dev.local}"
WORKFLOW_URL="${E2E_WORKFLOW_URL:-http://workflow-service-api.platform-services-dev.dev.local}"
WORKFLOW_HOST="${E2E_WORKFLOW_HOST:-workflow-service-api.platform-services-dev.dev.local}"
AGENT_ADMIN_URL="${E2E_AGENT_ADMIN_URL:-http://agent-admin-service.platform-services-dev.dev.local}"
AGENT_ADMIN_HOST="${E2E_AGENT_ADMIN_HOST:-agent-admin-service.platform-services-dev.dev.local}"
CONNECTOR_ADMIN_URL="${E2E_CONNECTOR_ADMIN_URL:-http://connector-admin-api.platform-services-dev.dev.local}"
CONNECTOR_ADMIN_HOST="${E2E_CONNECTOR_ADMIN_HOST:-connector-admin-api.platform-services-dev.dev.local}"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl not found in PATH"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq not found in PATH"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { err "kubectl not found in PATH"; exit 1; }

E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"

url_port() {
  local url="$1" scheme host_port
  scheme="${url%%://*}"
  host_port="${url#*://}"
  host_port="${host_port%%/*}"
  if [[ "$host_port" == *:* ]]; then
    echo "${host_port##*:}"
  elif [[ "$scheme" == "https" ]]; then
    echo 443
  else
    echo 80
  fi
}

CHANNEL_PORT="$(url_port "$CHANNEL_URL")"
WORKFLOW_PORT="$(url_port "$WORKFLOW_URL")"
AGENT_ADMIN_PORT="$(url_port "$AGENT_ADMIN_URL")"
CONNECTOR_ADMIN_PORT="$(url_port "$CONNECTOR_ADMIN_URL")"

CHANNEL_RESOLVE=()
WORKFLOW_RESOLVE=()
AGENT_ADMIN_RESOLVE=()
CONNECTOR_ADMIN_RESOLVE=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  CHANNEL_RESOLVE=(--resolve "${CHANNEL_HOST}:${CHANNEL_PORT}:${E2E_RESOLVE_IP}")
  WORKFLOW_RESOLVE=(--resolve "${WORKFLOW_HOST}:${WORKFLOW_PORT}:${E2E_RESOLVE_IP}")
  AGENT_ADMIN_RESOLVE=(--resolve "${AGENT_ADMIN_HOST}:${AGENT_ADMIN_PORT}:${E2E_RESOLVE_IP}")
  CONNECTOR_ADMIN_RESOLVE=(--resolve "${CONNECTOR_ADMIN_HOST}:${CONNECTOR_ADMIN_PORT}:${E2E_RESOLVE_IP}")
fi

channel_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${CHANNEL_RESOLVE[@]}" -X "$method" \
    -H "Host: ${CHANNEL_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${CHANNEL_URL}${path}"
}
workflow_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${WORKFLOW_RESOLVE[@]}" -X "$method" \
    -H "Host: ${WORKFLOW_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${WORKFLOW_URL}${path}"
}
agent_admin_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${AGENT_ADMIN_RESOLVE[@]}" -X "$method" \
    -H "Host: ${AGENT_ADMIN_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${AGENT_ADMIN_URL}${path}"
}
connector_admin_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${CONNECTOR_ADMIN_RESOLVE[@]}" -X "$method" \
    -H "Host: ${CONNECTOR_ADMIN_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${CONNECTOR_ADMIN_URL}${path}"
}

NONCE_FILE="$(mktemp -t teardown-regression-nonce.XXXXXX)"
cleanup_nonce_file() { rm -f "$NONCE_FILE"; }
trap cleanup_nonce_file EXIT

# --- 1. run manifest-apply.sh with the death simulation, expect FAILURE ----

log "Running manifest-apply.sh with E2E_SIMULATE_DRIVER_DEATH=1 (expect FAILURE — this is intentional)"
MANIFEST_APPLY_STATUS=0
E2E_SIMULATE_DRIVER_DEATH=1 E2E_NONCE_OUT_FILE="$NONCE_FILE" \
  "${E2E_SCRIPT_DIR}/manifest-apply.sh" \
  || MANIFEST_APPLY_STATUS=$?

if [[ ! -s "$NONCE_FILE" ]]; then
  err "manifest-apply.sh never wrote its NONCE to ${NONCE_FILE} — cannot check residue. Did the script fail before generating a nonce, or was E2E_NONCE_OUT_FILE support removed?"
  exit 1
fi
NONCE="$(cat "$NONCE_FILE")"
log "Captured this run's nonce: ${NONCE}"

if [[ "$MANIFEST_APPLY_STATUS" -eq 0 ]]; then
  err "manifest-apply.sh PASSED despite E2E_SIMULATE_DRIVER_DEATH=1 — the death simulation did not trigger (check manifest-showcase-driver.ts's E2E_DIE_AFTER_APPLY hook). This test cannot validate the teardown fix without a real mid-run failure."
  exit 1
fi
log "manifest-apply.sh failed as expected (exit=${MANIFEST_APPLY_STATUS}) — now asserting ZERO residue for nonce=${NONCE}"

# --- 2. independently re-query every admin API + kubectl for residue -------

RESIDUE_FOUND=0

# NOT every admin list endpoint returns a bare JSON array — verified live:
#   /channels/accounts, /connectors, /admin/mcp-servers, /workflows -> `[...]`
#   /admin/agents           -> `{ agents: [...], total }`
#   /admin/skills           -> `{ skills: [...], total }`
#   /admin/system-variables -> `{ variables: [...], total }`
#   /admin/knowledge-bases  -> `{ knowledge_bases: [...] }`
# Using a blanket `.[]?` against the wrapped shapes iterates the object's
# VALUES (the array itself, `total`, ...), `.name` on a bare number throws,
# jq aborts, and this residue check would silently report those four kinds
# "clean" even when they leaked — exactly the false negative caught live
# while validating manifest-apply.sh's sweep (agent/skill/systemVariable/
# knowledgeBase leaked in a real run yet showed clean until this was fixed).
check_residue() {
  local kind_label="$1" curl_fn="$2" list_path="$3" items_expr="$4"
  local list_json matches filter
  list_json="$("${curl_fn}" GET "$list_path" 2>/dev/null || true)"
  if [[ -z "$list_json" ]]; then
    warn "residue check: could not list ${kind_label} (service unreachable?) — skipping (not a pass, not a fail)"
    return 0
  fi
  filter="[${items_expr}] | .[] | select(.name != null and (.name | endswith(\$n))) | .name"
  matches="$(echo "$list_json" | jq -r --arg n "$NONCE" "$filter" 2>/dev/null || true)"
  if [[ -n "$matches" ]]; then
    RESIDUE_FOUND=1
    err "residue found: ${kind_label} still present for nonce=${NONCE}:"
    while IFS= read -r m; do err "    - ${m}"; done <<< "$matches"
  else
    log "residue check: ${kind_label} clean (no name ending in ${NONCE})"
  fi
}

check_residue "channel accounts"      channel_curl         "/channels/accounts"       ".[]?"
check_residue "connectors"            connector_admin_curl "/connectors"              ".[]?"
check_residue "mcpServers"            agent_admin_curl     "/admin/mcp-servers"       ".[]?"
check_residue "skills"                agent_admin_curl     "/admin/skills"            ".skills[]?"
check_residue "systemVariables"       agent_admin_curl     "/admin/system-variables"  ".variables[]?"
check_residue "agents"                agent_admin_curl     "/admin/agents"            ".agents[]?"
check_residue "knowledge bases"       agent_admin_curl     "/admin/knowledge-bases"   ".knowledge_bases[]?"
check_residue "workflow definitions"  workflow_curl        "/workflows"               ".[]?"

SECRET_MATCHES="$(kubectl get secrets -n "$TENANT_NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null \
  | tr ' ' '\n' | grep -- "-${NONCE}\$" || true)"
if [[ -n "$SECRET_MATCHES" ]]; then
  RESIDUE_FOUND=1
  err "residue found: k8s Secret(s) still present in ${TENANT_NAMESPACE} for nonce=${NONCE}:"
  while IFS= read -r s; do err "    - ${s}"; done <<< "$SECRET_MATCHES"
else
  log "residue check: k8s Secrets in ${TENANT_NAMESPACE} clean (no name ending in -${NONCE})"
fi

if [[ "$RESIDUE_FOUND" -eq 1 ]]; then
  err "teardown-regression: FAILED — residue leaked past a simulated mid-run driver death (the fix regressed or was incomplete)"
  exit 1
fi

log "teardown-regression: PASSED — zero e2e-* residue for nonce=${NONCE} after a simulated mid-run driver death"
