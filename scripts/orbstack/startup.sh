#!/usr/bin/env bash
#
# orbstack/startup.sh — one-command DEV startup orchestrator (OrbStack / macOS).
#
# DEV ONLY: chains the existing scripts in the right order with a readiness gate.
# Does NOT create qa/staging/prod — the dev environment is the only target
# (bootstrap is dev-scoped: ENVIRONMENTS=(dev)).
#
# Pipeline:
#   [--rebuild] rebuild-changed.sh
#   [bootstrap] bootstrap-orbstack-osx.sh        (bring up support + platform)
#   gate:       scripts/smoke-test.sh            (readiness preflight, POLLED)
#   tenant:     setup-tenant.sh                  (tenant 'acme' + admin, idempotent)
#   e2e:        scripts/e2e/http-workflow.sh     (http channel -> workflow create+run+assert)
#
# Usage (run from anywhere — resolves repo root from its own location):
#   scripts/orbstack/startup.sh                # full: bootstrap -> smoke -> tenant -> e2e
#   scripts/orbstack/startup.sh --no-bootstrap # skip bring-up (cluster already running)
#   scripts/orbstack/startup.sh --rebuild      # rebuild changed images first
#   scripts/orbstack/startup.sh --no-e2e       # bring up + tenant only, skip functional e2e
#
# Env overrides:
#   API_URL   (default http://api-gateway.platform-services-dev.dev.local)
#   READINESS_TIMEOUT_S   (default 420 — bound on the stage-2 smoke poll)
#   STORAGE_ENGINE=mongo  (passed through to bootstrap)
#
set -euo pipefail

# This script lives in scripts/orbstack/ — repo root is two levels up.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

API_URL="${API_URL:-http://api-gateway.platform-services-dev.dev.local}"
DO_BOOTSTRAP=1
DO_REBUILD=0
DO_E2E=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-bootstrap) DO_BOOTSTRAP=0; shift ;;
    --rebuild)      DO_REBUILD=1; shift ;;
    --no-e2e)       DO_E2E=0; shift ;;
    -h|--help)      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1 (try --help)" >&2; exit 1 ;;
  esac
done

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; C_N='\033[0m'
stage() { echo -e "\n${C_G}==== $* ====${C_N}"; }
warn()  { echo -e "${C_Y}[warn]${C_N} $*"; }
die()   { echo -e "${C_R}[fail]${C_N} $*" >&2; exit 1; }

START_TS=$(date +%s)

# Pre-authorize sudo UP FRONT: bootstrap writes a managed /etc/hosts block (needs
# sudo). Asking here keeps the password prompt at the very start so it never pops up
# mid-run and breaks your focus. Skipped with --no-bootstrap (hosts already set).
if [[ $DO_BOOTSTRAP == 1 ]]; then
  stage "Sudo up front (bootstrap edits /etc/hosts)"
  sudo -v || die "sudo is required to update /etc/hosts during bootstrap. Grant sudo, or set the /etc/hosts block manually and re-run with --no-bootstrap."
  # Keep the sudo timestamp fresh for the whole run; the keep-alive dies with the script.
  ( while true; do sleep 50; kill -0 "$$" 2>/dev/null || exit; sudo -n true 2>/dev/null || exit; done ) &
  SUDO_KEEPALIVE_PID=$!
  trap 'kill "${SUDO_KEEPALIVE_PID:-}" 2>/dev/null || true' EXIT
fi

# Precheck: the Kubernetes API must be reachable. Without this you get N cryptic
# metrics-server retries (connection refused); here we fail fast and actionable.
stage "Precheck: Kubernetes API reachable"
kubectl cluster-info --request-timeout=5s >/dev/null 2>&1 || die \
"Kubernetes API not reachable (kubectl context: $(kubectl config current-context 2>/dev/null || echo unknown)). \
Start OrbStack and enable Kubernetes (Settings -> Kubernetes), then verify: kubectl get nodes"

# 0. Rebuild (optional)
if [[ $DO_REBUILD == 1 ]]; then
  stage "0/4 Rebuild changed images"
  bash ./rebuild-changed.sh
fi

# 1. Bootstrap (dev only)
if [[ $DO_BOOTSTRAP == 1 ]]; then
  stage "1/4 Bootstrap dev cluster (support + platform)"
  bash ./bootstrap-orbstack-osx.sh
else
  warn "skipping bootstrap (--no-bootstrap)"
fi

# 2. Readiness gate — POLL the smoke-test until the rollout settles (cold-start +
#    20 images on a fresh cluster takes minutes). Fail only after the timeout.
stage "2/4 Readiness gate (waiting for rollout)"
READINESS_TIMEOUT_S="${READINESS_TIMEOUT_S:-420}"
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

# 3. Tenant (idempotent: skips if 'acme' already exists)
stage "3/4 Provision tenant 'acme' + admin"
bash ./setup-tenant.sh --api-url "$API_URL"

# 4. Functional e2e: http channel -> workflow create+run+assert.
#    One retry to ride out the tenant-provisioning window (setup-tenant can
#    return before the tenant is fully ready).
if [[ $DO_E2E == 1 ]]; then
  stage "4/4 E2E http -> workflow (create + run + assert)"
  if ! E2E_API_URL="$API_URL" bash scripts/e2e/http-workflow.sh; then
    warn "e2e failed on first attempt — tenant may still be provisioning; retrying in 15s"
    sleep 15
    E2E_API_URL="$API_URL" bash scripts/e2e/http-workflow.sh || die "e2e failed after retry"
  fi
else
  warn "skipping e2e (--no-e2e)"
fi

echo -e "\n${C_G}==== dev startup complete in $(( $(date +%s) - START_TS ))s ====${C_N}"
echo "API: ${API_URL}   Tenant: acme   Admin console: ${API_URL%/}/admin-console"
echo "Trazá un flujo:  GET ${API_URL}/api/audit/channel-events/chain/<correlation_id>"
