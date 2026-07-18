#!/usr/bin/env bash
#
# minikube/startup.sh — one-command DEV startup orchestrator (minikube / Linux).
#
# DEV ONLY: chains the existing scripts in the right order with a readiness gate.
# Mirrors scripts/orbstack/startup.sh; only the minikube-specific bits differ:
#   - bootstrap-minikube-linux.sh (builds into minikube's own docker daemon)
#   - --rebuild runs inside `minikube docker-env` so images land in the cluster
#   - API access via a managed `kubectl port-forward` to Kourier + localhost:8080
#     (the scripts send the `Host` header, so Kourier routes correctly) — no
#     `minikube tunnel` and no sudo / /etc/hosts needed.
#
# Pipeline:
#   [--rebuild] minikube docker-env + rebuild-changed.sh
#   [bootstrap] bootstrap-minikube-linux.sh        (bring up support + platform)
#   gate:       scripts/smoke-test.sh              (readiness preflight — fail fast)
#   forward:    kubectl port-forward svc/kourier   (-> http://localhost:8080)
#   tenant:     setup-tenant.sh                    (tenant 'acme' + admin, idempotent)
#   e2e:        scripts/e2e/http-workflow.sh       (http channel -> workflow create+run+assert)
#
# Usage (run from anywhere — resolves repo root from its own location):
#   scripts/minikube/startup.sh                # full: bootstrap -> smoke -> tenant -> e2e
#   scripts/minikube/startup.sh --no-bootstrap # skip bring-up (cluster already running)
#   scripts/minikube/startup.sh --rebuild      # rebuild changed images first
#   scripts/minikube/startup.sh --no-e2e       # bring up + tenant only, skip functional e2e
#
# Env overrides:
#   MINIKUBE_PROFILE   (default minikube)
#   API_URL            (default http://localhost:8080 via port-forward)
#   BUILD_PARALLELISM  (default 2 — paces the 18-image build on modest machines)
#   READINESS_TIMEOUT_S (default 600 — minikube cold image pulls are slow)
#   STORAGE_ENGINE=mongo  (passed through to bootstrap)
#
set -euo pipefail

# This script lives in scripts/minikube/ — repo root is two levels up.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-minikube}"
API_URL="${API_URL:-http://localhost:8080}"
HOST_HEADER="api-gateway.platform-services-dev.dev.local"
DO_BOOTSTRAP=1
DO_REBUILD=0
DO_E2E=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-bootstrap) DO_BOOTSTRAP=0; shift ;;
    --rebuild)      DO_REBUILD=1; shift ;;
    --no-e2e)       DO_E2E=0; shift ;;
    -h|--help)      sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 1 ;;
  esac
done

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_N='\033[0m'
stage() { echo -e "\n${C_G}==== $* ====${C_N}"; }
warn()  { echo -e "${C_Y}[warn]${C_N} $*"; }
die()   { echo -e "${C_R}[fail]${C_N} $*" >&2; exit 1; }

START_TS=$(date +%s)

# Single EXIT cleanup for both the sudo keep-alive and the Kourier port-forward.
SUDO_KEEPALIVE_PID=""; PF_PID=""
cleanup() { kill "${SUDO_KEEPALIVE_PID}" 2>/dev/null || true; kill "${PF_PID}" 2>/dev/null || true; }
trap cleanup EXIT

# Pre-authorize sudo UP FRONT: bootstrap-minikube writes the managed /etc/hosts block
# (needs sudo). Asking here keeps the prompt at the very start so it never pops up
# mid-run and breaks your focus. Skipped with --no-bootstrap (hosts already set).
if [[ $DO_BOOTSTRAP == 1 ]]; then
  stage "Sudo up front (bootstrap edits /etc/hosts)"
  sudo -v || die "sudo is required to update /etc/hosts during bootstrap. Grant sudo, or add the /etc/hosts block manually and re-run with --no-bootstrap."
  ( while true; do sleep 50; kill -0 "$$" 2>/dev/null || exit; sudo -n true 2>/dev/null || exit; done ) &
  SUDO_KEEPALIVE_PID=$!
fi

# Precheck: minikube profile running + Kubernetes API reachable. We do NOT auto-start
# minikube — its resources/tuning are machine-specific (see the bootstrap header).
stage "Precheck: minikube profile '$MINIKUBE_PROFILE' running"
minikube status -p "$MINIKUBE_PROFILE" >/dev/null 2>&1 || die \
"minikube profile '$MINIKUBE_PROFILE' is not running. Start it: minikube start -p $MINIKUBE_PROFILE --addons=metrics-server"
kubectl cluster-info --request-timeout=5s >/dev/null 2>&1 || die \
"Kubernetes API not reachable (kubectl context: $(kubectl config current-context 2>/dev/null || echo unknown)). Point kubectl at minikube."

