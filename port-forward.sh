#!/usr/bin/env bash
set -euo pipefail

MINIKUBE_PROFILE="yoizen-arch"
STORAGE_ENGINE="${STORAGE_ENGINE:-postgres}"
ENVIRONMENT="${1:-dev}"
NAMESPACE="platform-services-${ENVIRONMENT}"
SUPPORT_NAMESPACE="support-services-${ENVIRONMENT}"
KOURIER_NAMESPACE="kourier-system"

SERVICES=(api-gateway admin-console)
SUPPORT_SERVICES=(nats temporal-ui)

# Bash 3.2 (macOS) lacks associative arrays; use case-based lookups.
container_port_for() {
  case "$1" in
    api-gateway)       echo 3000 ;;
    admin-console)     echo 8080 ;;
    *) return 1 ;;
  esac
}

local_port_for() {
  case "$1" in
    api-gateway)       echo "${API_GATEWAY_PORT:-8080}" ;;
    admin-console)     echo "${ADMIN_CONSOLE_PORT:-4300}" ;;
    *) return 1 ;;
  esac
}

support_container_port_for() {
  case "$1" in
    nats)        echo 4222 ;;
    temporal-ui) echo 80 ;;
    *) return 1 ;;
  esac
}

support_local_port_for() {
  case "$1" in
    nats)        echo "${NATS_PORT:-4222}" ;;
    temporal-ui) echo "${TEMPORAL_UI_PORT:-8233}" ;;
    *) return 1 ;;
  esac
}

# Dynamic per-service state — emulated associative arrays via namespaced vars
# (e.g. HOST_FOR_SVC__api_gateway). Safe under `set -u` because get_ns uses
# parameter-default expansion.
_ns_key() {
  local k="${1//-/_}"
  printf '%s' "${k//./_}"
}

set_ns() {
  local prefix=$1 key=$2 value=$3
  local safe
  safe="$(_ns_key "$key")"
  eval "${prefix}__${safe}=\$value"
}

get_ns() {
  local prefix=$1 key=$2 default=${3:-}
  local safe var
  safe="$(_ns_key "$key")"
  var="${prefix}__${safe}"
  eval "printf '%s' \"\${${var}:-\$default}\""
}

FORWARD_PIDS=()
FORWARD_LOGS=()

IS_ORBSTACK="false"
CLUSTER_NAME=""
DEV_DOMAIN="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"
INGRESS_HOST="127.0.0.1"
KOURIER_AVAILABLE="false"

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
    "Access modes:" \
    "  - localhost ports for direct pod/service forwards" \
    "  - dev.local domains through the cluster ingress when /etc/hosts is configured" \
    "" \
    "Environment variables:" \
    "  API_GATEWAY_PORT          Local port for api-gateway       (default: 8080)" \
    "  ADMIN_CONSOLE_PORT        Local port for admin-console     (default: 4300)" \
    "  NATS_PORT                 Local port for NATS client       (default: 4222)" \
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
  local host=$1 port=$2 max_attempts=${3:-30}
  local attempt=0
  while ! nc -z "$host" "$port" 2>/dev/null; do
    if (( attempt >= max_attempts )); then
      return 1
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
}

print_forward_error() {
  local name=$1 local_port=$2 log_file=$3
  err "Port-forward for ${name} did not become available on localhost:${local_port}."
  if [[ -s "$log_file" ]]; then
    err "kubectl output:"
    sed 's/^/  /' "$log_file" >&2
  fi
}

detect_context() {
  local current_context
  current_context="$(kubectl config current-context 2>/dev/null || true)"

  if [[ "$current_context" == "orbstack" ]]; then
    IS_ORBSTACK="true"
    CLUSTER_NAME="OrbStack"
    log "Detected OrbStack cluster context"
    return
  fi

  if command -v minikube &>/dev/null && minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    IS_ORBSTACK="false"
    CLUSTER_NAME="Minikube"
    log "Detected Minikube profile '${MINIKUBE_PROFILE}'"
    kubectl config use-context "$MINIKUBE_PROFILE" &>/dev/null
    return
  fi

  err "No reachable cluster found (tried OrbStack context and Minikube profile '${MINIKUBE_PROFILE}')."
  err "Run bootstrap-orbstack-osx.sh first."
  exit 1
}

wait_for_ksvc() {
  local svc=$1 timeout_s=${2:-120}
  log "Waiting for ksvc/${svc} to be Ready (timeout ${timeout_s}s)..."

  local elapsed=0
  while (( elapsed < timeout_s )); do
    local ready
    ready="$(
      kubectl get ksvc "$svc" -n "$NAMESPACE" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' \
        2>/dev/null || echo ""
    )"
    if [[ "$ready" == "True" ]]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
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

populate_host_map() {
  local svc
  for svc in "${SERVICES[@]}"; do
    set_ns HOST_FOR_SVC "$svc" "${svc}.${NAMESPACE}.${DEV_DOMAIN}"
  done
}

