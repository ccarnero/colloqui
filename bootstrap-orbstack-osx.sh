#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# bootstrap-orbstack-osx.sh — complete OrbStack bootstrap for macOS
# =============================================================================
#
# Self-contained bootstrap verified to bring up a FUNCTIONAL cluster on
# OrbStack Kubernetes (macOS). It does not modify any other script or service.
# This is the canonical (and only) bootstrap entry point for the repo.
#
# OrbStack specifics handled here (vs. minikube):
#   - Uses the shared OrbStack Docker daemon: `docker build` produces images the
#     cluster can use directly — no `minikube docker-env`.
#   - kubectl context is `orbstack` (checked / switched automatically).
#   - metrics-server is installed + patched with --kubelet-insecure-tls (OrbStack
#     kubelet serves a self-signed cert).
#   - DNS is the static dev.local domain: OrbStack binds LoadBalancer Services
#     to localhost, so no `minikube tunnel` / refresh-dns dance is needed.
#
# Prerequisites:
#   - OrbStack installed with Kubernetes enabled (Settings > Kubernetes > Enable).
#   - docker, kubectl, helm, npm on PATH.
#
# Usage:
#   ./bootstrap-orbstack-osx.sh                     # full dev bring-up (support + platform)
#   ./bootstrap-orbstack-osx.sh support-services    # infra only
#   ./bootstrap-orbstack-osx.sh platform-services   # build + deploy only
#   STORAGE_ENGINE=mongo ./bootstrap-orbstack-osx.sh support-services
# =============================================================================

ALL_GROUPS=(support-services platform-services)
ENVIRONMENTS=(dev)
SERVICE_GROUP=""
STORAGE_ENGINE="${STORAGE_ENGINE:-postgres}"
RUN_SMOKE=false
KNATIVE_VERSION="v1.17.0"
KOURIER_VERSION="v1.17.0"
CNPG_CHART_VERSION="0.27.1"
CNPG_NAMESPACE="cnpg-system"
METRICS_SERVER_VERSION="v0.7.2"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

# Resolve sibling helper that renders kustomize overlays without tripping the
# bundled-kustomize `$patch: delete` panic (kustomize#5552). See the helper's
# header and apply_kustomize() below.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAFE_APPLY="${SELF_DIR}/kustomize-safe-apply.sh"

# apply_kustomize <overlay-dir> [extra kubectl args...]
# Routes infrastructure applies through kustomize-safe-apply.sh when present so
# the multi-`$patch: delete` exclude-mongo / exclude-oltp-postgres patches don't
# crash older kustomize builds bundled inside kubectl. Falls back to a plain
# `kubectl apply -k` (which works fine once kubectl ships kustomize >= 5.7.0).
apply_kustomize() {
  local path="$1"; shift || true
  if [[ -x "$SAFE_APPLY" ]]; then
    "$SAFE_APPLY" "$path" "$@"
  elif [[ -f "$SAFE_APPLY" ]]; then
    bash "$SAFE_APPLY" "$path" "$@"
  else
    warn "kustomize-safe-apply.sh not found — using plain 'kubectl apply -k'"
    warn "If kubectl's bundled kustomize is < 5.7.0 this may SIGSEGV on \$patch:delete (kustomize#5552)."
    kubectl apply -k "$path" "$@"
  fi
}

usage() {
  cat <<EOF
Usage: $0 [OPTIONS] [GROUP]

Groups: ${ALL_GROUPS[*]}
  (defaults to both if omitted — always targets the dev environment)

Options:
  -h, --help                      Show this help message
  --storage-engine=ENGINE         OLTP storage: postgres (default) or mongo
  --storage-engine ENGINE         Same as --storage-engine=ENGINE
  --smoke                         Run scripts/smoke-test.sh after platform
                                  services are ready (best-effort; failure
                                  warns but does not abort bootstrap)

Environment variables:
  STORAGE_ENGINE                    Same as --storage-engine (postgres|mongo)
  BUILD_PARALLELISM                 Concurrent docker builds (default 2)

Examples:
  $0                            # Full dev bring-up (support + platform)
  $0 --smoke                    # Full bring-up + smoke test
  $0 support-services           # Infra only (dev)
  $0 platform-services          # Build + deploy only (dev)
  $0 --storage-engine=mongo support-services
                                # Mongo OLTP + usage; Temporal stays on Postgres
EOF
}

normalize_storage_engine() {
  case "$1" in
    postgres|mongo) printf '%s' "$1" ;;
    *)
      err "Invalid storage engine: $1 (expected postgres or mongo)"
      exit 1
      ;;
  esac
}

