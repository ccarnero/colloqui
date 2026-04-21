#!/usr/bin/env bash
set -euo pipefail

MINIKUBE_PROFILE="yoizen-arch"
ENVIRONMENT="${1:-dev}"
NAMESPACE="platform-services-${ENVIRONMENT}"
SUPPORT_NAMESPACE="support-services-${ENVIRONMENT}"
KOURIER_NAMESPACE="kourier-system"

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

SUPPORT_SERVICES=(nats)
declare -A SUPPORT_CONTAINER_PORTS=(
  [nats]=4222
)
declare -A SUPPORT_LOCAL_PORTS=(
  [nats]="${NATS_PORT:-4222}"
)

declare -A HOST_FOR_SVC=()
declare -A SSLIP_STATUS_FOR_SVC=()

FORWARD_PIDS=()
FORWARD_LOGS=()

IS_ORBSTACK="false"
CLUSTER_NAME=""
SSLIP_DOMAIN=""
INGRESS_HOST=""
KOURIER_AVAILABLE="false"
EXPECTED_SSLIP_DOMAIN=""
DOMAIN_DRIFT="false"

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
    "  - sslip.io domains through the cluster ingress when reachable" \
    "" \
    "Environment variables:" \
    "  API_GATEWAY_PORT          Local port for api-gateway       (default: 8080)" \
    "  ADMIN_CONSOLE_PORT        Local port for admin-console     (default: 4200)" \
    "  MESSAGING_CONSOLE_PORT    Local port for messaging-console (default: 4300)" \
    "  NATS_PORT                 Local port for NATS client       (default: 4222)" \
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
    SSLIP_DOMAIN="127.0.0.1.sslip.io"
    INGRESS_HOST="127.0.0.1"
    log "Detected OrbStack cluster context"
    return
  fi

  if command -v minikube &>/dev/null && minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    IS_ORBSTACK="false"
    CLUSTER_NAME="Minikube"
    INGRESS_HOST="$(minikube ip -p "$MINIKUBE_PROFILE")"
    SSLIP_DOMAIN="${INGRESS_HOST}.sslip.io"
    log "Detected Minikube profile '${MINIKUBE_PROFILE}'"
    kubectl config use-context "$MINIKUBE_PROFILE" &>/dev/null
    return
  fi

  err "No reachable cluster found (tried OrbStack context and Minikube profile '${MINIKUBE_PROFILE}')."
  err "Run bootstrap-orbstack.sh or bootstrap-minikube.sh first."
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

extract_host_from_url() {
  local url=$1
  local without_scheme="${url#http://}"
  without_scheme="${without_scheme#https://}"
  printf '%s\n' "${without_scheme%%/*}"
}

set_sslip_domain() {
  local domain=$1
  SSLIP_DOMAIN="$domain"
  if [[ "$SSLIP_DOMAIN" == *.sslip.io ]]; then
    INGRESS_HOST="${SSLIP_DOMAIN%.sslip.io}"
  fi
}

get_kourier_external_ip() {
  kubectl get svc kourier -n "$KOURIER_NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
}

populate_host_map() {
  local svc
  for svc in "${SERVICES[@]}"; do
    HOST_FOR_SVC["$svc"]="${svc}.${NAMESPACE}.${SSLIP_DOMAIN}"
  done
}

resolve_sslip_domain() {
  local url="" host="" prefix="" actual_domain="" kourier_ip=""
  url="$(
    kubectl get ksvc api-gateway -n "$NAMESPACE" \
      -o jsonpath='{.status.url}' 2>/dev/null || true
  )"

  if [[ -n "$url" ]]; then
    host="$(extract_host_from_url "$url")"
    prefix="api-gateway.${NAMESPACE}."
    if [[ "$host" == "$prefix"* ]]; then
      actual_domain="${host#"$prefix"}"
    else
      warn "Could not derive sslip domain from '${host}', keeping '${SSLIP_DOMAIN}'."
    fi
  fi

  if [[ "$IS_ORBSTACK" == "false" && "$KOURIER_AVAILABLE" == "true" ]]; then
    kourier_ip="$(get_kourier_external_ip)"
    if [[ -n "$kourier_ip" && "$kourier_ip" != "<pending>" ]]; then
      EXPECTED_SSLIP_DOMAIN="${kourier_ip}.sslip.io"
      if [[ -n "$actual_domain" && "$actual_domain" != "$EXPECTED_SSLIP_DOMAIN" ]]; then
        DOMAIN_DRIFT="true"
        set_sslip_domain "$actual_domain"
        populate_host_map
        return
      fi
      set_sslip_domain "$EXPECTED_SSLIP_DOMAIN"
      populate_host_map
      return
    fi
  fi

  if [[ -n "$actual_domain" ]]; then
    set_sslip_domain "$actual_domain"
  fi

  populate_host_map
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

set_sslip_statuses() {
  local status=$1
  local svc
  for svc in "${SERVICES[@]}"; do
    SSLIP_STATUS_FOR_SVC["$svc"]="$status"
  done
}

ingress_ready_at() {
  local host=$1
  [[ -n "$host" ]] || return 1
  nc -z -w1 "$host" 80 >/dev/null 2>&1
}