# 0. Rebuild (optional) — INSIDE minikube's docker daemon so images are visible to it.
if [[ $DO_REBUILD == 1 ]]; then
  stage "0/4 Rebuild changed images (into minikube's daemon)"
  eval "$(minikube -p "$MINIKUBE_PROFILE" docker-env)"
  bash ./rebuild-changed.sh
fi

# 1. Bootstrap (dev only). BUILD_PARALLELISM paces the build on smaller boxes.
if [[ $DO_BOOTSTRAP == 1 ]]; then
  stage "1/4 Bootstrap dev cluster (support + platform)"
  BUILD_PARALLELISM="${BUILD_PARALLELISM:-2}" bash ./bootstrap-minikube-linux.sh
else
  warn "skipping bootstrap (--no-bootstrap)"
fi

# 2. Readiness gate — POLL the smoke-test until the rollout settles. minikube pulls
#    images cold, so the default window is larger than OrbStack's.
stage "2/4 Readiness gate (waiting for rollout)"
READINESS_TIMEOUT_S="${READINESS_TIMEOUT_S:-600}"
deadline=$(( $(date +%s) + READINESS_TIMEOUT_S ))
until bash scripts/smoke-test.sh >/dev/null 2>&1; do
  if (( $(date +%s) >= deadline )); then
    warn "still not Ready after ${READINESS_TIMEOUT_S}s — final state:"
    bash scripts/smoke-test.sh || true
    die "platform not Ready after ${READINESS_TIMEOUT_S}s. Diagnose: kubectl get pods -n platform-services-dev ; kubectl get events -n platform-services-dev --sort-by=.lastTimestamp | tail -20"
  fi
  warn "not Ready yet — re-checking in 15s ($(( deadline - $(date +%s) ))s left)"
  sleep 15
done
echo "readiness gate passed"

# 3. Port-forward Kourier -> localhost:8080 (managed; dies with the script). Unlike
#    OrbStack, minikube's LoadBalancer is not directly reachable without a tunnel;
#    a port-forward avoids needing `minikube tunnel` (and sudo). Kourier routes by
#    the Host header, which setup-tenant and e2e both send.
stage "3/4 Port-forward Kourier -> ${API_URL}"
kubectl port-forward -n kourier-system svc/kourier 8080:80 >/dev/null 2>&1 &
PF_PID=$!
ready=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null -H "Host: ${HOST_HEADER}" "${API_URL}/health" 2>/dev/null; then ready=1; break; fi
  kill -0 "$PF_PID" 2>/dev/null || die "port-forward to Kourier exited unexpectedly"
  sleep 1
done
[[ $ready == 1 ]] || die "port-forward up but ${API_URL}/health not reachable — is Kourier ready? (kubectl get svc -n kourier-system)"
echo "port-forward ready"

# 4. Tenant (idempotent: skips if 'acme' already exists)
stage "4/5 Provision tenant 'acme' + admin"
bash ./setup-tenant.sh --api-url "$API_URL"

# 5. Functional e2e: http channel -> workflow create+run+assert. One retry to ride
#    out the tenant-provisioning window (setup-tenant can return before fully ready).
if [[ $DO_E2E == 1 ]]; then
  stage "5/5 E2E http -> workflow (create + run + assert)"
  if ! E2E_API_URL="$API_URL" bash scripts/e2e/http-workflow.sh; then
    warn "e2e failed on first attempt — tenant may still be provisioning; retrying in 15s"
    sleep 15
    E2E_API_URL="$API_URL" bash scripts/e2e/http-workflow.sh || die "e2e failed after retry"
  fi
else
  warn "skipping e2e (--no-e2e)"
fi

echo -e "\n${C_G}==== dev startup complete in $(( $(date +%s) - START_TS ))s ====${C_N}"
echo "API: ${API_URL} (port-forward)   Tenant: acme"
echo "Trazá un flujo:  curl -H 'Host: ${HOST_HEADER}' ${API_URL}/api/audit/channel-events/chain/<correlation_id>"
echo "(el port-forward muere al cerrar el script; para dejarlo vivo, corré kubectl port-forward aparte)"
