#!/usr/bin/env bash
set -euo pipefail

PROFILE="yoizen-arch"
ALL_ENVIRONMENTS=(dev qa staging production)
ENVIRONMENTS=()
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
  echo "Usage: $0 [OPTIONS] [ENV...]"
  echo ""
  echo "Environments: ${ALL_ENVIRONMENTS[*]}"
  echo "If no environments specified, all are deployed."
  echo ""
  echo "Options:"
  echo "  -h, --help    Show this help message"
}

parse_args() {
  ENVIRONMENTS=()
  for arg in "$@"; do
    case "$arg" in
      -h|--help) usage; exit 0 ;;
      -*)        err "Unknown option: $arg"; usage; exit 1 ;;
      *)
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
        ;;
    esac
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

    log "Waiting for Jaeger in ${ns}..."
    kubectl rollout status deployment/jaeger \
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

build_images() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  log "Pointing Docker to minikube daemon"
  eval "$(minikube docker-env -p "$PROFILE")"

  for svc in api-gateway auth-service event-processor cache-service audit-service webhook-service metrics-service tenant-service scheduler-service registry-service workflow-service workflow-http-worker proxy-service; do
    log "Building image: dev.local/${svc}:local"
    docker build \
      -t "dev.local/${svc}:local" \
      -f "${script_dir}/services/${svc}/Dockerfile" \
      "${script_dir}"
  done
}

print_summary() {
  local minikube_ip
  minikube_ip="$(minikube ip -p "$PROFILE")"

  echo ""
  log "=============================="
  log " Setup complete!"
  log "=============================="
  echo ""
  echo "  Minikube IP:   ${minikube_ip}"
  echo "  DNS domain:    ${minikube_ip}.sslip.io"
  echo "  Environments:  ${ENVIRONMENTS[*]}"
  echo ""
  echo "  Namespaces:"
  for env in "${ENVIRONMENTS[@]}"; do
    echo "    support-services-${env}   platform-services-${env}"
  done
  echo ""
  echo "  Observability:"
  for env in "${ENVIRONMENTS[@]}"; do
    echo "    Grafana:     kubectl port-forward -n support-services-${env} svc/grafana 3001:3000"
    echo "    Jaeger:      kubectl port-forward -n support-services-${env} svc/jaeger 16686:16686"
    echo "    Prometheus:  kubectl port-forward -n support-services-${env} svc/prometheus 9090:9090"
  done
  echo ""
  echo "  Useful commands:"
  for env in "${ENVIRONMENTS[@]}"; do
    echo "    kubectl get ksvc -n platform-services-${env}"
  done
  echo "    kubectl get pods --all-namespaces -l app.kubernetes.io/part-of=yoizen-arch"
  echo "    minikube tunnel -p ${PROFILE}"
  echo ""
}

main() {
  parse_args "$@"

  log "Event-Driven Architecture Bootstrap"
  log "Environments: ${ENVIRONMENTS[*]}"
  echo ""

  check_deps
  start_minikube
  install_knative_serving
  install_kourier
  configure_dns
  configure_local_registry
  apply_namespaces
  apply_infrastructure
  build_images
  apply_knative_config
  print_summary
}

main "$@"
