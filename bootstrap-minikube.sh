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
KEDA_VERSION="2.18.3"
KEDA_NAMESPACE="keda"
CNPG_CHART_VERSION="0.27.1"
CNPG_NAMESPACE="cnpg-system"
# CPUs go straight through to `minikube start --cpus`. Set to the host's
# physical core count (override per-machine via env MINIKUBE_CPUS).
DEFAULT_MINIKUBE_CPUS=12
# Memory acts as an UPPER CAP: resolve_minikube_memory_mb() picks
# min(host_total_mb - reserve, DEFAULT_MINIKUBE_MEMORY_MB). Setting the
# cap higher than any reasonable dev host means the script always allocates
# (host_total - MINIKUBE_MEMORY_RESERVE_MB) — i.e. "take everything except
# the reserve". Override per-machine via env MINIKUBE_MEMORY_MB.
DEFAULT_MINIKUBE_MEMORY_MB=65536
MINIKUBE_MEMORY_RESERVE_MB=1024
MINIKUBE_DISK_SIZE="80g"
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
  local minikube_disk_size="${MINIKUBE_DISK_SIZE:-80g}" 
  if minikube status -p "$PROFILE" &>/dev/null; then
    log "Minikube profile '$PROFILE' already running"
  else
    log "Starting minikube profile '$PROFILE' " \
      "(cpus=${minikube_cpus}, memory=${minikube_memory_mb}MB)"
    minikube start \
      -p "$PROFILE" \
      --cpus="$minikube_cpus" \
      --memory="$minikube_memory_mb" \
      --disk-size="$minikube_disk_size" \
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
  # Helm runs without `--wait`: CRDs land synchronously while the operator
  # pods come up in the background. wait_for_operators_ready() rolls up the
  # readiness check in parallel with cnpg later in the pipeline.
  retry 3 5 helm upgrade --install keda kedacore/keda \
    --namespace "$KEDA_NAMESPACE" \
    --create-namespace \
    --version "$KEDA_VERSION" \
    --set prometheus.metricServer.enabled=true \
    --set prometheus.operator.enabled=true \
    --timeout 180s
}

install_cloudnative_pg() {
  # CloudNativePG owns postgresql.cnpg.io resources used by the shared
  # Postgres clusters in infrastructure/base/postgres. Install it before
  # applying infrastructure so kubectl can recognize Cluster and Pooler CRDs.
  if kubectl get crd clusters.postgresql.cnpg.io &>/dev/null \
    && kubectl get crd poolers.postgresql.cnpg.io &>/dev/null \
    && kubectl get deployment/cnpg-controller-manager --namespace "$CNPG_NAMESPACE" &>/dev/null; then
    log "CloudNativePG CRDs + operator already installed — skipping"
    return
  fi

  log "Adding CloudNativePG Helm repo"
  helm repo add cnpg https://cloudnative-pg.github.io/charts &>/dev/null || true
  retry 3 3 helm repo update cnpg

  log "Installing CloudNativePG chart ${CNPG_CHART_VERSION} into '${CNPG_NAMESPACE}' namespace"
  # See note in install_keda — CRDs apply synchronously, the operator pod
  # readiness wait is folded into wait_for_operators_ready() so it runs in
  # parallel with KEDA instead of stacking 180s + 180s.
  retry 3 5 helm upgrade --install cnpg cnpg/cloudnative-pg \
    --namespace "$CNPG_NAMESPACE" \
    --create-namespace \
    --version "$CNPG_CHART_VERSION" \
    --timeout 180s
}

