#!/usr/bin/env bash
set -euo pipefail

MINIKUBE_PROFILE="yoizen-arch"
STORAGE_ENGINE="${STORAGE_ENGINE:-postgres}"
ENVIRONMENT="${1:-dev}"
NAMESPACE="platform-services-${ENVIRONMENT}"
SUPPORT_NAMESPACE="support-services-${ENVIRONMENT}"
KOURIER_NAMESPACE="kourier-system"
KOURIER_SVC="svc/kourier"

SERVICES=(
  "api-gateway:${API_GATEWAY_PORT:-8080}"
  "admin-console:${ADMIN_CONSOLE_PORT:-4200}"
)

# Support-namespace services forwarded directly (bypassing Kourier). Each entry
# is "<service>:<local_port>:<container_port>".
SUPPORT_FORWARDS=(
  "temporal-ui:${TEMPORAL_UI_PORT:-8233}:80"
)

FORWARD_PIDS=()
FORWARD_LOGS=()
IS_ORBSTACK="false"
DEV_DOMAIN="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"

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
  for log_file in "${FORWARD_LOGS[@]}"; do
    rm -f "$log_file"
  done
  log "All port-forwards stopped."
}
trap cleanup EXIT INT TERM

usage() {
  printf '%s\n' \
    "Usage: $0 [ENV]" \
    "" \
    "  ENV   Environment name (default: dev)" \
    "" \
    "All services are forwarded through the Kourier ingress gateway." \
    "Requests are routed by the Host header that Kourier inspects." \
    "" \
    "Environment variables:" \
    "  API_GATEWAY_PORT          Local port for api-gateway       (default: 8080)" \
    "  ADMIN_CONSOLE_PORT        Local port for admin-console     (default: 4200)" \
    "  TEMPORAL_UI_PORT          Local port for Temporal Web UI   (default: 8233)" \
    "  STORAGE_ENGINE            postgres (default) or mongo" \
    "  MONGO_PLATFORM_PORT       Local port for mongo-platform    (default: 27017)" \
    "  MONGO_USAGE_PORT          Local port for mongo-usage       (default: 27018)" \
    "" \
    "Examples:" \
    "  $0              # Forward services in platform-services-dev" \
    "  $0 qa           # Forward services in platform-services-qa"
  exit 0
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

wait_for_port() {
  local port=$1 max_attempts=${2:-30}
  local attempt=0
  while ! nc -z localhost "$port" 2>/dev/null; do
    if (( attempt >= max_attempts )); then
      return 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

print_forward_error() {
  local svc=$1 local_port=$2 log_file=$3
  err "Port-forward for ${svc} did not become available on localhost:${local_port}."
  if [[ -s "$log_file" ]]; then
    err "kubectl output:"
    cat "$log_file" >&2
  fi
}

detect_context() {
  if kubectl config current-context 2>/dev/null | grep -q "^orbstack$"; then
    IS_ORBSTACK="true"
    log "Detected OrbStack cluster context"
    return
  fi

  if command -v minikube &>/dev/null && minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    log "Detected Minikube profile '${MINIKUBE_PROFILE}'"
    kubectl config use-context "$MINIKUBE_PROFILE" &>/dev/null
    return
  fi

  err "No reachable cluster found (tried OrbStack context and Minikube profile '${MINIKUBE_PROFILE}')."
  err "Run bootstrap.sh or bootstrap-orbstack.sh first."
  exit 1
}

start_forward() {
  local svc=$1 local_port=$2
  local log_file
  log_file="$(mktemp -t "${svc}.port-forward")"
  FORWARD_LOGS+=("$log_file")

  log "Forwarding ${svc}  localhost:${local_port} -> ${KOURIER_SVC}:80 (kourier-system)"
  kubectl port-forward -n "$KOURIER_NAMESPACE" "$KOURIER_SVC" "${local_port}:80" \
    >"$log_file" 2>&1 &

  local pid=$!
  FORWARD_PIDS+=("$pid")

  local attempt=0
  local max_attempts=30
  while ! nc -z localhost "$local_port" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null; then
      print_forward_error "$svc" "$local_port" "$log_file"
      return 1
    fi
    if (( attempt >= max_attempts )); then
      print_forward_error "$svc" "$local_port" "$log_file"
      kill "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

start_support_forward() {
  local svc=$1 local_port=$2 container_port=$3
  local log_file

  if ! kubectl get svc "$svc" -n "$SUPPORT_NAMESPACE" &>/dev/null; then
    warn "Service '${svc}' not found in ${SUPPORT_NAMESPACE}, skipping"
    return 1
  fi

  log_file="$(mktemp -t "${svc}.port-forward")"
  FORWARD_LOGS+=("$log_file")

  log "Forwarding ${svc}  localhost:${local_port} -> svc/${svc}:${container_port} (${SUPPORT_NAMESPACE})"
  kubectl port-forward -n "$SUPPORT_NAMESPACE" "svc/${svc}" \
    "${local_port}:${container_port}" >"$log_file" 2>&1 &

  local pid=$!
  FORWARD_PIDS+=("$pid")

  local attempt=0
  local max_attempts=30
  while ! nc -z localhost "$local_port" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null; then
      print_forward_error "$svc" "$local_port" "$log_file"
      return 1
    fi
    if (( attempt >= max_attempts )); then
      print_forward_error "$svc" "$local_port" "$log_file"
      kill "$pid" 2>/dev/null || true
      return 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

main() {
  detect_context

  if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    err "Namespace '${NAMESPACE}' does not exist."
    err "Deploy platform services first (e.g. ./bootstrap.sh ${ENVIRONMENT} platform-services)."
    exit 1
  fi

  if ! kubectl get namespace "$KOURIER_NAMESPACE" &>/dev/null; then
    err "Namespace '${KOURIER_NAMESPACE}' does not exist. Kourier is not installed."
    err "Run bootstrap.sh or bootstrap-orbstack.sh first."
    exit 1
  fi

  local entry svc local_port container_port
  for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    local_port="${entry##*:}"
    start_forward "$svc" "$local_port" || true
  done

  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    for entry in "${SUPPORT_FORWARDS[@]}"; do
      svc="${entry%%:*}"
      local rest="${entry#*:}"
      local_port="${rest%%:*}"
      container_port="${rest#*:}"
      start_support_forward "$svc" "$local_port" "$container_port" || true
    done
    if [[ "$STORAGE_ENGINE" == "mongo" ]]; then
      start_support_forward \
        mongo-platform \
        "${MONGO_PLATFORM_PORT:-27017}" \
        27017 || true
      start_support_forward \
        mongo-usage \
        "${MONGO_USAGE_PORT:-27018}" \
        27017 || true
    fi
  else
    warn "Namespace '${SUPPORT_NAMESPACE}' not found — skipping support-services forwards (Temporal UI, etc.)"
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
  for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    local_port="${entry##*:}"
    local host_hdr="${svc}.${NAMESPACE}.${DEV_DOMAIN}"
    echo "  ${svc}:"
    echo "    localhost : http://localhost:${local_port}"
    echo "    Host hdr  : ${host_hdr}"
  done

  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    echo ""
    for entry in "${SUPPORT_FORWARDS[@]}"; do
      svc="${entry%%:*}"
      local rest="${entry#*:}"
      local_port="${rest%%:*}"
      echo "  ${svc}:"
      echo "    localhost : http://localhost:${local_port} (${SUPPORT_NAMESPACE})"
    done
    if [[ "$STORAGE_ENGINE" == "mongo" ]]; then
      echo "  mongo-platform:"
      echo "    localhost : mongodb://localhost:${MONGO_PLATFORM_PORT:-27017} (${SUPPORT_NAMESPACE})"
      echo "  mongo-usage:"
      echo "    localhost : mongodb://localhost:${MONGO_USAGE_PORT:-27018} (${SUPPORT_NAMESPACE})"
    fi
  fi

  echo ""
  echo "  Direct ingress (no port-forward):"
  for entry in "${SERVICES[@]}"; do
    svc="${entry%%:*}"
    echo "    http://${svc}.${NAMESPACE}.${DEV_DOMAIN}"
  done
  echo ""
  echo "  curl example:"
  echo "    curl -H 'Host: api-gateway.${NAMESPACE}.${DEV_DOMAIN}' http://localhost:8080/health"
  echo ""
  log "Press Ctrl+C to stop all port-forwards."
  echo ""

  wait
}

main
