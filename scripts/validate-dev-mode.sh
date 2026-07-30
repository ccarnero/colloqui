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
#  4b. barrier     wait until the API ksvc reloaded by stage 4's canary REVERT
#                  serves the expected SHAPE again (see the stage-4b block)
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
# ── Stage-4b readiness barrier knobs (see the stage-4b block for the why) ────
# Cold case measured 2026-07-30 (T01 finding 4): first transpile after the dev
# rollout took ~40s to a stable response, so the bound is 120s, not the ~2.5s
# warm window.
BARRIER_TIMEOUT=120
# T01 finding 7b: the canary APPEND and the canary REVERT are two distinct
# bun --watch reloads with a legitimately-healthy gap between them, so a single
# good sample proves nothing — require N consecutive ones.
BARRIER_CONSECUTIVE=3
BARRIER_INTERVAL=1
# Max time to wait for evidence that the REVERT's reload actually started
# (fresh Nest boot line, or a bad probe sample). If neither ever appears the
# barrier still accepts a continuously-healthy API — with a WARN, never
# silently. This is a bound on an observation, not a sleep: the normal path
# leaves the barrier as soon as the reload is seen AND the shape is back.
BARRIER_RELOAD_GRACE=20
# Same gateway/tenant/credentials defaults (and env-var names) as
# scripts/e2e/http-workflow.sh, so the barrier probes exactly the transport
# stage 5 is about to use. Overridable for non-default environments.
BARRIER_API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
BARRIER_HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
BARRIER_TENANT="${E2E_TENANT:-acme}"
BARRIER_EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
BARRIER_PASSWORD="${E2E_PASSWORD:-admin123}"
# macOS mDNS resolves *.dev.local slowly; --resolve short-circuits it (same
# convention and env var as the e2e script).
BARRIER_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"
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

# ── Stage 4b: API readiness barrier (close the stage-4→5 race) ───────────────
# History (T01, 2026-07-30, manual-loops/architecture/dev-mode-validator-fix.md):
# src/main.ts is the entry of the worker Deployments AND of the
# workflow-service-api ksvc, so BOTH stage-4 writes (the canary append above and
# the `git checkout` revert) restart the API's bun --watch process. Stage 4 only
# ever watched the worker Deployment, so stage 5 used to start while the API was
# mid-restart: the gateway then answers a well-formed HTTP 502 JSON *object*
# ({"statusCode":502,"message":"dial tcp ... connection refused"}), which breaks
# the e2e's `jq '.[] | select(.name ...)'` and provisioning-service's workflow
# findByName (partial manifest apply → "missing an expected resource externalId").
#
# Barrier design:
#   probe        GET /api/workflows through the GATEWAY, authenticated (same
#                transport stage 5 uses) — liveness/200 alone is not enough
#   shape check  HTTP 200 AND the body is a JSON ARRAY (the exact shape the
#                e2e consumer indexes); the 502 body is an object, so it fails
#   good sample  shape check passes
#   accept       BARRIER_CONSECUTIVE consecutive good samples, AFTER the
#                revert's outage has been observed (>=1 bad sample) — or, if
#                the restart was too fast to sample at all, the same streak
#                sustained to BARRIER_RELOAD_GRACE, plus a WARN
#   bound        BARRIER_TIMEOUT seconds, then FAIL (never a silent skip)
# The reload is detected from the PROBE, not from the api pod's Nest boot
# lines: after the revert those two writes are indistinguishable in the log
# (the append's own boot can land after the revert's timestamp), so a boot
# line is not evidence that the REVERT's reload has happened yet.
# Every attempt is logged with elapsed time, HTTP code, JSON type and streak.
step "4b/7 API readiness barrier (waiting for GET /api/workflows to be a JSON array again after the canary revert)"

BARRIER_PORT=80
_barrier_hostport="${BARRIER_API_URL#*://}"; _barrier_hostport="${_barrier_hostport%%/*}"
if [[ "$_barrier_hostport" == *:* ]]; then
  BARRIER_PORT="${_barrier_hostport##*:}"
elif [[ "${BARRIER_API_URL%%://*}" == "https" ]]; then
  BARRIER_PORT=443
fi
BARRIER_RESOLVE_ARGS=()
[[ -n "$BARRIER_RESOLVE_IP" ]] && \
  BARRIER_RESOLVE_ARGS=(--resolve "${BARRIER_HOST_HEADER}:${BARRIER_PORT}:${BARRIER_RESOLVE_IP}")
BARRIER_TOKEN=""

