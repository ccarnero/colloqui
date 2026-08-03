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
# An optional 4th stage, teardown-regression, is NOT part of this default
# sequence (see scripts/e2e/README.md for why): it deliberately provisions
# real resources via manifest-apply.sh, then kills its SDK driver mid-run to
# prove the teardown sweep survives a crash, so it is slower and more
# invasive than the other three. Run it explicitly via
# `--only teardown-regression`.
#
# NOT ORCHESTRATED AT ALL: scripts/e2e/long-agent-execution.sh. It is a
# standalone e2e (long-running agent executions) with its own env-gated
# prerequisite (`AGENT_TEST_DELAY_ENABLED` on agent-ai-service) and no
# stage entry here — run it directly.
#
# See scripts/e2e/README.md for what each stage covers and rough runtimes.
#
# Flags:
#   --only <name>   run ONLY the named stage (manifest-apply | http-workflow |
#                     connector-invoke | teardown-regression), skipping the
#                     others. teardown-regression is ONLY runnable via
#                     --only — it never runs as part of the default sequence.
#   --skip <name>   run every default stage EXCEPT the named one (repeatable;
#                     not applicable to teardown-regression, which is never in
#                     the default sequence to begin with)
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

Stages (in default run order): manifest-apply, http-workflow, connector-invoke.

Optional (--only ONLY, never in the default sequence): teardown-regression
  — provisions real resources then kills the SDK driver mid-run to prove
  manifest-apply.sh's teardown sweep survives a crash. See
  scripts/e2e/README.md.

Examples:
  ./scripts/e2e/run-all.sh                          # run all three default stages
  ./scripts/e2e/run-all.sh --only connector-invoke   # run just one stage
  ./scripts/e2e/run-all.sh --skip http-workflow      # run the other two
  ./scripts/e2e/run-all.sh --only teardown-regression # the optional 4th stage
EOF
}

ALL_STAGES=(manifest-apply http-workflow connector-invoke)
OPTIONAL_STAGES=(teardown-regression)
ONLY_STAGE=""
SKIP_STAGES=()

is_known_stage() {
  local name="$1"
  for s in "${ALL_STAGES[@]}" "${OPTIONAL_STAGES[@]}"; do
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

is_optional_stage() {
  local name="$1"
  for o in "${OPTIONAL_STAGES[@]}"; do
    [[ "$o" == "$name" ]] && return 0
  done
  return 1
}

should_run() {
  local name="$1"
  if [[ -n "$ONLY_STAGE" ]]; then
    [[ "$name" == "$ONLY_STAGE" ]]
    return
  fi
  # Optional stages (teardown-regression) NEVER run as part of the default
  # sequence — only when explicitly selected via --only above.
  is_optional_stage "$name" && return 1
  for s in "${SKIP_STAGES[@]+"${SKIP_STAGES[@]}"}"; do
    [[ "$s" == "$name" ]] && return 1
  done
  return 0
}

STAGE_SCRIPT_manifest_apply="${SCRIPT_DIR}/manifest-apply.sh"
STAGE_SCRIPT_http_workflow="${SCRIPT_DIR}/http-workflow.sh"
STAGE_SCRIPT_connector_invoke="${SCRIPT_DIR}/connector-invoke.sh"
STAGE_SCRIPT_teardown_regression="${SCRIPT_DIR}/teardown-regression.sh"

RESULTS=()
STAGE_NUM=0
TOTAL_STAGES=0
for s in "${ALL_STAGES[@]}" "${OPTIONAL_STAGES[@]}"; do
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
should_run teardown-regression && run_stage "teardown-regression" "$STAGE_SCRIPT_teardown_regression"

print_summary
log "All requested stages finished successfully."
