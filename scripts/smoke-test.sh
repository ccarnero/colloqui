#!/usr/bin/env bash
#
# smoke-test.sh — READINESS PREFLIGHT for the platform namespace.
#
# Despite the name it sends no traffic and asserts no behavior: it only reads
# the cluster and exits non-zero if any workload it knows about is not up.
# Two checks, both in preflight_check():
#   - every ksvc in ALL_KNATIVE_SERVICES has Ready=True
#   - every Deployment in ALL_PLAIN_DEPLOYMENTS has availableReplicas >= 1
# Nothing else runs; main() calls preflight_check() and stops.
#
# Used as the readiness gate of scripts/{orbstack,minikube}/startup.sh, which
# POLL it in an `until` loop until it passes or their timeout expires.
#
# Env:
#   SMOKE_TEST_NAMESPACE  namespace to check (default platform-services-dev)
#
# Exit codes: 0 = every listed workload is ready; 1 = at least one is not.
#
set -euo pipefail

NAMESPACE="${SMOKE_TEST_NAMESPACE:-platform-services-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

ALL_KNATIVE_SERVICES=(
  api-gateway
  auth-service
  cache-service
  tenant-service
  registry-service
  agent-admin-service
  agent-ai-service
  agent-memory-service
  agent-scheduler-service
  ai-agent-gateway
  provisioning-service
  admin-console
  proxy-service
  connector-admin-api
  channel-service-api
  audit-service-api
  usage-aggregator-api
  workflow-service-api
)

# Plain `apps/v1.Deployment` worker workloads (fixed replica count; no KEDA
# in developer mode). Every worker Deployment under knative/services/base
# declares `replicas: 1`, so available < 1 always indicates a crash or bad
# config — treat it as preflight failure.
#
# INCOMPLETE vs the manifests: knative/services/base declares 11 worker
# Deployments; the list below covers 8. connector-runtime-http,
# connector-runtime-invoke and tracking-ingester-worker are NOT checked, so
# this gate can pass while they are down. Fixing that is a behavior change,
# tracked as E27 in DOCS/archive/audits/DOCS-TRUTH-LEDGER.md.
ALL_PLAIN_DEPLOYMENTS=(
  workflow-worker
  connector-runtime
  agent-admin-service-worker
  connector-admin-worker
  audit-service-worker
  channel-service-worker
  usage-aggregator-worker
  workflow-service-worker
)

preflight_check() {
  local ok=true
  for svc in "${ALL_KNATIVE_SERVICES[@]}"; do
    local ready
    ready=$(kubectl get ksvc "$svc" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    if [[ "$ready" != "True" ]]; then
      local reason
      reason=$(kubectl get ksvc "$svc" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].reason}' 2>/dev/null || echo "Unknown")
      warn "ksvc/$svc is not Ready (reason: $reason)"
      ok=false
    fi
  done
  for dep in "${ALL_PLAIN_DEPLOYMENTS[@]}"; do
    local desired available
    desired=$(kubectl get deploy "$dep" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "")
    if [[ -z "$desired" ]]; then
      warn "deploy/$dep is missing"
      ok=false
      continue
    fi
    available=$(kubectl get deploy "$dep" -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo "0")
    if [[ "${available:-0}" -lt 1 ]]; then
      warn "deploy/$dep has desired=$desired but available=${available:-0}"
      ok=false
    fi
  done
  if [[ "$ok" == "false" ]]; then
    err "Some workloads are not ready. Check:"
    err "  kubectl get ksvc -n $NAMESPACE"
    err "  kubectl get deploy -n $NAMESPACE"
    err "  kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10"
    exit 1
  fi
  log "All Knative services + plain Deployments are Ready"
}

main() {
  log "Smoke Test Runner"
  echo ""

  preflight_check
}

main "$@"