parse_args() {
  SERVICE_GROUP=""
  STORAGE_ENGINE="${STORAGE_ENGINE:-postgres}"
  RUN_SMOKE=false
  local positional=()

  while (( $# > 0 )); do
    local arg=$1
    shift
    case "$arg" in
      -h|--help)
        usage
        exit 0
        ;;
      --smoke)
        RUN_SMOKE=true
        ;;
      --storage-engine=*)
        STORAGE_ENGINE="$(normalize_storage_engine "${arg#*=}")"
        ;;
      --storage-engine)
        if (( $# == 0 )); then
          err "--storage-engine requires a value (postgres or mongo)"
          exit 1
        fi
        STORAGE_ENGINE="$(normalize_storage_engine "$1")"
        shift
        ;;
      -*)
        err "Unknown option: $arg"
        usage
        exit 1
        ;;
      *)
        positional+=("$arg")
        ;;
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

    err "Unknown argument: $arg"
    echo "Valid groups: ${ALL_GROUPS[*]}"
    exit 1
  done
  unset arg
}

is_mongo_storage_engine() {
  [[ "${STORAGE_ENGINE}" == "mongo" ]]
}

print_storage_engine_banner() {
  if ! is_mongo_storage_engine; then
    return 0
  fi
  echo ""
  log "============================================================"
  log " Storage engine: mongo (hybrid with Temporal Postgres)"
  log "============================================================"
  echo ""
}

orbstack_infra_overlay_path() {
  local script_dir=$1 env=$2
  if is_mongo_storage_engine; then
    printf '%s/infrastructure/overlays/orbstack/mongo-%s' "$script_dir" "$env"
  else
    printf '%s/infrastructure/overlays/orbstack/%s' "$script_dir" "$env"
  fi
}

local_knative_overlay_path() {
  local script_dir=$1 env=$2
  local suffix
  if is_mongo_storage_engine; then
    suffix="mongo-${env}"
  else
    suffix="postgres-${env}"
  fi
  if [[ -d "${script_dir}/knative/services/overlays/local/${suffix}" ]]; then
    printf '%s/knative/services/overlays/local/%s' "$script_dir" "$suffix"
  else
    printf '%s/knative/services/overlays/local/%s' "$script_dir" "$env"
  fi
}

storage_engine_for_namespace() {
  local ns=$1
  if kubectl get statefulset/mongo-platform --namespace "$ns" &>/dev/null; then
    echo mongo
  elif kubectl get statefulset/postgres --namespace "$ns" &>/dev/null; then
    echo postgres
  else
    echo "$STORAGE_ENGINE"
  fi
}

check_deps() {
  local missing=()
  for cmd in kubectl docker helm npm; do
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

check_orbstack_context() {
  local current_ctx
  current_ctx="$(kubectl config current-context 2>/dev/null || true)"

  if [[ "$current_ctx" != "orbstack" ]]; then
    warn "Current context is '${current_ctx}', switching to 'orbstack'"
    if ! kubectl config use-context orbstack 2>/dev/null; then
      err "OrbStack Kubernetes context not found."
      err "Enable Kubernetes in OrbStack: Settings > Kubernetes > Enable Kubernetes"
      exit 1
    fi
  fi

  log "Using kubectl context: orbstack"
}

install_metrics_server() {
  if kubectl get apiservice v1beta1.metrics.k8s.io &>/dev/null; then
    log "metrics-server API already installed — skipping"
    return
  fi

  log "Installing metrics-server (${METRICS_SERVER_VERSION})"
  retry 5 5 kubectl apply -f "https://github.com/kubernetes-sigs/metrics-server/releases/download/${METRICS_SERVER_VERSION}/components.yaml"

  local metrics_server_args
  metrics_server_args="$(kubectl get deployment metrics-server \
    --namespace kube-system \
    -o jsonpath='{.spec.template.spec.containers[0].args[*]}' \
    2>/dev/null || true)"

  if [[ "$metrics_server_args" != *"--kubelet-insecure-tls"* ]]; then
    log "Patching metrics-server for local OrbStack kubelet TLS"
    kubectl patch deployment metrics-server \
      --namespace kube-system \
      --type=json \
      --patch='[
        {
          "op": "add",
          "path": "/spec/template/spec/containers/0/args/-",
          "value": "--kubelet-insecure-tls"
        }
      ]'
  fi

  log "Waiting for metrics-server"
  kubectl wait deployment/metrics-server \
    --namespace kube-system \
    --for=condition=Available \
    --timeout=180s

  kubectl wait apiservice/v1beta1.metrics.k8s.io \
    --for=condition=Available \
    --timeout=180s
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
    # native HPAs. Without it those Revisions stay stuck in Deploying.
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
  # CRDs apply synchronously; operator pod readiness is handled by
  # wait_for_operators_ready() after this install returns.
  retry 3 5 helm upgrade --install cnpg cnpg/cloudnative-pg \
    --namespace "$CNPG_NAMESPACE" \
    --create-namespace \
    --version "$CNPG_CHART_VERSION" \
    --timeout 180s
}

