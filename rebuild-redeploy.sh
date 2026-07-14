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
  api-gateway auth-service cache-service
  audit-service tenant-service
  registry-service connector-admin
  channel-service workflow-service connector-runtime
  proxy-service agent-admin-service admin-console
  usage-aggregator-service ai-agent-gateway
  agent-memory-service agent-ai-service agent-scheduler-service
  tracking-ingester-service
)

VALID_ENVIRONMENTS=(dev qa staging production)

usage() {
  cat <<EOF
Usage: $0 <service-name> [environment] [options]

Rebuilds a Docker image and triggers a Knative rollout for a single service.

Arguments:
  service-name    Service name: directory under services/
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
  $0 agent-admin-service dev --no-cache
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
    eval "$(minikube docker-env -p "$MINIKUBE_PROFILE" --shell bash)"
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

# Phase 1.5 mapping: each "logical service" (the directory name under
# services/ used as the Docker tag) translates into 0..N Knative Services
# (`*-api`) and 0..N plain Deployments (`*-worker` / Temporal workers).
#
# Implemented as two parallel pure functions instead of a Bash associative
# array so the script stays portable to bash 3.x (macOS default).
get_ksvc_names() {
  local svc="$1"
  case "$svc" in
    connector-admin)          echo "connector-admin-api" ;;
    audit-service)            echo "audit-service-api" ;;
    channel-service)          echo "channel-service-api" ;;
    usage-aggregator-service) echo "usage-aggregator-api" ;;
    workflow-service)         echo "workflow-service-api" ;;
    # tracking-ingester-service is worker-only (no KSVC). An explicit empty
    # case is REQUIRED: the default case echoes "$svc", which would make
    # rollout_ksvc try to patch a nonexistent ksvc named after the service.
    tracking-ingester-service) echo "" ;;
    *)                        echo "$svc" ;;
  esac
}

# Deployment/pod names are accepted as aliases for their logical service so
# callers can pass what they see in `kubectl get pods` (e.g.
# tracking-ingester-worker) instead of the directory name under services/.
normalize_service_name() {
  local name="$1"
  case "$name" in
    tracking-ingester-worker)                    echo "tracking-ingester-service" ;;
    connector-admin-api|connector-admin-worker)  echo "connector-admin" ;;
    audit-service-api|audit-service-worker)      echo "audit-service" ;;
    channel-service-api|channel-service-worker)  echo "channel-service" ;;
    usage-aggregator-api|usage-aggregator-worker) echo "usage-aggregator-service" ;;
    workflow-service-api|workflow-service-worker|workflow-worker) echo "workflow-service" ;;
    *)                                           echo "$name" ;;
  esac
}

# Plain Kubernetes Deployments associated with a logical service. Empty
# string means "no Deployment, KSVC only" (which is the default case).
get_deployment_names() {
  local svc="$1"
  case "$svc" in
    connector-admin)          echo "connector-admin-worker" ;;
    audit-service)            echo "audit-service-worker" ;;
    channel-service)          echo "channel-service-worker" ;;
    usage-aggregator-service) echo "usage-aggregator-worker" ;;
    # workflow-service ships three pods: api KSVC, NATS worker Deployment,
    # and the Temporal worker Deployment (workflow-worker).
    workflow-service)         echo "workflow-service-worker workflow-worker" ;;
    # T07 (connector-invoke-api): connector-runtime ships three Deployments
    # from the same image (worker.ts, http-main.ts, invoke-consumer-main.ts)
    # — all three must roll on rebuild so the facade/consumer pick up the
    # freshly built image alongside the Temporal worker.
    connector-runtime)        echo "connector-runtime connector-runtime-http connector-runtime-invoke" ;;
    tracking-ingester-service) echo "tracking-ingester-worker" ;;
    *)                        echo "" ;;
  esac
}

# Plain Kubernetes CronJobs associated with a logical service. Empty string
# means "no CronJob" (the default case). Unlike ksvc/Deployments, a CronJob
# is not created ahead of time by the base manifests being live in every
# environment — ensure_cronjobs() below applies it on first sight.
get_cronjob_names() {
  local svc="$1"
  case "$svc" in
    tracking-ingester-service) echo "tracking-payload-scrub" ;;
    *)                         echo "" ;;
  esac
}

# Maps environment -> the local kustomize overlay that is actually deployed
# for it. Today only `dev` has a local overlay wired up (see
# dev-mode.sh/dev-mode-minikube.sh cmd_off, which defaults --overlay to
# postgres-dev for the same reason). Other environments don't have a local
# overlay equivalent yet, so callers must warn + skip rather than guess.
get_overlay_path_for_env() {
  local env="$1"
  case "$env" in
    dev) echo "${SCRIPT_DIR}/knative/services/overlays/local/postgres-dev" ;;
    *)   echo "" ;;
  esac
}

