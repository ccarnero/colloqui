#!/usr/bin/env bash
set -euo pipefail

PROFILE="yoizen-arch"
ALL_ENVIRONMENTS=(dev qa staging production)
ALL_GROUPS=(support-services platform-services refresh-dns)
KOURIER_EXTERNAL_IP_WAIT_SECONDS="${KOURIER_EXTERNAL_IP_WAIT_SECONDS:-90}"
ENVIRONMENTS=()
SERVICE_GROUP=""
KNATIVE_VERSION="v1.17.0"
KOURIER_VERSION="v1.17.0"
KEDA_VERSION="2.16.1"
KEDA_NAMESPACE="keda"
DEFAULT_MINIKUBE_CPUS=6
DEFAULT_MINIKUBE_MEMORY_MB=16384
MINIKUBE_MEMORY_RESERVE_MB=1024

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

get_docker_memory_mb() {
  local mem_total_bytes

  mem_total_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
  if [[ ! "$mem_total_bytes" =~ ^[0-9]+$ ]]; then
    echo ""
    return
  fi

  echo "$(( mem_total_bytes / 1024 / 1024 ))"
}

resolve_minikube_memory_mb() {
  local docker_memory_mb
  local requested_memory_mb

  docker_memory_mb="$(get_docker_memory_mb)"
  if [[ ! "$docker_memory_mb" =~ ^[0-9]+$ ]]; then
    echo "$DEFAULT_MINIKUBE_MEMORY_MB"
    return
  fi

  requested_memory_mb=$DEFAULT_MINIKUBE_MEMORY_MB
  if (( docker_memory_mb > MINIKUBE_MEMORY_RESERVE_MB )); then
    requested_memory_mb=$(( docker_memory_mb - MINIKUBE_MEMORY_RESERVE_MB ))
    if (( requested_memory_mb > DEFAULT_MINIKUBE_MEMORY_MB )); then
      requested_memory_mb=$DEFAULT_MINIKUBE_MEMORY_MB
    fi
  fi

  echo "$requested_memory_mb"
}

