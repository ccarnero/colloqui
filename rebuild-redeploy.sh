#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINIKUBE_PROFILE="yoizen-arch"
IMAGE_TAG="local"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }

VALID_SERVICES=(
  api-gateway auth-service event-processor cache-service
  audit-service webhook-service metrics-service tenant-service
  scheduler-service registry-service adapter-service
  channel-service workflow-service workflow-http-worker
  proxy-service yoizenclaw-admin-service admin-console messaging-console
)

VALID_ENVIRONMENTS=(dev qa staging production)

usage() {
  cat <<EOF
Usage: $0 <service-name> [environment] [options]

Rebuilds a Docker image and triggers a Knative rollout for a single service.

Arguments:
  service-name    The service directory name under services/
  environment     Target environment (default: dev)

Options:
  --no-cache      Build Docker image without cache
  --build-only    Only build the image, skip Knative rollout
  --deploy-only   Only trigger Knative rollout, skip image build
  -h, --help      Show this help message

Valid services:
  ${VALID_SERVICES[*]}

Valid environments:
  ${VALID_ENVIRONMENTS[*]}

Examples:
  $0 tenant-service
  $0 tenant-service qa
  $0 yoizenclaw-admin-service dev --no-cache
  $0 tenant-service dev --deploy-only
EOF
}

detect_cluster() {
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"

  if [[ "$ctx" == "orbstack" ]]; then
    echo "orbstack"
  elif [[ "$ctx" == "$MINIKUBE_PROFILE" ]]; then
    echo "minikube"
  else
    if minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
      echo "minikube"
    elif kubectl cluster-info &>/dev/null; then
      echo "unknown"
    else
      echo "none"
    fi
  fi
}

setup_docker_env() {
  local cluster_type="$1"

  if [[ "$cluster_type" == "minikube" ]]; then
    log "Pointing Docker to Minikube daemon (profile: ${MINIKUBE_PROFILE})"
    eval "$(minikube docker-env -p "$MINIKUBE_PROFILE")"
  fi
}

build_image() {
  local svc="$1"
  local no_cache="$2"
  local cache_flag=""

  if [[ "$no_cache" == "true" ]]; then
    cache_flag="--no-cache"
  fi

  local dockerfile="${SCRIPT_DIR}/services/${svc}/Dockerfile"
  if [[ ! -f "$dockerfile" ]]; then
    err "Dockerfile not found: ${dockerfile}"
    exit 1
  fi

  step "Building image: dev.local/${svc}:${IMAGE_TAG}"
  docker build \
    ${cache_flag} \
    -t "dev.local/${svc}:${IMAGE_TAG}" \
    -f "$dockerfile" \
    "${SCRIPT_DIR}"
}

get_ksvc_names() {
  local svc="$1"
  case "$svc" in
    workflow-service) echo "workflow-api workflow-worker" ;;
    *)               echo "$svc" ;;
  esac
}

rollout_ksvc() {
  local svc="$1"
  local env="$2"
  local ns="platform-services-${env}"
  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local ksvc_names
  ksvc_names="$(get_ksvc_names "$svc")"

  for ksvc in $ksvc_names; do
    if ! kubectl get ksvc "$ksvc" -n "$ns" &>/dev/null; then
      warn "Knative service '${ksvc}' not found in namespace '${ns}' — skipping"
      continue
    fi

    step "Patching ksvc/${ksvc} in ${ns} to trigger new revision"
    kubectl patch ksvc "$ksvc" -n "$ns" --type merge \
      -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"client.knative.dev/updateTimestamp\":\"${timestamp}\"}}}}}"

    step "Waiting for ksvc/${ksvc} to become Ready..."
    if kubectl wait ksvc "$ksvc" -n "$ns" \
        --for=condition=Ready --timeout=120s 2>/dev/null; then
      log "ksvc/${ksvc} is Ready"
    else
      warn "Timed out waiting for ksvc/${ksvc} — check pods in ${ns}"
    fi
  done
}

main() {
  local service_name=""
  local environment="dev"
  local no_cache="false"
  local build_only="false"
  local deploy_only="false"

  while (( $# > 0 )); do
    case "$1" in
      -h|--help)      usage; exit 0 ;;
      --no-cache)     no_cache="true"; shift ;;
      --build-only)   build_only="true"; shift ;;
      --deploy-only)  deploy_only="true"; shift ;;
      -*)             err "Unknown option: $1"; usage; exit 1 ;;
      *)
        if [[ -z "$service_name" ]]; then
          service_name="$1"
        elif [[ "$environment" == "dev" ]]; then
          local valid_env=0
          for e in "${VALID_ENVIRONMENTS[@]}"; do
            [[ "$1" == "$e" ]] && valid_env=1 && break
          done
          if (( valid_env )); then
            environment="$1"
          else
            err "Invalid environment: $1"
            echo "Valid: ${VALID_ENVIRONMENTS[*]}"
            exit 1
          fi
        else
          err "Unexpected argument: $1"; usage; exit 1
        fi
        shift ;;
    esac
  done

  if [[ -z "$service_name" ]]; then
    err "Service name is required"
    usage
    exit 1
  fi

  local valid_svc=0
  for s in "${VALID_SERVICES[@]}"; do
    [[ "$service_name" == "$s" ]] && valid_svc=1 && break
  done
  if (( ! valid_svc )); then
    err "Unknown service: ${service_name}"
    echo "Valid: ${VALID_SERVICES[*]}"
    exit 1
  fi

  echo ""
  log "Rebuild & Redeploy"
  log "Service:     ${service_name}"
  log "Environment: ${environment}"
  echo ""

  local cluster_type
  cluster_type="$(detect_cluster)"

  if [[ "$cluster_type" == "none" ]]; then
    err "No Kubernetes cluster reachable. Start Minikube or OrbStack first."
    exit 1
  fi

  log "Cluster type: ${cluster_type}"
  echo ""

  if [[ "$deploy_only" != "true" ]]; then
    setup_docker_env "$cluster_type"
    build_image "$service_name" "$no_cache"
    echo ""
  fi

  if [[ "$build_only" != "true" ]]; then
    rollout_ksvc "$service_name" "$environment"
    echo ""
  fi

  local ksvc_names
  ksvc_names="$(get_ksvc_names "$service_name")"

  log "=============================="
  log " Done!"
  log "=============================="
  echo ""
  echo "  Service:     ${service_name}"
  echo "  Environment: ${environment}"
  echo "  Namespace:   platform-services-${environment}"
  echo ""
  echo "  Check status:"
  for ksvc in $ksvc_names; do
    echo "    kubectl get ksvc ${ksvc} -n platform-services-${environment}"
  done
  echo "    kubectl get pods -n platform-services-${environment} -l serving.knative.dev/service=${service_name}"
  echo ""
}

main "$@"