wait_for_operators_ready() {
  log "Waiting for CloudNativePG operator..."
  kubectl wait deployment --all \
    --namespace "$CNPG_NAMESPACE" \
    --for=condition=Available \
    --timeout=180s
}

configure_dns() {
  log "Configuring Knative config-domain -> dev.local (static)"
  # Remove any legacy sslip.io key and set the stable dev.local domain.
  local old_domain
  old_domain="$(kubectl get configmap config-domain -n knative-serving \
    -o go-template='{{range $k,$v := .data}}{{if ne $k "_example"}}{{$k}}{{"\n"}}{{end}}{{end}}' \
    2>/dev/null | grep -v '^dev\.local$' | head -n1 || true)"

  local patch='{"data":{"dev.local":""}}'
  if [[ -n "$old_domain" ]]; then
    patch="{\"data\":{\"dev.local\":\"\",\"${old_domain}\":null}}"
    log "Removing legacy domain key: ${old_domain}"
  fi
  retry 5 3 kubectl patch configmap/config-domain \
    --namespace knative-serving \
    --type merge \
    --patch "$patch"
}

ensure_dev_hosts() {
  local hosts_file="/etc/hosts"
  local begin_marker="# yoizen-dev BEGIN"
  local end_marker="# yoizen-dev END"

  local block
  block="$(printf '%s\n127.0.0.1 api-gateway.platform-services-dev.dev.local\n127.0.0.1 admin-console.platform-services-dev.dev.local\n%s' \
    "$begin_marker" "$end_marker")"

  log "Updating /etc/hosts managed block (yoizen-dev)..."

  # Strip existing block then append fresh one — idempotent on re-runs.
  local tmp
  tmp="$(mktemp)"
  if ! sudo bash -c "
    awk '/# yoizen-dev BEGIN/{found=1} !found{print} /# yoizen-dev END/{found=0}' \"$hosts_file\" > \"$tmp\" \
    && printf '%s\n' '$block' >> \"$tmp\" \
    && cp \"$tmp\" \"$hosts_file\"
    rm -f \"$tmp\"
  " 2>/dev/null; then
    warn "/etc/hosts update failed (sudo unavailable?). Add these lines manually:"
    warn "  ${begin_marker}"
    warn "  127.0.0.1 api-gateway.platform-services-dev.dev.local"
    warn "  127.0.0.1 admin-console.platform-services-dev.dev.local"
    warn "  ${end_marker}"
  else
    log "/etc/hosts block updated."
  fi
}

configure_local_registry() {
  log "Configuring Knative to skip tag-to-digest resolution for local images"
  retry 5 3 kubectl patch configmap/config-deployment \
    --namespace knative-serving \
    --type merge \
    --patch '{"data":{"registries-skipping-tag-resolving":"dev.local"}}'
}

configure_knative_dev_mode_features() {
  # Enable the Knative feature flags required for source-mounted dev mode.
  # These flags allow hostPath volumes, PVC mounts, writable PVCs, pod-level
  # securityContext, and init containers on Knative Services. The patch is
  # idempotent — re-running bootstrap is safe.
  log "Configuring Knative config-features for dev-mode (hostPath, PVC, securityContext, init-containers)"
  retry 5 3 kubectl patch configmap/config-features \
    --namespace knative-serving \
    --type merge \
    --patch '{
      "data": {
        "kubernetes.podspec-volumes-hostpath": "enabled",
        "kubernetes.podspec-persistent-volume-claim": "enabled",
        "kubernetes.podspec-persistent-volume-write": "enabled",
        "kubernetes.podspec-securitycontext": "enabled",
        "kubernetes.podspec-init-containers": "enabled"
      }
    }'
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

    if [[ "$env" == "dev" ]]; then
      local tenant_ns="acme-dev-ns"
      if kubectl get namespace "$tenant_ns" &>/dev/null; then
        log "Namespace '${tenant_ns}' already exists"
      else
        log "Creating namespace '${tenant_ns}'"
        kubectl create namespace "$tenant_ns"
        kubectl label namespace "$tenant_ns" \
          app.kubernetes.io/part-of=yoizen-arch \
          yoizen.io/tenant=acme \
          yoizen.io/environment=dev \
          yoizen.io/managed-by=tenant-service
      fi
    fi
  done
}

