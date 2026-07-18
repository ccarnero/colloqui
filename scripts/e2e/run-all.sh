#!/usr/bin/env bash
set -euo pipefail

# run-all.sh — one-shot orchestrator for the full e2e suite.
#
# Runs, in order:
#   1. manifest-apply.sh    (declarative provisioning: plan/apply/re-plan/
#                             re-apply round trip, T06 KB documents, the T09
#                             full showcase manifest via the real SDK, and
#                             three fail-loud negative-plan cases)
#   2. http-workflow.sh     (runtime chain: webhook -> trigger -> workflow ->
#                             Temporal execution -> tracking, provisioned via
#                             an IntegrationManifest)
#   3. connector-invoke.sh  (sync/async connector invoke, cache, webhook
#                             receiver, tracking assertions)
#
# See scripts/e2e/README.md for what each stage covers and rough runtimes.
#
# Flags:
#   --only <name>   run ONLY the named stage (manifest-apply | http-workflow |
#                     connector-invoke), skipping the other two
#   --skip <name>   run every stage EXCEPT the named one (repeatable)
#
# Exit codes:
#   0  every stage that ran succeeded
#   1  a stage failed — aborts before running later stages
#   2  bad input (unknown flag/stage name)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
banner() { printf '\n=================== %s ===================\n\n' "$*"; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [--only <name>] [--skip <name>]...

Stages (in run order): manifest-apply, http-workflow, connector-invoke.

Examples:
  ./scripts/e2e/run-all.sh                        # run all three stages
  ./scripts/e2e/run-all.sh --only connector-invoke # run just one stage
  ./scripts/e2e/run-all.sh --skip http-workflow    # run the other two
EOF
}

ALL_STAGES=(manifest-apply http-workflow connector-invoke)
ONLY_STAGE=""
SKIP_STAGES=()

is_known_stage() {
  local name="$1"
  for s in "${ALL_STAGES[@]}"; do
    [[ "$s" == "$name" ]] && return 0
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      ONLY_STAGE="${2:-}"
      if [[ -z "$ONLY_STAGE" ]] || ! is_known_stage "$ONLY_STAGE"; then
        err "Unknown or missing --only stage: '${ONLY_STAGE}' (expected one of: ${ALL_STAGES[*]})"
        exit 2
      fi
      shift 2
      ;;
    --skip)
      SKIP_STAGE="${2:-}"
      if [[ -z "$SKIP_STAGE" ]] || ! is_known_stage "$SKIP_STAGE"; then
        err "Unknown or missing --skip stage: '${SKIP_STAGE}' (expected one of: ${ALL_STAGES[*]})"
        exit 2
      fi
      SKIP_STAGES+=("$SKIP_STAGE")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "Unknown flag: $1"
      usage
      exit 2
      ;;
  esac
done

if [[ -n "$ONLY_STAGE" && ${#SKIP_STAGES[@]} -gt 0 ]]; then
  err "--only and --skip are mutually exclusive"
  exit 2
fi

should_run() {
  local name="$1"
  if [[ -n "$ONLY_STAGE" ]]; then
    [[ "$name" == "$ONLY_STAGE" ]]
    return
  fi
  for s in "${SKIP_STAGES[@]+"${SKIP_STAGES[@]}"}"; do
    [[ "$s" == "$name" ]] && return 1
  done
  return 0
}

STAGE_SCRIPT_manifest_apply="${SCRIPT_DIR}/manifest-apply.sh"
STAGE_SCRIPT_http_workflow="${SCRIPT_DIR}/http-workflow.sh"
STAGE_SCRIPT_connector_invoke="${SCRIPT_DIR}/connector-invoke.sh"

RESULTS=()
STAGE_NUM=0
TOTAL_STAGES=0
for s in "${ALL_STAGES[@]}"; do
  should_run "$s" && TOTAL_STAGES=$((TOTAL_STAGES + 1))
done

run_stage() {
  local name="$1"
  local script_path="$2"
  STAGE_NUM=$((STAGE_NUM + 1))
  banner "${STAGE_NUM}/${TOTAL_STAGES} ${name}"
  local start=$SECONDS
  if "$script_path"; then
    local elapsed=$((SECONDS - start))
    log "${name} PASSED in ~${elapsed}s"
    RESULTS+=("PASS  ${name}  (~${elapsed}s)")
  else
    local elapsed=$((SECONDS - start))
    err "${name} FAILED after ~${elapsed}s — aborting run-all.sh"
    RESULTS+=("FAIL  ${name}  (~${elapsed}s)")
    print_summary
    exit 1
  fi
}

print_summary() {
  banner "run-all.sh summary"
  for r in "${RESULTS[@]+"${RESULTS[@]}"}"; do
    echo "  $r"
  done
}

should_run manifest-apply && run_stage "manifest-apply" "$STAGE_SCRIPT_manifest_apply"
should_run http-workflow && run_stage "http-workflow" "$STAGE_SCRIPT_http_workflow"
should_run connector-invoke && run_stage "connector-invoke" "$STAGE_SCRIPT_connector_invoke"

print_summary
log "All requested stages finished successfully."
