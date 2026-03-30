#!/usr/bin/env bash
set -euo pipefail

PROFILE="yoizen-arch"
ALL_ENVIRONMENTS=(dev qa staging production)
ALL_GROUPS=(support-services platform-services)
ENVIRONMENTS=()
SERVICE_GROUP=""
KNATIVE_VERSION="v1.17.0"
KOURIER_VERSION="v1.17.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

usage() {
  cat <<EOF
Usage: $0 [OPTIONS] [ENV...] [GROUP]

Environments: ${ALL_ENVIRONMENTS[*]}
  (defaults to all if omitted)

Groups: ${ALL_GROUPS[*]}
  (defaults to both if omitted)

Options:
  -h, --help    Show this help message

Examples:
  $0 dev support-services       # Cluster init + infrastructure only
  $0 dev platform-services      # Build images + deploy Knative services
  $0 dev                        # Full bootstrap (both groups)
  $0 dev qa support-services    # Infrastructure for dev and qa
EOF
}

parse_args() {
  ENVIRONMENTS=()
  SERVICE_GROUP=""
  local positional=()

  for arg in "$@"; do
    case "$arg" in
      -h|--help) usage; exit 0 ;;
      -*)        err "Unknown option: $arg"; usage; exit 1 ;;
      *)         positional+=("$arg") ;;
    esac
  done

  if (( ${#positional[@]} > 0 )); then
    local last="${positional[-1]}"
    local is_group=0
    for g in "${ALL_GROUPS[@]}"; do
      [[ "$last" == "$g" ]] && is_group=1 && break
    done
    if (( is_group )); then
      SERVICE_GROUP="$last"
      unset 'positional[-1]'
    fi
  fi

  for arg in "${positional[@]+"${positional[@]}"}"; do
    local valid=0
    for e in "${ALL_ENVIRONMENTS[@]}"; do
      [[ "$arg" == "$e" ]] && valid=1 && break
    done
    if (( valid )); then
      ENVIRONMENTS+=("$arg")
    else
      err "Invalid environment: $arg"
      echo "Valid: ${ALL_ENVIRONMENTS[*]}"
      exit 1
    fi
  done

  if (( ${#ENVIRONMENTS[@]} == 0 )); then
    ENVIRONMENTS=("${ALL_ENVIRONMENTS[@]}")
  fi
}

check_deps() {
  local missing=()
  for cmd in minikube kubectl; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  if (( ${#missing[@]} )); then
    err "Missing required tools: ${missing[*]}"
    exit 1
  fi
}

retry() {
  local max_attempts=$1 delay=$2
  shift 2
  local attempt=1
  until "$@"; do
    if (( attempt >= max_attempts )); then
      err "Command failed after ${max_attempts} attempts: $*"
      return 1
    fi
    warn "Attempt ${attempt}/${max_attempts} failed, retrying in ${delay}s..."
    sleep "$delay"
    (( attempt++ ))
  done
}

wait_for_webhook() {
  log "Waiting for Knative webhook to be ready..."
  kubectl wait pod \
    --namespace knative-serving \
    -l app=webhook \
    --for=condition=Ready \
    --timeout=120s
  sleep 5
}

start_minikube() {
  if minikube status -p "$PROFILE" &>/dev/null; then
    log "Minikube profile '$PROFILE' already running"
  else
    log "Starting minikube profile '$PROFILE' (cpus=6, memory=16384)"
    minikube start \
      -p "$PROFILE" \
      --cpus=6 \
      --memory=16384 \
      --driver=docker \
      --kubernetes-version=stable
  fi

  log "Setting kubectl context to profile '$PROFILE'"
  kubectl config use-context "$PROFILE"

  log "Enabling addons: metrics-server"
  minikube addons enable metrics-server -p "$PROFILE"
}

install_knative_serving() {
  log "Installing Knative Serving CRDs (${KNATIVE_VERSION})"
  kubectl apply -f "https://github.com/knative/serving/releases/download/knative-${KNATIVE_VERSION}/serving-crds.yaml"

  log "Installing Knative Serving core (${KNATIVE_VERSION})"
  kubectl apply -f "https://github.com/knative/serving/releases/download/knative-${KNATIVE_VERSION}/serving-core.yaml"

  log "Waiting for Knative Serving deployments..."
  kubectl wait deployment --all \
    --namespace knative-serving \
    --for=condition=Available \
    --timeout=300s
}

install_kourier() {
  log "Installing Kourier networking layer (${KOURIER_VERSION})"
  kubectl apply -f "https://github.com/knative/net-kourier/releases/download/knative-${KOURIER_VERSION}/kourier.yaml"

  wait_for_webhook

  log "Configuring Knative to use Kourier"
  retry 10 5 kubectl patch configmap/config-network \
    --namespace knative-serving \
    --type merge \
    --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'

  log "Waiting for Kourier..."
  kubectl wait deployment --all \
    --namespace kourier-system \
    --for=condition=Available \
    --timeout=180s
}

configure_dns() {
  log "Configuring DNS with sslip.io"
  retry 5 3 kubectl patch configmap/config-domain \
    --namespace knative-serving \
    --type merge \
    --patch "{\"data\":{\"$(minikube ip -p "$PROFILE").sslip.io\":\"\"}}"
}

configure_local_registry() {
  log "Configuring Knative to skip tag-to-digest resolution for local images"
  retry 5 3 kubectl patch configmap/config-deployment \
    --namespace knative-serving \
    --type merge \
    --patch '{"data":{"registries-skipping-tag-resolving":"dev.local"}}'
}

apply_namespaces() {
  for env in "${ENVIRONMENTS[@]}"; do
    for prefix in support-services platform-services; do
      local ns="${prefix}-${env}"
      if kubectl get namespace "$ns" &>/dev/null; then
        log "Namespace '${ns}' already exists"
      else
        log "Creating namespace '${ns}'"
        kubectl create namespace "$ns"
        kubectl label namespace "$ns" \
          app.kubernetes.io/part-of=yoizen-arch \
          yoizen.io/environment="$env"
      fi
    done
  done
}

apply_infrastructure() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  for env in "${ENVIRONMENTS[@]}"; do
    local ns="support-services-${env}"

    log "Applying infrastructure for '${env}'"
    kubectl apply -k "${script_dir}/infrastructure/overlays/local/${env}"

    log "Waiting for NATS in ${ns}..."
    kubectl rollout status statefulset/nats \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for Redis in ${ns}..."
    kubectl rollout status deployment/redis \
      --namespace "$ns" \
      --timeout=120s

    log "Waiting for PostgreSQL in ${ns}..."
    kubectl rollout status statefulset/postgres \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for Temporal in ${ns}..."
    kubectl rollout status deployment/temporal \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for OTel Collector in ${ns}..."
    kubectl rollout status deployment/otel-collector \
      --namespace "$ns" \
      --timeout=120s

    log "Waiting for Tempo in ${ns}..."
    kubectl rollout status deployment/tempo \
      --namespace "$ns" \
      --timeout=120s

    log "Waiting for Prometheus in ${ns}..."
    kubectl rollout status deployment/prometheus \
      --namespace "$ns" \
      --timeout=120s

    log "Waiting for Loki in ${ns}..."
    kubectl rollout status deployment/loki \
      --namespace "$ns" \
      --timeout=120s

    log "Waiting for Grafana in ${ns}..."
    kubectl rollout status deployment/grafana \
      --namespace "$ns" \
      --timeout=120s
  done
}

apply_knative_config() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  log "Applying Knative autoscaler config"
  retry 5 3 kubectl apply -k "${script_dir}/knative/serving"

  log "Applying Knative RBAC"
  retry 5 3 kubectl apply -k "${script_dir}/knative/services/rbac"

  for env in "${ENVIRONMENTS[@]}"; do
    log "Applying Knative services for '${env}'"
    retry 5 3 kubectl apply -k "${script_dir}/knative/services/overlays/local/${env}"
  done
}

build_packages() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  log "Installing packages/observability dependencies"
  npm install --prefix "${script_dir}/packages/observability"
}

build_images() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  log "Pointing Docker to minikube daemon"
  eval "$(minikube docker-env -p "$PROFILE")"

  for svc in api-gateway auth-service event-processor cache-service \
             audit-service webhook-service metrics-service tenant-service \
             scheduler-service registry-service adapter-service \
             channel-service workflow-service workflow-http-worker \
             proxy-service admin-console; do
    log "Building image: dev.local/${svc}:local"
    docker build \
      -t "dev.local/${svc}:local" \
      -f "${script_dir}/services/${svc}/Dockerfile" \
      "${script_dir}"
  done
}

# ---------------------------------------------------------------------------
# Cluster & dependency verification (used by platform-services standalone)
# ---------------------------------------------------------------------------

verify_cluster() {
  if ! minikube status -p "$PROFILE" &>/dev/null; then
    err "Minikube profile '$PROFILE' is not running."
    err "Run './bootstrap.sh <env> support-services' first."
    exit 1
  fi
  kubectl config use-context "$PROFILE" &>/dev/null
  log "Cluster is reachable (profile: $PROFILE)"
}

verify_support_services() {
  local core_deployments=(redis otel-collector tempo prometheus loki grafana)
  local core_statefulsets=(nats postgres)

  for env in "${ENVIRONMENTS[@]}"; do
    local ns="support-services-${env}"
    if ! kubectl get namespace "$ns" &>/dev/null; then
      warn "Namespace '${ns}' does not exist — support-services may not be deployed"
      continue
    fi

    for dep in "${core_deployments[@]}"; do
      if ! kubectl get deployment/"$dep" --namespace "$ns" &>/dev/null; then
        warn "Deployment '${dep}' not found in ${ns}"
      fi
    done
    for sts in "${core_statefulsets[@]}"; do
      if ! kubectl get statefulset/"$sts" --namespace "$ns" &>/dev/null; then
        warn "StatefulSet '${sts}' not found in ${ns}"
      fi
    done

    if ! kubectl get deployment/temporal --namespace "$ns" &>/dev/null; then
      warn "Deployment 'temporal' not found in ${ns}"
    fi
  done
}

# ---------------------------------------------------------------------------
# Service group runners
# ---------------------------------------------------------------------------

run_support_services() {
  log "===== support-services (initial configuration + infrastructure) ====="
  echo ""
  start_minikube
  install_knative_serving
  install_kourier
  configure_dns
  configure_local_registry
  apply_namespaces
  apply_infrastructure
}

run_platform_services() {
  log "===== platform-services (build + deploy) ====="
  echo ""
  verify_cluster
  verify_support_services
  build_packages
  build_images
  apply_knative_config
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print_summary() {
  local minikube_ip
  minikube_ip="$(minikube ip -p "$PROFILE")"
  local group_label="${SERVICE_GROUP:-all}"

  echo ""
  log "=============================="
  log " Setup complete! [${group_label}]"
  log "=============================="
  echo ""
  echo "  Minikube IP:   ${minikube_ip}"
  echo "  DNS domain:    ${minikube_ip}.sslip.io"
  echo "  Environments:  ${ENVIRONMENTS[*]}"
  echo "  Group:         ${group_label}"
  echo ""

  if [[ "$SERVICE_GROUP" != "platform-services" ]]; then
    echo "  Namespaces:"
    for env in "${ENVIRONMENTS[@]}"; do
      echo "    support-services-${env}   platform-services-${env}"
    done
    echo ""
    echo "  Observability:"
    for env in "${ENVIRONMENTS[@]}"; do
      echo "    Grafana:     kubectl port-forward -n support-services-${env} svc/grafana 3001:3000"
      echo "    Tempo:       kubectl port-forward -n support-services-${env} svc/tempo 3200:3200"
      echo "    Prometheus:  kubectl port-forward -n support-services-${env} svc/prometheus 9090:9090"
    done
    echo ""
  fi

  if [[ "$SERVICE_GROUP" != "support-services" ]]; then
    echo "  Useful commands:"
    for env in "${ENVIRONMENTS[@]}"; do
      echo "    kubectl get ksvc -n platform-services-${env}"
    done
    echo "    kubectl get pods --all-namespaces -l app.kubernetes.io/part-of=yoizen-arch"
    echo "    minikube tunnel -p ${PROFILE}"
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  parse_args "$@"

  log "Event-Driven Architecture Bootstrap"
  log "Environments: ${ENVIRONMENTS[*]}"
  log "Group:        ${SERVICE_GROUP:-all}"
  echo ""

  check_deps

  case "$SERVICE_GROUP" in
    support-services)
      run_support_services
      ;;
    platform-services)
      run_platform_services
      ;;
    "")
      run_support_services
      run_platform_services
      ;;
  esac

  print_summary
}

main "$@"
