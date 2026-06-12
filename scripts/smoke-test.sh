#!/usr/bin/env bash
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
  admin-console
  proxy-service
  connector-admin-api
  channel-service-api
  audit-service-api
  usage-aggregator-api
  workflow-service-api
)

# Plain `apps/v1.Deployment` worker workloads (fixed replica count; no KEDA
# in developer mode). All run at min-scale=max-scale=1, so available < 1
# always indicates a crash or bad config — treat it as preflight failure.
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