# CronJobs are not covered by rollout_ksvc/rollout_deployments (those only
# patch/restart resources that already exist in the cluster). A CronJob
# needs to be created via kustomize the first time it shows up for a
# service; after that, a human takes over `spec.suspend` (see the
# human-runs-first gate documented in
# knative/services/base/tracking-payload-scrub-cronjob.yaml). Re-applying an
# EXISTING CronJob would reset that human-managed suspend flag back to the
# manifest's default (true) — the exact footgun this function must avoid —
# so it only ever applies a CronJob that does not exist yet.
ensure_cronjobs() {
  local svc="$1"
  local env="$2"
  local ns="platform-services-${env}"

  local cronjob_names
  cronjob_names="$(get_cronjob_names "$svc")"

  if [[ -z "$cronjob_names" ]]; then
    return
  fi

  local overlay_path
  overlay_path="$(get_overlay_path_for_env "$env")"

  for cj in $cronjob_names; do
    if kubectl get cronjob "$cj" -n "$ns" &>/dev/null; then
      log "cronjob/${cj} already exists in ${ns} — leaving spec.suspend untouched (human-managed)"
      log "cronjob/${cj} will pick up the rebuilt image automatically on its next scheduled run (same tag, fresh Job pods)"
      continue
    fi

    if [[ -z "$overlay_path" ]]; then
      warn "cronjob/${cj} not found in ${ns} and no local overlay is mapped for environment '${env}' — skipping. Apply it manually."
      continue
    fi

    if [[ ! -d "$overlay_path" ]]; then
      warn "Overlay path not found: ${overlay_path} — skipping cronjob/${cj}. Apply it manually."
      continue
    fi

    step "cronjob/${cj} not found in ${ns} — applying it from overlay ${overlay_path##*/}"

    local rendered
    rendered="$(kubectl kustomize "$overlay_path")"

    # Extract just this CronJob's document. yq/python3 aren't guaranteed to
    # be installed, so we split the rendered multi-doc YAML on '---'
    # boundaries and keep the block that declares both `kind: CronJob` and
    # `name: <cj>` (see dev-mode.sh cmd_off for the equivalent yq-preferred,
    # awk-fallback pattern used elsewhere in this repo — kept awk-only here
    # for simplicity since no other tool is required by this script today).
    local obj_yaml
    obj_yaml="$(printf '%s' "$rendered" | awk -v name="$cj" '
      /^---/ { if (block != "" && is_cronjob && found_name) { print block }; block=""; is_cronjob=0; found_name=0; next }
      /^kind: CronJob[[:space:]]*$/ { is_cronjob=1 }
      /^  name: / { if ($0 == "  name: " name) { found_name=1 } }
      { block = block $0 "\n" }
      END { if (block != "" && is_cronjob && found_name) { print block } }
    ')"

    if [[ -z "$obj_yaml" ]]; then
      err "Could not find CronJob/${cj} in kustomize output for overlay ${overlay_path##*/} — skipping"
      continue
    fi

    printf '%s' "$obj_yaml" | kubectl apply -n "$ns" -f -
    log "cronjob/${cj} applied to ${ns} (suspended per manifest — see tracking-payload-scrub-cronjob.yaml for the unsuspend gate)"
  done
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

rollout_deployments() {
  local svc="$1"
  local env="$2"
  local ns="platform-services-${env}"

  local deploy_names
  deploy_names="$(get_deployment_names "$svc")"

  if [[ -z "$deploy_names" ]]; then
    return
  fi

  for deploy in $deploy_names; do
    if ! kubectl get deployment "$deploy" -n "$ns" &>/dev/null; then
      warn "Deployment '${deploy}' not found in namespace '${ns}' — skipping"
      continue
    fi

    step "Restarting deployment/${deploy} in ${ns} to pick up the new image"
    kubectl rollout restart deployment "$deploy" -n "$ns"

    step "Waiting for deployment/${deploy} to finish rolling out..."
    if kubectl rollout status deployment "$deploy" -n "$ns" --timeout=180s; then
      log "deployment/${deploy} is Ready"
    else
      warn "Timed out waiting for deployment/${deploy} — check pods in ${ns}"
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

  local normalized
  normalized="$(normalize_service_name "$service_name")"
  if [[ "$normalized" != "$service_name" ]]; then
    log "Resolved alias '${service_name}' -> logical service '${normalized}'"
    service_name="$normalized"
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
    rollout_deployments "$service_name" "$environment"
    ensure_cronjobs "$service_name" "$environment"
    echo ""
  fi

  local ksvc_names
  local deploy_names
  local cronjob_names
  ksvc_names="$(get_ksvc_names "$service_name")"
  deploy_names="$(get_deployment_names "$service_name")"
  cronjob_names="$(get_cronjob_names "$service_name")"

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
  for deploy in $deploy_names; do
    echo "    kubectl get deployment ${deploy} -n platform-services-${environment}"
  done
  for cj in $cronjob_names; do
    echo "    kubectl get cronjob ${cj} -n platform-services-${environment}"
  done
  echo "    kubectl get pods -n platform-services-${environment} -l app.kubernetes.io/name=${service_name}"
  echo ""
}

main "$@"
