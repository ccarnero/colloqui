#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# validate-dev-mode.sh — canary round-trip proving dev-mode.sh works TODAY
# =============================================================================
#
# Validates, against the live cluster, that dev-mode.sh can be trusted as the
# inner loop of a /build run. Guinea pig: workflow-service (worst case: 1 ksvc
# + 2 worker Deployments, including the Temporal worker whose `command` was
# the victim of the 2026-06-13 `off` regression).
#
# Stages (each one PASS/FAIL, first failure aborts with restore attempt):
#   1. preflight   kubectl context, jq, yaml tool, deps PVC, clean canary file
#   2. snapshot    declared image+command of every workflow-service object
#   3. on          ./dev-mode.sh workflow-service on
#   4. reload      append canary comment to src/main.ts → measure time until
#                  the api pod logs a fresh Nest restart (bun --watch)
#   5. e2e         [--with-e2e] run scripts/e2e/http-workflow.sh under dev mode
#   6. off         ./dev-mode.sh workflow-service off
#   7. restored    live image+command of EVERY object matches the snapshot;
#                  dev-mode annotation gone. Guards the June-13 regression.
#
# Idempotent: safe to re-run; the canary edit is reverted via git checkout
# (stage 1 refuses to start if the canary file is dirty — never discards
# changes it did not create). Exit 0 = dev-mode is trustworthy today.
#
# Usage:
#   ./scripts/validate-dev-mode.sh [--with-e2e]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

NS="platform-services-dev"
SVC="workflow-service"
CANARY_FILE="services/workflow-service/src/main.ts"
KSVC="workflow-service-api"
DEPLOYS=(workflow-service-worker workflow-worker)
DEV_ANNOTATION="yoizen.io/dev-mode"
RELOAD_TIMEOUT=90
WITH_E2E=false
[[ "${1:-}" == "--with-e2e" ]] && WITH_E2E=true

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[PASS]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; }
step() { echo -e "${CYAN}[STAGE]${NC} $*"; }

FAILED=false
fail() { err "$*"; FAILED=true; }

cleanup() {
  # Best-effort restore, always safe to re-run.
  git checkout -- "$CANARY_FILE" 2>/dev/null || true
  [[ -n "${SNAP_DIR:-}" ]] && rm -rf "$SNAP_DIR"
}
trap cleanup EXIT

# ── Stage 1: preflight ───────────────────────────────────────────────────────
step "1/7 preflight"
ctx="$(kubectl config current-context 2>/dev/null || true)"
[[ "$ctx" == "orbstack" ]] || warn "context is '$ctx', expected 'orbstack' (continuing)"
command -v jq >/dev/null || { err "jq missing"; exit 1; }
if ! command -v yq >/dev/null && ! python3 -c 'import yaml' 2>/dev/null; then
  err "neither yq nor python3+PyYAML available — dev-mode off would be unsafe"; exit 1
fi
kubectl -n "$NS" get pvc dev-mode-deps >/dev/null 2>&1 \
  || { err "deps PVC missing — run ./dev-mode.sh deps first"; exit 1; }
# PVC freshness is a HARD check here (dev-mode.sh only warns): a stale PVC
# breaks workspace-package resolution in-pod (@yoizen/shared, 2026-07-10).
LOCAL_SHA="$(shasum -a 256 pnpm-lock.yaml | awk '{print $1}')"
CLUSTER_SHA="$(kubectl -n "$NS" get configmap dev-mode-state \
  -o jsonpath='{.data.lockSha}' 2>/dev/null || true)"
if [[ -z "$CLUSTER_SHA" ]]; then
  err "no lockSha recorded in dev-mode-state — run ./dev-mode.sh deps first"; exit 1
elif [[ "$LOCAL_SHA" != "$CLUSTER_SHA" ]]; then
  err "deps PVC is STALE (pnpm-lock.yaml changed since last install)"
  err "  cluster: $CLUSTER_SHA"
  err "  local:   $LOCAL_SHA"
  err "run: ./dev-mode.sh deps --force   (then re-run this validator)"
  exit 1
fi
if [[ -n "$(git status --porcelain "$CANARY_FILE")" ]]; then
  err "$CANARY_FILE has local changes — commit/stash them first (won't touch your work)"; exit 1
fi
# The snapshot must capture DECLARED state, not dev-mode state: refuse to run
# if any target is already flipped (would poison the stage-7 baseline —
# exactly what produced the false FAIL of 2026-07-10).
dev_annotation() {  # $1 = kind, $2 = name
  kubectl -n "$NS" get "$1" "$2" \
    -o jsonpath="{.metadata.annotations.yoizen\.io/dev-mode}" 2>/dev/null || true
}
ALREADY_DEV=false
[[ "$(dev_annotation ksvc "$KSVC")" == "true" ]] && { err "$KSVC is already in dev mode"; ALREADY_DEV=true; }
for d in "${DEPLOYS[@]}"; do
  [[ "$(dev_annotation deployment "$d")" == "true" ]] && { err "$d is already in dev mode"; ALREADY_DEV=true; }