apply_infrastructure() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  for env in "${ENVIRONMENTS[@]}"; do
    local ns="support-services-${env}"
    local overlay_path
    overlay_path="$(orbstack_infra_overlay_path "$script_dir" "$env")"

    log "Applying infrastructure for '${env}' (OrbStack, ${STORAGE_ENGINE})"
    apply_kustomize "$overlay_path"

    log "Waiting for NATS in ${ns}..."
    kubectl rollout status statefulset/nats \
      --namespace "$ns" \
      --timeout=180s

    log "Waiting for Redis StatefulSet in ${ns}..."
    kubectl rollout status statefulset/redis \
      --namespace "$ns" \
      --timeout=180s

    if is_mongo_storage_engine; then
      log "Waiting for MongoDB platform StatefulSet in ${ns}..."
      kubectl rollout status statefulset/mongo-platform \
        --namespace "$ns" \
        --timeout=300s

      log "Waiting for MongoDB usage StatefulSet in ${ns}..."
      kubectl rollout status statefulset/mongo-usage \
        --namespace "$ns" \
        --timeout=300s
    else
      log "Waiting for PostgreSQL in ${ns}..."
      kubectl rollout status statefulset/postgres \
        --namespace "$ns" \
        --timeout=180s
    fi

    local cnpg_clusters=()
    if is_mongo_storage_engine; then
      cnpg_clusters=(
        postgres-temporal
        postgres-temporal-visibility
      )
    else
      cnpg_clusters=(
        postgres-shared
        postgres-usage-shared
        postgres-temporal
        postgres-temporal-visibility
      )
    fi

    log "Waiting for CloudNativePG clusters in ${ns} (parallel)..."
    local cnpg_pids=()
    for cnpg_cluster in "${cnpg_clusters[@]}"; do
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

    # Developer mode runs a single `temporalio/auto-setup` pod, which
    # runs schema setup AND default-namespace registration itself on
    # boot. So there is no separate schema Job, no multi-role rollout,
    # and no history-shard rebalance (one pod owns all 16 shards). Just
    # wait for the single `temporal` Deployment to become Available.
    log "Waiting for Temporal (auto-setup) Deployment in ${ns}..."
    kubectl rollout status deployment/temporal \
      --namespace "$ns" \
      --timeout=300s

    # The namespace-bootstrap Job ensures the `default` namespace and the
    # `TenantId` search attribute exist — SDK clients (workflow-worker,
    # connector-runtime) crash on first boot otherwise. The Job waits
    # internally for the frontend to be SERVING; the outer kubectl wait
    # surfaces failures in the bootstrap log instead of as later SDK
    # errors.
    log "Waiting for temporal namespace bootstrap Job in ${ns}..."
    kubectl wait --namespace "$ns" \
      --for=condition=complete \
      job/temporal-namespace-bootstrap-1-28-4 \
      --timeout=420s

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

  # Ensure the dev-mode deps PVC exists before services are deployed.
  # kubectl apply is idempotent — safe to run on every bootstrap.
  log "Applying dev-mode deps PVC"
  kubectl apply -f "${script_dir}/knative/dev-mode/deps-pvc.yaml"

  for env in "${ENVIRONMENTS[@]}"; do
    local knative_overlay
    knative_overlay="$(local_knative_overlay_path "$script_dir" "$env")"
    log "Applying Knative services for '${env}' (${STORAGE_ENGINE}) → ${knative_overlay##*/}"
    retry 5 3 kubectl apply -k "$knative_overlay"
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

  log "Building service images (Docker > OrbStack shared daemon)"

  source "${script_dir}/services.conf"
  local services=($YZ_SERVICES)

  # BUILD_PARALLELISM controls how many `docker build` invocations run
  # concurrently. Default of 2 is the sweet spot on a typical dev box:
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
  if ! kubectl cluster-info &>/dev/null; then
    err "Kubernetes cluster is not reachable."
    err "Run './bootstrap-orbstack-osx.sh support-services' first."
    exit 1
  fi
  log "Cluster is reachable (context: orbstack)"
}

