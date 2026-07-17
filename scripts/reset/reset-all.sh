#!/usr/bin/env bash
# reset-all.sh — one-shot orchestrator for a full dev-environment wipe.
# Runs, in order:
#   1. reset-dev.ts        (messages/events/usage/redis DATA)
#   2. purge-temporal.sh   (Temporal workflow/history/task-queue state)
#   3. reset-tenant.sh     (tenant resource definitions + tracking traces)
#   4. purge-circuit-breakers.sh (Redis cb:* breaker state)
#
# See scripts/reset/README.md for what each stage clears and preserves.
#
# Flags:
#   --dry-run   (default) pass --dry-run down to every child script;
#                 nothing is mutated
#   --apply     pass --apply down to every child script
#   --yes / -y  pass --yes down to every child script (skip confirmations)
#
# Exit codes:
#   0  every stage succeeded
#   1  a stage failed — aborts before running later stages
#   2  bad input / preflight failed before any stage ran

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
banner() { printf '\n=================== %s ===================\n\n' "$*"; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [--dry-run|--apply] [--yes]

Runs, in order: reset-dev.ts, purge-temporal.sh, reset-tenant.sh,
purge-circuit-breakers.sh. Aborts on the first failing stage.

Examples:
  ./scripts/reset/reset-all.sh                # dry-run every stage
  ./scripts/reset/reset-all.sh --apply --yes  # full wipe, no prompts
EOF
}

DRY_RUN=true
ASSUME_YES=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --apply)   DRY_RUN=false ;;
    -y|--yes)  ASSUME_YES=true ;;
    -h|--help) usage; exit 0 ;;
    *)
      err "Unknown flag: $arg"
      usage
      exit 2
      ;;
  esac
done

require_env() {
  local missing=()
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    err "Missing required env var(s) for reset-dev.ts (set them in scripts/reset/.env):"
    for m in "${missing[@]}"; do err "  $m"; done
    exit 2
  fi
}

REQUIRED_RESET_DEV_ENV=(
  NATS_URL POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD
  POSTGRES_DB TENANT_POSTGRES_SHARED_HOST TENANT_POSTGRES_SHARED_PORT
  REDIS_HOST REDIS_PORT
)
require_env "${REQUIRED_RESET_DEV_ENV[@]}"

YES_FLAG=()
if [[ "$ASSUME_YES" == "true" ]]; then
  YES_FLAG=(--yes)
fi

MODE_FLAG="--dry-run"
if [[ "$DRY_RUN" == "false" ]]; then
  MODE_FLAG="--apply"
fi

log "Mode: $([[ "$DRY_RUN" == "true" ]] && echo "DRY-RUN (default)" || echo "APPLY")"

# ----- 1. reset-dev.ts (messages/events/usage/redis DATA) --------------------

banner "1/4 reset-dev.ts — messages/events/usage/redis"
RESET_DEV_ARGS=()
if [[ "$DRY_RUN" == "false" ]]; then
  RESET_DEV_ARGS+=(--apply)
  if [[ "$ASSUME_YES" == "true" ]]; then
    RESET_DEV_ARGS+=(--yes)
  fi
fi
if ! (cd "$REPO_ROOT" && bun run "scripts/reset/reset-dev.ts" "${RESET_DEV_ARGS[@]+"${RESET_DEV_ARGS[@]}"}"); then
  err "Stage 1 (reset-dev.ts) FAILED — aborting reset-all.sh"
  exit 1
fi
log "Stage 1 complete."

# ----- 2. purge-temporal.sh (Temporal workflow/history/task-queue state) -----
# Note: purge-temporal.sh has no --apply flag — its default action IS the
# purge; --dry-run is the only mode flag it understands.

banner "2/4 purge-temporal.sh — Temporal workflow/history state"
PURGE_TEMPORAL_ARGS=(purge)
if [[ "$DRY_RUN" == "true" ]]; then
  PURGE_TEMPORAL_ARGS+=(--dry-run)
fi
PURGE_TEMPORAL_ARGS+=("${YES_FLAG[@]+"${YES_FLAG[@]}"}")
if ! "${SCRIPT_DIR}/purge-temporal.sh" "${PURGE_TEMPORAL_ARGS[@]}"; then
  err "Stage 2 (purge-temporal.sh) FAILED — aborting reset-all.sh"
  exit 1
fi
log "Stage 2 complete."

# ----- 3. reset-tenant.sh (tenant resource definitions + tracking traces) ----

banner "3/4 reset-tenant.sh — tenant definitions + tracking traces"
if ! "${SCRIPT_DIR}/reset-tenant.sh" "$MODE_FLAG" "${YES_FLAG[@]+"${YES_FLAG[@]}"}"; then
  err "Stage 3 (reset-tenant.sh) FAILED — aborting reset-all.sh"
  exit 1
fi
log "Stage 3 complete."

# ----- 4. purge-circuit-breakers.sh (Redis cb:* breaker state) ---------------
# Note: purge-circuit-breakers.sh's default subcommand ("purge") mutates;
# pass its own --dry-run flag (count-only, no UNLINK) to stay consistent
# with the rest of this orchestrator's dry-run-by-default behavior.

banner "4/4 purge-circuit-breakers.sh — Redis circuit-breaker state"
PURGE_CB_ARGS=(purge)
if [[ "$DRY_RUN" == "true" ]]; then
  PURGE_CB_ARGS+=(--dry-run)
fi
PURGE_CB_ARGS+=("${YES_FLAG[@]+"${YES_FLAG[@]}"}")
if ! "${SCRIPT_DIR}/purge-circuit-breakers.sh" "${PURGE_CB_ARGS[@]}"; then
  err "Stage 4 (purge-circuit-breakers.sh) FAILED — aborting reset-all.sh"
  exit 1
fi
log "Stage 4 complete."

banner "reset-all.sh complete"
log "All 4 stages finished successfully."