usage() {
  cat <<EOF
Usage: $0 [OPTIONS] [ENV|GROUP]...

Environments: ${ALL_ENVIRONMENTS[*]}
  (defaults to all if omitted)

Groups: ${ALL_GROUPS[*]}
  (defaults to both if omitted)

Options:
  -h, --help    Show this help message

Environment variables:
  MINIKUBE_CPUS                         Override the Minikube CPU count
  MINIKUBE_MEMORY_MB                    Override the Minikube memory limit in MB
  KOURIER_EXTERNAL_IP_WAIT_SECONDS      Seconds to wait for Kourier LB IP (default: 90)

Examples:
  $0 support-services           # Infra only for all environments
  $0 dev support-services       # Cluster init + infrastructure only
  $0 support-services dev       # Same as above (order does not matter)
  $0 platform-services dev qa   # Build + deploy for dev and qa
  $0 dev                        # Full bootstrap (both groups)
  $0 dev refresh-dns            # Re-sync config-domain with Kourier EXTERNAL-IP
                                # (use after starting/stopping minikube tunnel)
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

  for arg in "${positional[@]+"${positional[@]}"}"; do
    local is_group=0
    for g in "${ALL_GROUPS[@]}"; do
      [[ "$arg" == "$g" ]] && is_group=1 && break
    done

    if (( is_group )); then
      if [[ -n "$SERVICE_GROUP" ]]; then
        err "Only one group can be selected."
        echo "Valid groups: ${ALL_GROUPS[*]}"
        exit 1
      fi
      SERVICE_GROUP="$arg"
      continue
    fi

    local valid_env=0
    for e in "${ALL_ENVIRONMENTS[@]}"; do
      [[ "$arg" == "$e" ]] && valid_env=1 && break
    done
    if (( valid_env )); then
      ENVIRONMENTS+=("$arg")
    else
      err "Invalid environment or group: $arg"
      echo "Valid environments: ${ALL_ENVIRONMENTS[*]}"
      echo "Valid groups: ${ALL_GROUPS[*]}"
      exit 1
    fi
  done

  if (( ${#ENVIRONMENTS[@]} == 0 )); then
    ENVIRONMENTS=("${ALL_ENVIRONMENTS[@]}")
  fi
}

check_deps() {
  local missing=()
  for cmd in minikube kubectl docker helm; do
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
  local minikube_cpus="${MINIKUBE_CPUS:-$DEFAULT_MINIKUBE_CPUS}"
  local minikube_memory_mb="${MINIKUBE_MEMORY_MB:-$(resolve_minikube_memory_mb)}"

  if minikube status -p "$PROFILE" &>/dev/null; then
    log "Minikube profile '$PROFILE' already running"
  else
    log "Starting minikube profile '$PROFILE' " \
      "(cpus=${minikube_cpus}, memory=${minikube_memory_mb}MB)"
    minikube start \
      -p "$PROFILE" \
      --cpus="$minikube_cpus" \
      --memory="$minikube_memory_mb" \
      --driver=docker \
      --kubernetes-version=stable
  fi

  log "Setting kubectl context to profile '$PROFILE'"
  kubectl config use-context "$PROFILE"

  log "Enabling addons: metrics-server"
  minikube addons enable metrics-server -p "$PROFILE"
}

install_knative_serving() {
  if kubectl get crd services.serving.knative.dev &>/dev/null \
    && kubectl get deployment/autoscaler-hpa --namespace knative-serving &>/dev/null; then
    log "Knative Serving CRDs + HPA autoscaler already installed — skipping"
    return
  fi

  if ! kubectl get crd services.serving.knative.dev &>/dev/null; then
    log "Installing Knative Serving CRDs (${KNATIVE_VERSION})"
    kubectl apply -f "https://github.com/knative/serving/releases/download/knative-${KNATIVE_VERSION}/serving-crds.yaml"

    log "Installing Knative Serving core (${KNATIVE_VERSION})"
    # The serving-core install can briefly race the webhook startup on fresh or
    # partially initialized clusters, so retry the full apply until the webhook
    # is ready to accept ConfigMap updates.
    retry 10 5 kubectl apply -f "https://github.com/knative/serving/releases/download/knative-${KNATIVE_VERSION}/serving-core.yaml"
  fi

  if ! kubectl get deployment/autoscaler-hpa --namespace knative-serving &>/dev/null; then
    # serving-hpa ships the `autoscaler-hpa` controller that reconciles
    # PodAutoscaler objects created by Knative Services annotated with
    # `autoscaling.knative.dev/class: hpa.autoscaling.knative.dev` into
    # native HPAs. Without it those Revisions stay stuck in Deploying,
    # which in turn prevents KEDA from transferring HPA ownership via
    # `scaledobject.keda.sh/transfer-hpa-ownership`.
    log "Installing Knative Serving HPA autoscaler (${KNATIVE_VERSION})"
    retry 10 5 kubectl apply -f "https://github.com/knative/serving/releases/download/knative-${KNATIVE_VERSION}/serving-hpa.yaml"
  fi

  log "Waiting for Knative Serving deployments..."
  kubectl wait deployment --all \
    --namespace knative-serving \
    --for=condition=Available \
    --timeout=300s
}

install_kourier() {
  if kubectl get deployment/net-kourier-controller --namespace kourier-system &>/dev/null; then
    log "Kourier already installed — skipping"
    return
  fi

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

install_keda() {
  # KEDA is a cluster-wide dependency (CRDs + operator) shared by every
  # environment. We install it once via the official Helm chart; running
  # this after an existing install is a no-op thanks to the CRD guard.
  # Chart docs: infrastructure/base/keda/README.md
  if kubectl get crd scaledobjects.keda.sh &>/dev/null; then
    log "KEDA CRDs already installed — skipping"
    return
  fi

  log "Adding kedacore Helm repo"
  helm repo add kedacore https://kedacore.github.io/charts &>/dev/null || true
  retry 3 3 helm repo update kedacore

  log "Installing KEDA ${KEDA_VERSION} into '${KEDA_NAMESPACE}' namespace"
  retry 3 5 helm upgrade --install keda kedacore/keda \
    --namespace "$KEDA_NAMESPACE" \
    --create-namespace \
    --version "$KEDA_VERSION" \
    --set prometheus.metricServer.enabled=true \
    --set prometheus.operator.enabled=true \
    --wait \
    --timeout 180s

  log "Waiting for KEDA deployments..."
  kubectl wait deployment --all \
    --namespace "$KEDA_NAMESPACE" \
    --for=condition=Available \
    --timeout=180s
}

get_kourier_external_ip() {
  kubectl get svc kourier \
    --namespace kourier-system \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true
}

# Waits up to KOURIER_EXTERNAL_IP_WAIT_SECONDS for svc/kourier to be assigned
# an EXTERNAL-IP by the LoadBalancer controller (usually `minikube tunnel` on
# Docker-driver). Prints the IP on stdout if obtained. Exits with non-zero
# status and prints "" otherwise — callers decide whether to bail out or
# fall back.
wait_for_kourier_external_ip() {
  local deadline elapsed kourier_ip
  deadline=$KOURIER_EXTERNAL_IP_WAIT_SECONDS
  elapsed=0

  while (( elapsed < deadline )); do
    kourier_ip="$(get_kourier_external_ip)"
    if [[ -n "$kourier_ip" && "$kourier_ip" != "<pending>" ]]; then
      printf '%s\n' "$kourier_ip"
      return 0
    fi
    sleep 2
    (( elapsed += 2 ))
  done

  printf '%s\n' ""
  return 1
}

# Returns the current sslip.io domain configured in Knative's config-domain
# ConfigMap (i.e. the key ending in `.sslip.io`, excluding the `_example`
# comment). Empty string if none.
get_current_sslip_domain() {
  kubectl get configmap config-domain -n knative-serving \
    -o go-template='{{range $k, $v := .data}}{{if ne $k "_example"}}{{$k}}{{"\n"}}{{end}}{{end}}' \
    2>/dev/null | grep -E '\.sslip\.io$' | head -n1
}

# Re-patches config-domain so Knative Routes advertise the given ingress IP.
# Removes the previous sslip.io key so `config-domain` never has two
# conflicting entries at the same time.
patch_config_domain_to() {
  local ingress_ip=$1
  local previous_domain
  previous_domain="$(get_current_sslip_domain || true)"

  local patch="{\"data\":{\"${ingress_ip}.sslip.io\":\"\""
  if [[ -n "$previous_domain" && "$previous_domain" != "${ingress_ip}.sslip.io" ]]; then
    patch+=",\"${previous_domain}\":null"
  fi
  patch+="}}"

  log "Patching config-domain -> ${ingress_ip}.sslip.io"
  retry 5 3 kubectl patch configmap/config-domain \
    --namespace knative-serving \
    --type merge \
    --patch "$patch"
}

# Waits until at least one Knative Service in the given namespace advertises
# `status.url` under the expected sslip.io domain. This protects the summary
# output from printing stale URLs right after reconfiguring config-domain.
wait_for_ksvc_url_reconcile() {
  local namespace=$1 expected_domain=$2 timeout_s=${3:-60}
  local elapsed=0

  local ksvc
  ksvc="$(kubectl get ksvc -n "$namespace" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "$ksvc" ]]; then
    return 0
  fi

  while (( elapsed < timeout_s )); do
    local url
    url="$(kubectl get ksvc "$ksvc" -n "$namespace" \
      -o jsonpath='{.status.url}' 2>/dev/null || true)"
    if [[ "$url" == *"${expected_domain}"* ]]; then
      return 0
    fi
    sleep 2
    (( elapsed += 2 ))
  done

  warn "Timed out waiting for ksvc URLs in ${namespace} to use ${expected_domain}."
  warn "Current: $(kubectl get ksvc "$ksvc" -n "$namespace" -o jsonpath='{.status.url}' 2>/dev/null || true)"
  return 1
}

configure_dns() {
  log "Waiting for svc/kourier to obtain an EXTERNAL-IP (up to ${KOURIER_EXTERNAL_IP_WAIT_SECONDS}s)"
  local ingress_ip
  if ingress_ip="$(wait_for_kourier_external_ip)" && [[ -n "$ingress_ip" ]]; then
    log "Kourier EXTERNAL-IP acquired: ${ingress_ip}"
  else
    ingress_ip="$(minikube ip -p "$PROFILE")"
    warn "Kourier LoadBalancer IP did not become available in time."
    warn "Falling back to the Minikube node IP (${ingress_ip})."
    warn "This is only useful if you later run 'minikube tunnel -p ${PROFILE}' AND re-run:"
    warn "    ./bootstrap-minikube.sh ${ENVIRONMENTS[0]:-dev} refresh-dns"
    warn "so that config-domain and the Knative Routes get re-synced."
  fi

  patch_config_domain_to "$ingress_ip"
}

# Standalone runner: re-patches config-domain using the current Kourier
# EXTERNAL-IP and waits for Knative Routes to reconcile. Safe to call any
# time `minikube tunnel` comes up/down or Kourier gets a new LB IP.
run_refresh_dns() {
  log "===== refresh-dns (re-sync Knative config-domain with Kourier LB) ====="
  echo ""
  verify_cluster

  if ! kubectl get namespace kourier-system &>/dev/null; then
    err "Namespace 'kourier-system' not found. Run support-services first."
    exit 1
  fi

  local ingress_ip
  if ! ingress_ip="$(wait_for_kourier_external_ip)" || [[ -z "$ingress_ip" ]]; then
    err "Kourier EXTERNAL-IP is still <pending> after ${KOURIER_EXTERNAL_IP_WAIT_SECONDS}s."
    err "Start 'sudo minikube tunnel -p ${PROFILE}' in another terminal and retry."
    exit 1
  fi

  local previous_domain
  previous_domain="$(get_current_sslip_domain || true)"
  log "Kourier EXTERNAL-IP: ${ingress_ip}"
  log "Previous domain:     ${previous_domain:-<none>}"
  log "Target domain:       ${ingress_ip}.sslip.io"

  if [[ "$previous_domain" == "${ingress_ip}.sslip.io" ]]; then
    log "config-domain is already up to date — nothing to do"
    return
  fi

  patch_config_domain_to "$ingress_ip"

  for env in "${ENVIRONMENTS[@]}"; do
    local ns="platform-services-${env}"
    if ! kubectl get namespace "$ns" &>/dev/null; then
      continue
    fi
    log "Waiting for ksvc URLs in ${ns} to reconcile..."
    wait_for_ksvc_url_reconcile "$ns" "${ingress_ip}.sslip.io" 60 || true
  done
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
  # For Windows, we need to handle docker-env differently
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows - export variables manually
    eval $(minikube docker-env -p "$PROFILE" --shell=bash)
  else
    eval "$(minikube docker-env -p "$PROFILE")"
  fi

  for svc in api-gateway auth-service event-processor cache-service \
             audit-service webhook-service metrics-service tenant-service \
             scheduler-service registry-service adapter-service \
             channel-service workflow-service workflow-http-worker \
             proxy-service yoizenclaw-admin-service admin-console \
             messaging-console; do
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

  if ! kubectl get crd scaledobjects.keda.sh &>/dev/null; then
    err "KEDA CRDs not found in cluster."
    err "The platform services require KEDA — run './bootstrap.sh <env> support-services' first."
    exit 1
  fi

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
  install_keda
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
  local minikube_ip ingress_ip kourier_ip current_domain
  minikube_ip="$(minikube ip -p "$PROFILE")"
  kourier_ip="$(get_kourier_external_ip)"
  current_domain="$(get_current_sslip_domain || true)"
  if [[ -n "$kourier_ip" && "$kourier_ip" != "<pending>" ]]; then
    ingress_ip="$kourier_ip"
  else
    ingress_ip="$minikube_ip"
  fi
  local group_label="${SERVICE_GROUP:-all}"

  echo ""
  log "=============================="
  log " Setup complete! [${group_label}]"
  log "=============================="
  echo ""
  echo "  Minikube IP:       ${minikube_ip}"
  echo "  Kourier LB IP:     ${kourier_ip:-<pending>}"
  echo "  Ingress IP in use: ${ingress_ip}"
  echo "  DNS domain (cfg):  ${current_domain:-${ingress_ip}.sslip.io}"
  echo "  Environments:      ${ENVIRONMENTS[*]}"
  echo "  Group:             ${group_label}"
  echo ""

  if [[ -n "$kourier_ip" && -n "$current_domain" && "$current_domain" != "${kourier_ip}.sslip.io" ]]; then
    warn "config-domain (${current_domain}) does not match Kourier EXTERNAL-IP (${kourier_ip})."
    warn "Run './bootstrap-minikube.sh ${ENVIRONMENTS[0]:-dev} refresh-dns' to re-sync."
    echo ""
  fi

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
    echo "    kubectl get storageclass"
    echo "    minikube tunnel -p ${PROFILE}"
    echo ""
    echo "  API Gateway (dev): http://api-gateway.platform-services-dev.${ingress_ip}.sslip.io"
    echo ""
    echo "  Port-forwarding (run in a separate terminal):"
    echo "    ./port-forward.sh ${ENVIRONMENTS[0]}"
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
    refresh-dns)
      run_refresh_dns
      print_summary
      return
      ;;
    "")
      run_support_services
      run_platform_services
      ;;
  esac

  print_summary
}

main "$@"
