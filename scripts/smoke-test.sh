#!/usr/bin/env bash
set -euo pipefail

PROFILE="yoizen-arch"
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
  proxy-service
  connector-admin
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

run_tests() {
  log "Running E2E tests..."
  cd "${ROOT_DIR}/tests/e2e"

  if [[ ! -d node_modules ]]; then
    log "Installing test dependencies..."
    pnpm install
  fi

  # Stable hostname — bootstrap writes /etc/hosts entries so
  # api-gateway.platform-services-dev.dev.local resolves to 127.0.0.1.
  # Kourier's LoadBalancer Service is on port 80 (OrbStack native; or via
  # `sudo minikube tunnel` on minikube). No port-forward is needed.
  local dev_domain="${DEV_DOMAIN:-dev.local}"

  export API_GATEWAY_URL="http://api-gateway.${NAMESPACE}.${dev_domain}"
  export CACHE_SERVICE_URL="http://cache-service.${NAMESPACE}.${dev_domain}"

  export ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
  export E2E_CLIENT_ID="${E2E_CLIENT_ID:-}"
  export E2E_CLIENT_SECRET="${E2E_CLIENT_SECRET:-}"
  export E2E_TENANT="${E2E_TENANT:-e2e-test}"

  log "Service URLs:"
  echo "  api-gateway  -> $API_GATEWAY_URL"
  echo "  cache-service -> $CACHE_SERVICE_URL"
  echo ""

  local test_filter="${1:-}"
  if [[ -n "$test_filter" ]]; then
    bun test "$test_filter"
  else
    bun test
  fi
}

main() {
  log "Smoke Test Runner"
  echo ""

  kubectl config use-context "$PROFILE" 2>/dev/null || true

  preflight_check
  run_tests "${1:-}"
  local exit_code=$?

  if (( exit_code == 0 )); then
    log "All E2E tests passed!"
  else
    err "Some E2E tests failed (exit code: $exit_code)"
  fi

  return "$exit_code"
}

main "$@"