# Folds the readiness checks for KEDA + CNPG operators into a single
# parallel wait. Both helm installs apply CRDs synchronously, so by the
# time we reach apply_infrastructure() the cluster already accepts the
# resources — we just need the operators reconciling them. Waiting in
# parallel saves ~180s vs the previous serial 2 x `kubectl wait`.
wait_for_operators_ready() {
  log "Waiting for operators (KEDA + CNPG) in parallel..."
  local pids=()

  kubectl wait deployment --all \
    --namespace "$KEDA_NAMESPACE" \
    --for=condition=Available \
    --timeout=180s &
  pids+=($!)

  kubectl wait deployment --all \
    --namespace "$CNPG_NAMESPACE" \
    --for=condition=Available \
    --timeout=180s &
  pids+=($!)

  local exit_code=0
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      exit_code=1
    fi
  done
  if (( exit_code != 0 )); then
    err "One or more operator deployments did not become Available within 180s."
    return 1
  fi
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

# Detects an active `minikube tunnel` background process for $PROFILE.
# The LoadBalancer EXTERNAL-IP is only handed out by the tunnel; without
# it, kourier stays <pending> indefinitely. Probing once is O(1) and
# avoids the 90s burn the previous code spent waiting on a state that
# would never converge.
is_minikube_tunnel_running() {
  pgrep -af 'minikube[^\n]*tunnel' 2>/dev/null \
    | grep -qE "(-p[= ]|--profile[= ])${PROFILE}\b|tunnel\s*$" \
    || return 1
}

configure_dns() {
  local ingress_ip
  ingress_ip="$(get_kourier_external_ip)"

  if [[ -n "$ingress_ip" && "$ingress_ip" != "<pending>" ]]; then
    log "Kourier EXTERNAL-IP already present: ${ingress_ip}"
  elif is_minikube_tunnel_running; then
    log "minikube tunnel detected — waiting up to ${KOURIER_EXTERNAL_IP_WAIT_SECONDS}s for Kourier EXTERNAL-IP"
    if ! ingress_ip="$(wait_for_kourier_external_ip)" || [[ -z "$ingress_ip" ]]; then
      ingress_ip=""
    fi
  else
    log "minikube tunnel not running — skipping LB IP wait (saves up to ${KOURIER_EXTERNAL_IP_WAIT_SECONDS}s)"
    ingress_ip=""
  fi

  if [[ -z "$ingress_ip" ]]; then
    ingress_ip="$(minikube ip -p "$PROFILE")"
    warn "Falling back to the Minikube node IP (${ingress_ip})."
    warn "If you later run 'sudo minikube tunnel -p ${PROFILE}' in another terminal, re-sync via:"
    warn "    ./bootstrap-minikube.sh ${ENVIRONMENTS[0]:-dev} refresh-dns"
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

    log "Waiting for Redis StatefulSet in ${ns}..."
    kubectl rollout status statefulset/redis \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for Redis Cluster init Job in ${ns}..."
    kubectl wait --for=condition=complete job/redis-cluster-init \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for PostgreSQL in ${ns}..."
    kubectl rollout status statefulset/postgres \
      --namespace "$ns" \
      --timeout=180s

    # All four CNPG Cluster CRs land via the single `kubectl apply -k`
    # above. Their Ready conditions are independent (separate primaries
    # + initdb jobs), so we wait in parallel — saves ~one Postgres
    # bootstrap window vs sequential 300s × N.
    #
    # `postgres-temporal-visibility` was added in the 2026-05-22
    # post-mortem remediation (DOCS/RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md)
    # to isolate visibility writes from the `executions` hot path.
    log "Waiting for CloudNativePG clusters in ${ns} (parallel)..."
    local cnpg_pids=()
    for cnpg_cluster in \
      postgres-shared \
      postgres-usage-shared \
      postgres-temporal \
      postgres-temporal-visibility
    do
      kubectl wait cluster.postgresql.cnpg.io/"$cnpg_cluster" \
        --namespace "$ns" \
        --for=condition=Ready \
        --timeout=300s &
      cnpg_pids+=($!)
    done

    local cnpg_exit=0
    for pid in "${cnpg_pids[@]}"; do
      if ! wait "$pid"; then
        cnpg_exit=1
      fi
    done
    if (( cnpg_exit != 0 )); then
      err "At least one CNPG Cluster did not reach Ready within 300s."
      return 1
    fi

    # Post-HA-migration (DOCS/RUNBOOK-TEMPORAL-HA-MIGRATION.md) the
    # schema bootstrap moved out of the `auto-setup` boot loop into a
    # dedicated Job named `temporal-schema-setup-<version>` defined by
    # `infrastructure/base/temporal/job-schema-setup.yaml`. Every role
    # Deployment (frontend, history, matching, worker) has an
    # initContainer that `kubectl wait`s on the same Job, but we wait
    # here too so a Job failure surfaces in the bootstrap log instead
    # of as pod-init timeouts. The legacy
    # `ensure-temporal-visibility-schema.sh` workaround for
    # `auto-setup` ignoring `VISIBILITY_POSTGRES_SEEDS` (§10.1) is
    # gone — the Job targets both clusters explicitly.
    log "Waiting for temporal schema bootstrap Job in ${ns}..."
    kubectl wait --namespace "$ns" \
      --for=condition=complete \
      job/temporal-schema-setup-1-28-4 \
      --timeout=300s

    # Roll all 4 role Deployments in parallel. The slowest one
    # (history — needs to claim 16 shards over SQL) gates the wall-
    # clock; rolling sequentially would stack 4×180s.
    log "Waiting for Temporal role Deployments in ${ns} (parallel)..."
    local temporal_pids=()
    local temporal_roles=(frontend history matching worker)
    for role in "${temporal_roles[@]}"; do
      kubectl rollout status "deployment/temporal-${role}" \
        --namespace "$ns" \
        --timeout=300s &
      temporal_pids+=($!)
    done

    local temporal_exit=0
    for idx in "${!temporal_pids[@]}"; do
      if ! wait "${temporal_pids[$idx]}"; then
        warn "Rollout did not converge: deployment/temporal-${temporal_roles[$idx]}"
        temporal_exit=1
      fi
    done
    if (( temporal_exit != 0 )); then
      err "One or more Temporal role Deployments did not become Available within 300s."
      return 1
    fi

    # Restores the 'default' Temporal namespace that `auto-setup` used
    # to register on every boot but `temporalio/server` does not. SDK
    # clients (workflow-worker, connector-runtime) crash on first
    # boot otherwise with `Namespace default is not found.`. The Job
    # waits internally for the frontend to be SERVING; we add the
    # outer kubectl wait so failures surface in the bootstrap log
    # instead of as later SDK errors.
    log "Waiting for temporal namespace bootstrap Job in ${ns}..."
    kubectl wait --namespace "$ns" \
      --for=condition=complete \
      job/temporal-namespace-bootstrap-1-28-4 \
      --timeout=420s

    # Force a balanced history shard ring. Temporal's ringpop only
    # rebalances shards on host LEAVE, not on host JOIN — so the
    # first pod to register in `cluster_membership` claims all 16
    # shards, and the second pod stays idle until something forces
    # a churn event. A rolling-restart of history triggers exactly
    # that: each pod leaves once, the survivor takes all shards, and
    # on rejoin the new pod acquires its hash-assigned half via
    # consistent hashing (now that the survivor is the sole writer
    # under low post-restart load, the rejoining pod wins its CAS
    # races). Without this step the 2026-05-23 stress run saw 16/0
    # skew and 57k workflows TimedOut — see
    # `DOCS/RUNBOOK-TEMPORAL-HA-MIGRATION.md` §5.1.
    log "Rebalancing temporal history shards in ${ns}..."
    kubectl rollout restart deployment/temporal-history --namespace "$ns"
    kubectl rollout status deployment/temporal-history \
      --namespace "$ns" --timeout=300s

    # Temporal UI + the observability stack (otel-collector, tempo,
    # prometheus, loki, grafana) have no inter-dependency at the
    # Deployment-Available level — `kubectl rollout status` only checks
    # replica readiness, not functional liveness against Temporal. Fire
    # all six in parallel so the wall-clock cost is the slowest single
    # rollout instead of the sum.
    log "Waiting for Temporal UI + observability stack in ${ns} (parallel)..."
    local obs_pids=()
    local obs_names=(temporal-ui otel-collector tempo prometheus loki grafana)
    for dep in "${obs_names[@]}"; do
      kubectl rollout status "deployment/$dep" \
        --namespace "$ns" \
        --timeout=120s &
      obs_pids+=($!)
    done

    local obs_exit=0
    for idx in "${!obs_pids[@]}"; do
      if ! wait "${obs_pids[$idx]}"; then
        warn "Rollout did not converge: deployment/${obs_names[$idx]}"
        obs_exit=1
      fi
    done
    if (( obs_exit != 0 )); then
      err "One or more observability deployments failed to become Available within 120s."
      return 1
    fi
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
    eval "$(minikube docker-env -p "$PROFILE" --shell=bash)"
  else
    eval "$(minikube docker-env -p "$PROFILE")"
  fi

  local services=(api-gateway auth-service cache-service \
             audit-service tenant-service \
             registry-service connector-admin \
             channel-service workflow-service connector-runtime \
             proxy-service yoizenclaw-admin-service yoizenclaw-runtime-gateway admin-console \
             usage-aggregator-service yoizenclaw-runtime)

  # BUILD_PARALLELISM controls how many `docker build` invocations run
  # concurrently. Default of 2 is the sweet spot on a 12-core dev box:
  # docker daemon serializes overlay2 layer commits (one I/O hot spot),
  # so going above ~3 yields diminishing returns and risks OOM during
  # node_modules-heavy NestJS builds. Raise via env on beefier hosts.
  local parallelism="${BUILD_PARALLELISM:-2}"
  if ! [[ "$parallelism" =~ ^[0-9]+$ ]] || (( parallelism < 1 )); then
    warn "Invalid BUILD_PARALLELISM='${parallelism}' — falling back to 2"
    parallelism=2
  fi

  local total=${#services[@]}
  log "Building ${total} images with parallelism=${parallelism}"

  # Per-build logs get their own file so concurrent stdout/stderr from
  # different `docker build` runs never interleave. On failure we tail
  # the offending log so the user sees the error without `cd`-ing.
  local log_dir
  log_dir="$(mktemp -d -t bootstrap-builds-XXXXXX)"
  log "Per-build logs in: ${log_dir}"

  local pids=()
  local names=()
  local logs=()
  local started=()
  local failures=()
  local completed=0

  # Inline helper: waits on every pid currently pending, classifies
  # success vs failure, and resets the slot arrays. We define it inside
  # build_images so it shares the local arrays without polluting the
  # global function namespace.
  _flush_build_batch() {
    local idx pid svc logf t0 elapsed
    for idx in "${!pids[@]}"; do
      pid="${pids[$idx]}"
      svc="${names[$idx]}"
      logf="${logs[$idx]}"
      t0="${started[$idx]}"
      if wait "$pid"; then
        elapsed=$(( $(date +%s) - t0 ))
        completed=$(( completed + 1 ))
        log "[${completed}/${total}] OK  dev.local/${svc}:local (${elapsed}s)"
      else
        completed=$(( completed + 1 ))
        warn "[${completed}/${total}] FAIL dev.local/${svc}:local — log: ${logf}"
        failures+=("$svc")
      fi
    done
    pids=()
    names=()
    logs=()
    started=()
  }

  local i svc logf
  for (( i = 0; i < total; i++ )); do
    svc="${services[$i]}"
    logf="${log_dir}/${svc}.log"

    log "→ start build dev.local/${svc}:local"
    docker build \
      -t "dev.local/${svc}:local" \
      -f "${script_dir}/services/${svc}/Dockerfile" \
      "${script_dir}" >"$logf" 2>&1 &
    pids+=($!)
    names+=("$svc")
    logs+=("$logf")
    started+=("$(date +%s)")

    if (( ${#pids[@]} >= parallelism )); then
      _flush_build_batch
    fi
  done

  _flush_build_batch
  unset -f _flush_build_batch

  if (( ${#failures[@]} > 0 )); then
    err "${#failures[@]} build(s) failed: ${failures[*]}"
    err "Last 20 lines of each failed log:"
    local f
    for svc in "${failures[@]}"; do
      f="${log_dir}/${svc}.log"
      err "----- ${svc} (${f}) -----"
      tail -n 20 "$f" >&2 || true
    done
    return 1
  fi

  log "All ${total} images built successfully"
}

# ---------------------------------------------------------------------------
# Cluster & dependency verification (used by platform-services standalone)
# ---------------------------------------------------------------------------

verify_cluster() {
  if ! minikube status -p "$PROFILE" &>/dev/null; then
    err "Minikube profile '$PROFILE' is not running."
    err "Run './bootstrap-minikube.sh <env> support-services' first."
    exit 1
  fi
  kubectl config use-context "$PROFILE" &>/dev/null
  log "Cluster is reachable (profile: $PROFILE)"
}

verify_support_services() {
  local core_deployments=(otel-collector tempo prometheus loki grafana)
  local core_statefulsets=(nats postgres redis)

  if ! kubectl get crd scaledobjects.keda.sh &>/dev/null; then
    err "KEDA CRDs not found in cluster."
    err "The platform services require KEDA — run './bootstrap-minikube.sh <env> support-services' first."
    exit 1
  fi

  if ! kubectl get crd clusters.postgresql.cnpg.io &>/dev/null \
    || ! kubectl get crd poolers.postgresql.cnpg.io &>/dev/null; then
    err "CloudNativePG CRDs not found in cluster."
    err "Run './bootstrap-minikube.sh <env> support-services' before platform-services."
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

    for cnpg_cluster in \
      postgres-shared \
      postgres-usage-shared \
      postgres-temporal \
      postgres-temporal-visibility
    do
      if ! kubectl get cluster.postgresql.cnpg.io "$cnpg_cluster" --namespace "$ns" &>/dev/null; then
        warn "CloudNativePG Cluster '${cnpg_cluster}' not found in ${ns}"
      fi
    done

    # Post-HA-migration: 4 role Deployments replace the single
    # `temporal` Deployment. Check all 4 + the UI.
    local temporal_deploys=(
      temporal-frontend
      temporal-history
      temporal-matching
      temporal-worker
      temporal-ui
    )
    for dep in "${temporal_deploys[@]}"; do
      if ! kubectl get deployment/"$dep" --namespace "$ns" &>/dev/null; then
        warn "Deployment '${dep}' not found in ${ns}"
      fi
    done
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
  install_cloudnative_pg
  # Both helm installs above run without `--wait`. Their CRDs are
  # available synchronously; the operator pods reconcile in the
  # background. We fold the readiness wait here, in parallel for
  # both operators, before any infra manifest references their CRs.
  wait_for_operators_ready
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