barrier_curl() {  # $1 = method, $2 = path, $3 = optional json body; emits body + final line = http code
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 5 --max-time 15 -w '\n%{http_code}' -X "$method"
    "${BARRIER_API_URL}${path}"
    -H "Host: ${BARRIER_HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${BARRIER_TENANT}")
  [[ ${#BARRIER_RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${BARRIER_RESOLVE_ARGS[@]}")
  [[ -n "$BARRIER_TOKEN" ]] && args+=(-H "Authorization: Bearer ${BARRIER_TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}" 2>/dev/null || true
}

barrier_login() {  # refresh BARRIER_TOKEN; auth-service is not the service being reloaded
  local out code
  out="$(barrier_curl POST /api/auth/login \
    "{\"email\":\"${BARRIER_EMAIL}\",\"password\":\"${BARRIER_PASSWORD}\",\"tenant_id\":\"${BARRIER_TENANT}\"}")"
  code="${out##*$'\n'}"
  BARRIER_TOKEN="$(printf '%s' "${out%$'\n'*}" | jq -r '.access_token // empty' 2>/dev/null || true)"
  if [[ -z "$BARRIER_TOKEN" ]]; then
    echo "        barrier: login returned HTTP ${code} with no access_token (will retry next attempt)"
    return 1
  fi
  return 0
}

barrier_login || true   # first token; failures are retried inside the loop
T_REVERT=$T1            # wall clock of stage 4's `git checkout` revert above
BARRIER_STREAK=0
BARRIER_RELOAD_SEEN=false
BARRIER_READY=false
BARRIER_ATTEMPT=0
BARRIER_GRACE_WARNED=false
while :; do
  BARRIER_ELAPSED=$(( $(date +%s) - T_REVERT ))
  if [[ "$BARRIER_ELAPSED" -ge "$BARRIER_TIMEOUT" ]]; then break; fi
  BARRIER_ATTEMPT=$(( BARRIER_ATTEMPT + 1 ))

  OUT="$(barrier_curl GET /api/workflows)"
  CODE="${OUT##*$'\n'}"
  BODY="${OUT%$'\n'*}"
  TYPE="$(printf '%s' "$BODY" | jq -r 'type' 2>/dev/null || true)"
  [[ -z "$TYPE" ]] && TYPE="unparseable"

  if [[ "$CODE" == "200" && "$TYPE" == "array" ]]; then
    BARRIER_STREAK=$(( BARRIER_STREAK + 1 ))
  else
    if ! $BARRIER_RELOAD_SEEN; then
      echo "        barrier: reload outage observed (code=${CODE} type=${TYPE}) — the API is restarting, as expected after the revert"
      BARRIER_RELOAD_SEEN=true
    fi
    BARRIER_STREAK=0
    # A 401/403 here is a stale/absent token, not the reload: refresh it so a
    # bad token can never masquerade as a permanently un-ready API.
    if [[ "$CODE" == "401" || "$CODE" == "403" ]]; then
      echo "        barrier: HTTP ${CODE} — refreshing the auth token"
      barrier_login || true
    fi
  fi

  echo "        barrier attempt ${BARRIER_ATTEMPT} (+${BARRIER_ELAPSED}s): code=${CODE} type=${TYPE} streak=${BARRIER_STREAK}/${BARRIER_CONSECUTIVE} reload_seen=${BARRIER_RELOAD_SEEN}"

  if [[ "$BARRIER_STREAK" -ge "$BARRIER_CONSECUTIVE" ]]; then
    if $BARRIER_RELOAD_SEEN; then
      BARRIER_READY=true; break
    elif [[ "$BARRIER_ELAPSED" -ge "$BARRIER_RELOAD_GRACE" ]]; then
      warn "barrier: no reload evidence within ${BARRIER_RELOAD_GRACE}s, but the API served ${BARRIER_STREAK} consecutive good samples — accepting"
      BARRIER_READY=true; break
    elif ! $BARRIER_GRACE_WARNED; then
      echo "        barrier: shape is good but the revert's reload has not been observed yet — holding until +${BARRIER_RELOAD_GRACE}s"
      BARRIER_GRACE_WARNED=true
    fi
  fi
  sleep "$BARRIER_INTERVAL"
done
BARRIER_TOOK=$(( $(date +%s) - T_REVERT ))
if $BARRIER_READY; then
  log "API ready: GET /api/workflows returned a JSON array ${BARRIER_CONSECUTIVE}x consecutively after the canary revert, in ${BARRIER_TOOK}s (${BARRIER_ATTEMPT} attempts)"
else
  fail "API not ready within ${BARRIER_TIMEOUT}s after the canary revert (last: code=${CODE:-none} type=${TYPE:-none}, streak=${BARRIER_STREAK}/${BARRIER_CONSECUTIVE}) — stage 5 would race the bun --watch reload"
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