done
if $ALREADY_DEV; then
  err "run: ./dev-mode.sh $SVC off   — then re-run this validator from a clean state"
  exit 1
fi
log "preflight ok (context=$ctx, no target in dev mode)"

# ── Stage 2: snapshot declared state ─────────────────────────────────────────
# NOTE: no associative arrays — macOS ships bash 3.2. Snapshots go to tmp files.
SNAP_DIR="$(mktemp -d /tmp/validate-dev-mode.XXXXXX)"

live_state() {  # $1 = kind (ksvc|deployment), $2 = object name
  kubectl -n "$NS" get "$1" "$2" \
    -o jsonpath='{.spec.template.spec.containers[0].image}{"|"}{.spec.template.spec.containers[0].command}'
}

step "2/7 snapshot declared image+command"
live_state ksvc "$KSVC" > "${SNAP_DIR}/${KSVC}"
echo "        $KSVC: $(cat "${SNAP_DIR}/${KSVC}")"
for d in "${DEPLOYS[@]}"; do
  live_state deployment "$d" > "${SNAP_DIR}/${d}"
  echo "        $d: $(cat "${SNAP_DIR}/${d}")"
done
log "snapshot captured (${SNAP_DIR})"

# ── Stage 3: dev-mode on ─────────────────────────────────────────────────────
step "3/7 dev-mode on"
./dev-mode.sh "$SVC" on
kubectl -n "$NS" wait --for=condition=available "deployment/${DEPLOYS[0]}" --timeout=120s >/dev/null
log "dev-mode on applied"

# ── Stage 4: live-reload canary ──────────────────────────────────────────────
# The canary PRINTS ITSELF: a top-level console.log(nonce) appended to main.ts
# only appears in pod logs if bun --watch actually reloaded the edited source.
# Observed on the workflow-service-worker DEPLOYMENT (same src/main.ts entry):
# unlike the ksvc it never scales to zero, and `kubectl logs deploy/...` does
# not truncate like label-selector queries do (bugs of the 2026-07-10 run).
RELOAD_TARGET="workflow-service-worker"
step "4/7 live-reload latency (canary edit on $CANARY_FILE, watched on deploy/$RELOAD_TARGET)"
NONCE="dev-mode-canary-$(date +%s)"
T0=$(date +%s)
printf '\nconsole.log("%s");\n' "$NONCE" >> "$CANARY_FILE"
RELOADED=false
for _ in $(seq 1 "$RELOAD_TIMEOUT"); do
  if kubectl -n "$NS" logs "deploy/${RELOAD_TARGET}" --tail=-1 \
       --since=$(( $(date +%s) - T0 + 5 ))s 2>/dev/null | grep -q "$NONCE"; then
    RELOADED=true; break
  fi
  sleep 1
done
T1=$(date +%s)
git checkout -- "$CANARY_FILE"
if $RELOADED; then
  log "canary nonce logged by reloaded pod in $(( T1 - T0 ))s (2026-07-03 baseline: ~2s)"
else
  fail "nonce not seen within ${RELOAD_TIMEOUT}s — bun --watch/VirtioFS mount not working on deploy/$RELOAD_TARGET"
fi

# ── Stage 5: optional e2e under dev mode ─────────────────────────────────────
step "5/7 e2e smoke under dev mode"
if $WITH_E2E; then
  if ./scripts/e2e/http-workflow.sh; then
    log "e2e-http-workflow.sh green under dev mode"
  else
    fail "e2e-http-workflow.sh failed under dev mode"
  fi
else
  warn "skipped (pass --with-e2e to run the full chain)"
fi

# ── Stage 6: dev-mode off ────────────────────────────────────────────────────
step "6/7 dev-mode off"
./dev-mode.sh "$SVC" off
log "dev-mode off applied"

# ── Stage 7: declared state restored ─────────────────────────────────────────
step "7/7 restoration check (June-13 regression guard)"
sleep 3
CUR_KSVC="$(live_state ksvc "$KSVC")"
[[ "$CUR_KSVC" == "$(cat "${SNAP_DIR}/${KSVC}")" ]] \
  && log "$KSVC restored" \
  || fail "$KSVC NOT restored: '$CUR_KSVC' != '$(cat "${SNAP_DIR}/${KSVC}")'"
for d in "${DEPLOYS[@]}"; do
  CUR="$(live_state deployment "$d")"
  [[ "$CUR" == "$(cat "${SNAP_DIR}/${d}")" ]] \
    && log "$d restored (command intact)" \
    || fail "$d NOT restored: '$CUR' != '$(cat "${SNAP_DIR}/${d}")'"
  ANN="$(kubectl -n "$NS" get deployment "$d" \
    -o jsonpath="{.metadata.annotations.yoizen\.io/dev-mode}" 2>/dev/null || true)"
  [[ -z "$ANN" || "$ANN" == "false" ]] || fail "$d still annotated dev-mode=$ANN"
done

echo
if $FAILED; then
  err "dev-mode validation FAILED — do NOT use it as the loop's cluster mechanism yet"
  exit 1
fi
log "dev-mode validation PASSED — safe to use as the loop's inner iteration mechanism"
