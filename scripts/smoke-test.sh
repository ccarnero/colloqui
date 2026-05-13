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
  cache-service
  tenant-service
  registry-service
  yoizenclaw-admin-service
  proxy-service
  connector-admin
  channel-service-api
  audit-service-api
  usage-aggregator-api
  workflow-service-api
)

# Plain `apps/v1.Deployment` workloads driven by KEDA. Two flavors:
#   • Temporal-driven workers (`workflow-worker`, `connector-runtime`) — replicas
#     follow `workflow-orchestrator` / `connector-runtime` task-queue depth.
#   • Phase 1.5 NATS workers (`*-worker`) — replicas follow JetStream
#     consumer lag (jetstream_consumer_num_pending +
#     jetstream_consumer_num_ack_pending). See
#     `knative/services/base/scaledobjects/*.yaml`.
# All of these can sit at 0 replicas in non-prod; the preflight only
# fails when `spec.replicas > 0` AND `availableReplicas < 1`.
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
    # KEDA scales these to 0 when the Temporal queue is drained, so we
    # accept "Available=False with desired=0" as healthy. We only fail
    # the preflight when the Deployment doesn't exist at all or has
    # `spec.replicas > 0` AND `status.availableReplicas == 0`.
    local desired available
    desired=$(kubectl get deploy "$dep" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "")
    if [[ -z "$desired" ]]; then
      warn "deploy/$dep is missing"
      ok=false
      continue
    fi
    available=$(kubectl get deploy "$dep" -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}' 2>/dev/null || echo "0")
    if [[ "$desired" -gt 0 && "${available:-0}" -lt 1 ]]; then
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
  # Phase 1.5: e2e suites talk to the `*-api` Knative Services for direct
  # health/CRUD probes. The `*-worker` Deployments are NOT exposed via
  # Kourier — they consume NATS subjects only.
  export CACHE_SERVICE_URL="http://cache-service.${NAMESPACE}.${domain}:${KOURIER_PORT}"
  export KOURIER_HOST="localhost"
  export KOURIER_PORT="${KOURIER_PORT}"

  export ADMIN_EMAIL="${ADMIN_EMAIL:-}"
  export ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
  export E2E_TENANT="${E2E_TENANT:-e2e-test}"

  log "Service URLs (routed through Kourier):"
  echo "  api-gateway         -> $API_GATEWAY_URL  (all service tests route through this)"
  echo "  cache-service       -> $CACHE_SERVICE_URL  (direct CRUD + health)"
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
