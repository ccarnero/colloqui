#!/usr/bin/env bash
set -euo pipefail

MINIKUBE_PROFILE="yoizen-arch"
ENVIRONMENT="${1:-dev}"
NAMESPACE="platform-services-${ENVIRONMENT}"
SUPPORT_NAMESPACE="support-services-${ENVIRONMENT}"

SERVICES=(api-gateway admin-console messaging-console)
declare -A CONTAINER_PORTS=(
  [api-gateway]=3000
  [admin-console]=8080
  [messaging-console]=8080
)
declare -A LOCAL_PORTS=(
  [api-gateway]="${API_GATEWAY_PORT:-8080}"
  [admin-console]="${ADMIN_CONSOLE_PORT:-4200}"
  [messaging-console]="${MESSAGING_CONSOLE_PORT:-4300}"
)

# Native k8s Services in the support-services namespace we want exposed
# locally so the e2e test suite can reach them. Unlike the Knative-based
# services above, these are plain ClusterIP Services, so we forward
# `svc/<name>` directly (no ksvc Ready-wait, no pod lookup).
#
# Only consumers that actually need NATS locally (e.g. dedup.e2e.spec.ts,
# which connects to `nats://localhost:4222`) should rely on this; the
# in-cluster services keep using the in-namespace DNS name as before.
SUPPORT_SERVICES=(nats)
declare -A SUPPORT_CONTAINER_PORTS=(
  [nats]=4222
)
declare -A SUPPORT_LOCAL_PORTS=(
  [nats]="${NATS_PORT:-4222}"
)

FORWARD_PIDS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

cleanup() {
  echo ""
  log "Stopping port-forwards..."
  for pid in "${FORWARD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  log "All port-forwards stopped."
}
trap cleanup EXIT INT TERM

usage() {
  printf '%s\n' \
    "Usage: $0 [ENV]" \
    "" \
    "  ENV   Environment name (default: dev)" \
    "" \
    "Environment variables:" \
    "  API_GATEWAY_PORT          Local port for api-gateway       (default: 8080)" \
    "  ADMIN_CONSOLE_PORT        Local port for admin-console     (default: 4200)" \
    "  MESSAGING_CONSOLE_PORT    Local port for messaging-console (default: 4300)" \
    "  NATS_PORT                 Local port for NATS client       (default: 4222)" \
    "" \
    "Examples:" \
    "  $0              # Forward services in platform-services-dev + NATS" \
    "  $0 qa           # Forward services in platform-services-qa + NATS"
  exit 0
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

detect_context() {
  if kubectl config current-context 2>/dev/null | grep -q "^orbstack$"; then
    log "Detected OrbStack cluster context"
    return
  fi

  if minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    log "Detected Minikube profile '${MINIKUBE_PROFILE}'"
    kubectl config use-context "$MINIKUBE_PROFILE" &>/dev/null
    return
  fi

  err "No reachable cluster found (tried OrbStack context and Minikube profile '${MINIKUBE_PROFILE}')."
  err "Run bootstrap.sh or bootstrap-orbstack.sh first."
  exit 1
}

wait_for_ksvc() {
  local svc=$1 timeout_s=120
  log "Waiting for ksvc/${svc} to be Ready (timeout ${timeout_s}s)..."

  local elapsed=0
  while (( elapsed < timeout_s )); do
    local ready
    ready=$(kubectl get ksvc "$svc" -n "$NAMESPACE" \
      -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    if [[ "$ready" == "True" ]]; then
      return 0
    fi
    sleep 2
    (( elapsed += 2 ))
  done

  err "ksvc/${svc} did not become Ready within ${timeout_s}s"
  return 1
}

lookup_pod() {
  local svc=$1
  kubectl get pod -n "$NAMESPACE" \
    -l "serving.knative.dev/service=${svc}" \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

start_forward() {
  local svc=$1 local_port=$2 container_port=$3

  local pod
  pod="$(lookup_pod "$svc")"
  if [[ -z "$pod" ]]; then
    warn "No running pod found for ${svc} in ${NAMESPACE}, skipping"
    return 1
  fi

  log "Forwarding ${svc}  localhost:${local_port} -> pod/${pod}:${container_port}"
  kubectl port-forward -n "$NAMESPACE" "pod/${pod}" "${local_port}:${container_port}" \
    >/dev/null 2>&1 &
  FORWARD_PIDS+=($!)
}

# Forward a native k8s Service (not a ksvc) from the support-services
# namespace. Used for infra components like NATS that need to be
# reachable from the host running the e2e test suite.
start_support_forward() {
  local svc=$1 local_port=$2 container_port=$3

  if ! kubectl get svc "$svc" -n "$SUPPORT_NAMESPACE" &>/dev/null; then
    warn "Service '${svc}' not found in ${SUPPORT_NAMESPACE}, skipping"
    return 1
  fi

  log "Forwarding ${svc}  localhost:${local_port} -> svc/${svc}:${container_port}  (${SUPPORT_NAMESPACE})"
  kubectl port-forward -n "$SUPPORT_NAMESPACE" "svc/${svc}" \
    "${local_port}:${container_port}" >/dev/null 2>&1 &
  FORWARD_PIDS+=($!)
}

main() {
  detect_context

  if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    err "Namespace '${NAMESPACE}' does not exist."
    err "Deploy platform services first (e.g. ./bootstrap.sh ${ENVIRONMENT} platform-services)."
    exit 1
  fi

  for svc in "${SERVICES[@]}"; do
    if ! wait_for_ksvc "$svc"; then
      warn "Skipping ${svc}"
      continue
    fi
    start_forward "$svc" "${LOCAL_PORTS[$svc]}" "${CONTAINER_PORTS[$svc]}" || true
  done

  # Support-services forwards are best-effort: the namespace may not exist
  # in non-dev environments, in which case we just skip instead of failing.
  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    for svc in "${SUPPORT_SERVICES[@]}"; do
      start_support_forward \
        "$svc" \
        "${SUPPORT_LOCAL_PORTS[$svc]}" \
        "${SUPPORT_CONTAINER_PORTS[$svc]}" || true
    done
  else
    warn "Namespace '${SUPPORT_NAMESPACE}' not found — skipping support-services forwards (NATS, etc.)"
  fi

  if (( ${#FORWARD_PIDS[@]} == 0 )); then
    err "No port-forwards were started. Exiting."
    exit 1
  fi

  echo ""
  log "=============================="
  log " Port-forwards active"
  log "=============================="
  echo ""
  for svc in "${SERVICES[@]}"; do
    local lp="${LOCAL_PORTS[$svc]}"
    echo "  ${svc}:  http://localhost:${lp}"
  done
  for svc in "${SUPPORT_SERVICES[@]}"; do
    local lp="${SUPPORT_LOCAL_PORTS[$svc]}"
    echo "  ${svc}:         localhost:${lp}  (${SUPPORT_NAMESPACE})"
  done
  echo ""
  log "Press Ctrl+C to stop all port-forwards."
  echo ""

  wait
}

main