verify_support_services() {
  local core_deployments=(otel-collector tempo prometheus loki grafana)

  if ! kubectl get crd clusters.postgresql.cnpg.io &>/dev/null \
    || ! kubectl get crd poolers.postgresql.cnpg.io &>/dev/null; then
    err "CloudNativePG CRDs not found in cluster."
    err "Run './bootstrap-orbstack-osx.sh support-services' before platform-services."
    exit 1
  fi

  for env in "${ENVIRONMENTS[@]}"; do
    local ns="support-services-${env}"
    local engine core_statefulsets cnpg_clusters cnpg_cluster
    if ! kubectl get namespace "$ns" &>/dev/null; then
      warn "Namespace '${ns}' does not exist — support-services may not be deployed"
      continue
    fi

    engine="$(storage_engine_for_namespace "$ns")"
    if [[ "$engine" == "mongo" ]]; then
      core_statefulsets=(nats mongo-platform mongo-usage redis)
      cnpg_clusters=(postgres-temporal postgres-temporal-visibility)
    else
      core_statefulsets=(nats postgres redis)
      cnpg_clusters=(
        postgres-shared
        postgres-usage-shared
        postgres-temporal
        postgres-temporal-visibility
      )
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

    for cnpg_cluster in "${cnpg_clusters[@]}"; do
      if ! kubectl get cluster.postgresql.cnpg.io "$cnpg_cluster" --namespace "$ns" &>/dev/null; then
        warn "CloudNativePG Cluster '${cnpg_cluster}' not found in ${ns}"
      fi
    done

    # Developer mode: a single `temporal` (auto-setup) Deployment + the UI.
    local temporal_deploys=(
      temporal
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
  print_storage_engine_banner
  check_orbstack_context
  install_metrics_server
  install_knative_serving
  install_kourier
  install_cloudnative_pg
  # Helm install above runs without `--wait`. CRDs land synchronously;
  # the operator pod reconciles in the background. We wait here before
  # any infra manifest references its CRs.
  wait_for_operators_ready
  configure_dns
  ensure_dev_hosts
  configure_local_registry
  configure_knative_dev_mode_features
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
  local group_label="${SERVICE_GROUP:-all}"

  echo ""
  log "=============================="
  log " Setup complete! [${group_label}]"
  log "=============================="
  echo ""
  echo "  Cluster:       OrbStack Kubernetes"
  echo "  DNS domain:    dev.local"
  echo "  Environment:   dev"
  echo "  Group:         ${group_label}"
  echo "  Storage engine: ${STORAGE_ENGINE}"
  if is_mongo_storage_engine; then
    echo "                  (hybrid with Temporal Postgres)"
  fi
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
    echo "    kubectl get storageclass"
    echo ""
    echo "  API Gateway (dev): http://api-gateway.platform-services-dev.dev.local"
    echo ""
    echo "  Port-forwarding (run in a separate terminal):"
    if is_mongo_storage_engine; then
      echo "    STORAGE_ENGINE=mongo ./port-forward.sh ${ENVIRONMENTS[0]}"
    else
      echo "    ./port-forward.sh ${ENVIRONMENTS[0]}"
    fi
    echo ""
  fi
}

# ---------------------------------------------------------------------------
# Smoke test (optional, best-effort)
# ---------------------------------------------------------------------------

run_smoke_tests() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local smoke_script="${script_dir}/scripts/smoke-test.sh"

  if [[ ! -f "$smoke_script" ]]; then
    warn "--smoke requested but scripts/smoke-test.sh not found — skipping"
    return
  fi

  log "Running smoke tests (scripts/smoke-test.sh)..."
  if bash "$smoke_script"; then
    log "Smoke tests passed."
  else
    warn "Smoke tests FAILED — cluster is up but e2e suite reported errors."
    warn "Run manually: bash scripts/smoke-test.sh"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  parse_args "$@"

  log "Event-Driven Architecture Bootstrap — OrbStack (macOS, complete)"
  log "Environment:  dev"
  log "Group:        ${SERVICE_GROUP:-all}"
  log "Storage:      ${STORAGE_ENGINE}"
  print_storage_engine_banner
  echo ""

  check_deps

  case "$SERVICE_GROUP" in
    support-services)
      run_support_services
      ;;
    platform-services)
      run_platform_services
      if [[ "$RUN_SMOKE" == "true" ]]; then
        run_smoke_tests
      fi
      ;;
    "")
      run_support_services
      run_platform_services
      if [[ "$RUN_SMOKE" == "true" ]]; then
        run_smoke_tests
      fi
      ;;
  esac

  print_summary
}

main "$@"
