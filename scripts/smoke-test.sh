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

KOURIER_PID=""

cleanup() {
  log "Cleaning up..."
  if [[ -n "$KOURIER_PID" ]]; then
    kill "$KOURIER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_port() {
  local port=$1 max_attempts=${2:-30}
  local attempt=0
  while ! nc -z localhost "$port" 2>/dev/null; do
    if (( attempt >= max_attempts )); then
      err "Port $port never became available"
      return 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

ALL_KNATIVE_SERVICES=(
  api-gateway
  auth-service
  event-processor
  cache-service
  audit-service
  webhook-service
  metrics-service
  tenant-service
  scheduler-service
  registry-service
  yoizenclaw-admin-service
  workflow-api
  workflow-worker
  workflow-http-worker
  proxy-service
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
  if [[ "$ok" == "false" ]]; then
    err "Some Knative services are not ready. Check:"
    err "  kubectl get ksvc -n $NAMESPACE"
    err "  kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10"
    exit 1
  fi
  log "All Knative services are Ready"
}

start_kourier_port_forward() {
  local local_port=$1

  log "Port-forwarding Kourier gateway -> localhost:$local_port"
  kubectl port-forward svc/kourier -n kourier-system "${local_port}:80" &
  KOURIER_PID=$!
  wait_for_port "$local_port"
  log "Kourier gateway available on localhost:$local_port"
}

run_tests() {
  log "Running E2E tests..."
  cd "${ROOT_DIR}/tests/e2e"

  if [[ ! -d node_modules ]]; then
    log "Installing test dependencies..."
    bun install
  fi

  local minikube_ip
  minikube_ip="$(minikube ip -p "$PROFILE")"
  local domain="${minikube_ip}.sslip.io"

  export API_GATEWAY_URL="http://api-gateway.${NAMESPACE}.${domain}:${KOURIER_PORT}"
  export EVENT_PROCESSOR_URL="http://event-processor.${NAMESPACE}.${domain}:${KOURIER_PORT}"
  export CACHE_SERVICE_URL="http://cache-service.${NAMESPACE}.${domain}:${KOURIER_PORT}"
  export METRICS_SERVICE_URL="http://metrics-service.${NAMESPACE}.${domain}:${KOURIER_PORT}"
  export KOURIER_HOST="localhost"
  export KOURIER_PORT="${KOURIER_PORT}"

  export ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
  export E2E_TENANT="${E2E_TENANT:-e2e-test}"

  log "Service URLs (routed through Kourier):"
  echo "  api-gateway     -> $API_GATEWAY_URL  (all service tests route through this)"
  echo "  event-processor -> $EVENT_PROCESSOR_URL  (direct health check)"
  echo "  cache-service   -> $CACHE_SERVICE_URL  (direct CRUD + health)"
  echo "  metrics-service -> $METRICS_SERVICE_URL  (direct — not proxied by gateway)"
  echo ""

  local test_filter="${1:-}"
  if [[ -n "$test_filter" ]]; then
    bun test "$test_filter"
  else
    bun test
  fi
}

KOURIER_PORT=8080

main() {
  log "Smoke Test Runner"
  echo ""

  kubectl config use-context "$PROFILE" 2>/dev/null || true

  preflight_check
  start_kourier_port_forward "$KOURIER_PORT"

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