report_ingress_status() {
  if [[ "$KOURIER_AVAILABLE" != "true" ]]; then
    set_sslip_statuses "unavailable"
    warn "Namespace '${KOURIER_NAMESPACE}' not found — sslip URLs will not be available."
    return
  fi

  # Case 1: Knative Routes point at a different IP than the Kourier
  # EXTERNAL-IP. Browser traffic to the ksvc URL will hit the wrong IP,
  # so mark all services as stale regardless of reachability.
  if [[ "$DOMAIN_DRIFT" == "true" ]]; then
    set_sslip_statuses "stale-domain"
    warn "Knative domain drift detected."
    warn "ksvc URLs currently resolve to '${SSLIP_DOMAIN}' (${INGRESS_HOST})."
    warn "Kourier EXTERNAL-IP is '${EXPECTED_SSLIP_DOMAIN%.sslip.io}'."
    if [[ "$IS_ORBSTACK" == "false" ]]; then
      warn "Fix with:  ./bootstrap-minikube.sh ${ENVIRONMENT} refresh-dns"
    else
      warn "Re-run bootstrap-orbstack.sh to refresh config-domain."
    fi
    return
  fi

  # Case 2: No drift, ingress is reachable via the sslip.io IP. 
  if ingress_ready_at "$INGRESS_HOST"; then
    set_sslip_statuses "READY"
    log "Ingress is reachable at ${INGRESS_HOST}:80"
    return
  fi

  # Case 3: No drift but Kourier's IP is not reachable from the host.
  # In Minikube (Docker driver) this almost always means `minikube tunnel`
  # is not running. In OrbStack it usually means the LoadBalancer has not
  # finished initializing yet.
  if [[ "$IS_ORBSTACK" == "true" ]]; then
    set_sslip_statuses "unavailable"
    warn "Ingress is not reachable at ${INGRESS_HOST}:80. Check that OrbStack and the Kourier LoadBalancer are running."
    return
  fi

  set_sslip_statuses "needs-tunnel"
  warn "Ingress is not reachable at ${INGRESS_HOST}:80."
  warn "Run this in another terminal to enable the .sslip.io URLs:"
  warn "  sudo minikube tunnel -p ${MINIKUBE_PROFILE}"
  warn "Then re-run:  ./bootstrap-minikube.sh ${ENVIRONMENT} refresh-dns"
}

print_summary() {
  local svc local_port local_url sslip_url sslip_status

  echo ""
  log "=============================="
  log " Port-forwards active"
  log "=============================="
  echo ""
  log "Cluster: ${CLUSTER_NAME}"
  log "Namespace: ${NAMESPACE}"
  if [[ "$DOMAIN_DRIFT" == "true" ]]; then
    log "Expected ingress domain: ${EXPECTED_SSLIP_DOMAIN}"
    log "Current ksvc domain: ${SSLIP_DOMAIN}"
  fi
  echo ""

  for svc in "${SERVICES[@]}"; do
    local_port="${LOCAL_PORTS[$svc]}"
    local_url="http://localhost:${local_port}"
    sslip_url="http://${HOST_FOR_SVC[$svc]}/"
    sslip_status="${SSLIP_STATUS_FOR_SVC[$svc]:-unknown}"

    echo "  ${svc}:"
    echo "    localhost : ${local_url}"
    echo "    sslip     : ${sslip_url} [${sslip_status}]"

    if [[ "$DOMAIN_DRIFT" == "true" && -n "$EXPECTED_SSLIP_DOMAIN" ]]; then
      echo "    working   : http://${svc}.${NAMESPACE}.${EXPECTED_SSLIP_DOMAIN}/"
    fi
  done

  if kubectl get namespace "$SUPPORT_NAMESPACE" &>/dev/null; then
    echo ""
    for svc in "${SUPPORT_SERVICES[@]}"; do
      echo "  ${svc}:"
      echo "    localhost : localhost:${SUPPORT_LOCAL_PORTS[$svc]} (${SUPPORT_NAMESPACE})"
    done
  fi

  echo ""
  echo "  curl examples:"
  echo "    curl http://localhost:${LOCAL_PORTS[api-gateway]}/health"
  if [[ "$DOMAIN_DRIFT" == "true" && -n "$EXPECTED_SSLIP_DOMAIN" ]]; then
    echo "    curl http://api-gateway.${NAMESPACE}.${EXPECTED_SSLIP_DOMAIN}/health"
  else
    echo "    curl http://${HOST_FOR_SVC[api-gateway]}/health"
  fi

  if [[ "$DOMAIN_DRIFT" == "true" && "$IS_ORBSTACK" == "false" ]]; then
    echo ""
    echo "  To fix stale sslip URLs (re-syncs Knative with the current Kourier LB):"
    echo "    ./bootstrap-minikube.sh ${ENVIRONMENT} refresh-dns"
  fi

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
    start_app_forward "$svc" "${LOCAL_PORTS[$svc]}" "${CONTAINER_PORTS[$svc]}" || true
  done

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

  resolve_sslip_domain
  report_ingress_status
  print_summary

  wait
}

main