start_app_forward() {
  local svc=$1 local_port=$2 container_port=$3
  local pod log_file pid attempt=0 max_attempts=30

  pod="$(lookup_pod "$svc")"
  if [[ -z "$pod" ]]; then
    warn "No running pod found for ${svc} in ${NAMESPACE}, skipping"
    return 1
  fi

  log_file="$(mktemp -t "${svc}.port-forward.XXXXXX")"
  FORWARD_LOGS+=("$log_file")

  log "Forwarding ${svc}  localhost:${local_port} -> pod/${pod}:${container_port}"
  kubectl port-forward -n "$NAMESPACE" "pod/${pod}" \
    "${local_port}:${container_port}" >"$log_file" 2>&1 &

  pid=$!
  FORWARD_PIDS+=("$pid")

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
  local log_file pid attempt=0 max_attempts=30

  if ! kubectl get svc "$svc" -n "$SUPPORT_NAMESPACE" &>/dev/null; then
    warn "Service '${svc}' not found in ${SUPPORT_NAMESPACE}, skipping"
    return 1
  fi

  log_file="$(mktemp -t "${svc}.port-forward.XXXXXX")"
  FORWARD_LOGS+=("$log_file")

  log "Forwarding ${svc}  localhost:${local_port} -> svc/${svc}:${container_port} (${SUPPORT_NAMESPACE})"
  kubectl port-forward -n "$SUPPORT_NAMESPACE" "svc/${svc}" \
    "${local_port}:${container_port}" >"$log_file" 2>&1 &

  pid=$!
  FORWARD_PIDS+=("$pid")

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

set_ingress_statuses() {
  local status=$1
  local svc
  for svc in "${SERVICES[@]}"; do
    set_ns INGRESS_STATUS_FOR_SVC "$svc" "$status"
  done
}

ingress_ready_at() {
  local host=$1
  [[ -n "$host" ]] || return 1
  nc -z -w1 "$host" 80 >/dev/null 2>&1
}

report_ingress_status() {
  if [[ "$KOURIER_AVAILABLE" != "true" ]]; then
    set_ingress_statuses "unavailable"
    warn "Namespace '${KOURIER_NAMESPACE}' not found — direct ingress URLs will not be available."
    return
  fi

  if ingress_ready_at "$INGRESS_HOST"; then
    set_ingress_statuses "READY"
    log "Ingress is reachable at ${INGRESS_HOST}:80 (dev.local)"
    return
  fi

  if [[ "$IS_ORBSTACK" == "true" ]]; then
    set_ingress_statuses "unavailable"
    warn "Ingress is not reachable at ${INGRESS_HOST}:80. Check that OrbStack and the Kourier LoadBalancer are running."
    return
  fi

  set_ingress_statuses "needs-tunnel"
  warn "Ingress is not reachable at ${INGRESS_HOST}:80."
  warn "Run this in another terminal to expose the Kourier LoadBalancer:"
  warn "  sudo minikube tunnel -p ${MINIKUBE_PROFILE}"
}

print_summary() {
  local svc local_port local_url ingress_url ingress_status

  echo ""
  log "=============================="
  log " Port-forwards active"
  log "=============================="
  echo ""
  log "Cluster:   ${CLUSTER_NAME}"
  log "Namespace: ${NAMESPACE}"
  log "Domain:    ${DEV_DOMAIN}"
  echo ""

  for svc in "${SERVICES[@]}"; do
    local_port="$(local_port_for "$svc")"
    local_url="http://localhost:${local_port}"
    ingress_url="http://$(get_ns HOST_FOR_SVC "$svc")/"
    ingress_status="$(get_ns INGRESS_STATUS_FOR_SVC "$svc" unknown)"

    echo "  ${svc}:"
    echo "    localhost : ${local_url}"
    echo "    ingress   : ${ingress_url} [${ingress_status}]"
  done

  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    echo ""
    for svc in "${SUPPORT_SERVICES[@]}"; do
      echo "  ${svc}:"
      echo "    localhost : localhost:$(support_local_port_for "$svc") (${SUPPORT_NAMESPACE})"
    done
    if [[ "$STORAGE_ENGINE" == "mongo" ]]; then
      echo "  mongo-platform:"
      echo "    localhost : localhost:${MONGO_PLATFORM_PORT:-27017} (${SUPPORT_NAMESPACE})"
      echo "  mongo-usage:"
      echo "    localhost : localhost:${MONGO_USAGE_PORT:-27018} (${SUPPORT_NAMESPACE})"
    fi
  fi

  echo ""
  echo "  curl examples:"
  echo "    curl http://localhost:$(local_port_for api-gateway)/health"
  echo "    curl http://$(get_ns HOST_FOR_SVC api-gateway)/health"

  echo ""
  log "Press Ctrl+C to stop all port-forwards."
  echo ""
}

main() {
  local svc

  detect_context

  if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    err "Namespace '${NAMESPACE}' does not exist."
    err "Deploy platform services first (e.g. ./bootstrap.sh ${ENVIRONMENT} platform-services)."
    exit 1
  fi

  if kubectl get namespace "$KOURIER_NAMESPACE" &>/dev/null; then
    KOURIER_AVAILABLE="true"
  fi

  for svc in "${SERVICES[@]}"; do
    if ! wait_for_ksvc "$svc"; then
      warn "Skipping ${svc}"
      continue
    fi
    start_app_forward "$svc" "$(local_port_for "$svc")" "$(container_port_for "$svc")" || true
  done

  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    for svc in "${SUPPORT_SERVICES[@]}"; do
      start_support_forward \
        "$svc" \
        "$(support_local_port_for "$svc")" \
        "$(support_container_port_for "$svc")" || true
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
    warn "Namespace '${SUPPORT_NAMESPACE}' not found — skipping support-services forwards (NATS, etc.)"
  fi

  if (( ${#FORWARD_PIDS[@]} == 0 )); then
    err "No port-forwards were started. Exiting."
    exit 1
  fi

  populate_host_map
  report_ingress_status
  print_summary

  wait
}

main
