#!/usr/bin/env bash
# purge-temporal.sh — TRUNCATE Temporal workflow state in postgres-temporal
# WITHOUT dropping the database, the schema, or the registered namespaces.
#
# Use case: between stress runs you want a clean slate (no Running, no
# pending tasks, no visibility rows) without paying the cost of a full
# DB recreate (~2–4 min for auto-setup to re-apply v1.28.4 schema +
# re-register the `default` namespace + bootstrap NUM_HISTORY_SHARDS=16).
# Truncating the data tables drops it to ~5–10s end-to-end.
#
# What it does:
#   1. Scales the `temporal` Deployment to 0 so no in-flight writer is
#      holding row locks while we TRUNCATE (TRUNCATE takes
#      AccessExclusiveLock; an active history pod would deadlock the
#      script). The original replica count is captured FIRST so we can
#      restore it at the end.
#   2. Waits for every temporal pod to terminate (otherwise the locks
#      from a draining shard owner can survive long enough to block).
#   3. Connects to the CNPG primary (`postgres-temporal-1`) as the
#      `postgres` superuser and runs a single `TRUNCATE ... RESTART
#      IDENTITY` over every workflow-state table in `temporal` plus
#      `executions_visibility` in `temporal_visibility`.
#   4. Prints row counts before/after for the most relevant tables so
#      you have a visual confirmation that the wipe landed.
#   5. Restores the deployment to its original replica count and waits
#      for it to roll fully Ready (auto-setup is a no-op on a clean
#      schema, so the second start is fast).
#
# What it preserves (NEVER touched):
#   - namespaces, namespace_metadata
#   - cluster_metadata, cluster_metadata_info
#   - schema_version, schema_update_history
#   - nexus_endpoints, nexus_endpoints_partition_status
#   - queue, queue_messages, queues, queue_metadata  (replication / DLQ
#       ack-levels — wiping them is unsafe in HA setups)
#   - cluster_membership                              (auto-managed)
#
# Subcommands:
#   purge   (default) wipe the data; full scale-down → truncate → scale-up cycle
#   counts            read-only: print row counts in workflow-data tables
#
# Flags:
#   --namespace=NS       k8s ns where temporal lives
#                          (default: support-services-dev)
#   --deployment=NAME    temporal deployment name (default: temporal)
#   --pg-pod=NAME        CNPG primary pod (default: postgres-temporal-1)
#   --pg-user=USER       postgres role (default: postgres — superuser
#                          ships with CNPG and bypasses the per-DB ACL
#                          dance)
#   --db=NAME            primary DB (default: temporal)
#   --visibility-db=NAME visibility DB (default: temporal_visibility)
#   --skip-scale         do NOT scale temporal down/up (use ONLY when
#                          temporal is already at 0 replicas)
#   --skip-restart       wipe + leave temporal at 0 replicas
#   --keep-task-queues   skip truncating task_queues / task_queue_user_data /
#                          build_id_to_task_queue (preserves worker
#                          versioning rules; rarely needed)
#   --dry-run            print the SQL plus the kubectl commands without
#                          executing anything mutating
#   --yes / -y           skip the interactive confirmation
#   --context=CTX        kubectl context (default: yoizen-arch
#                          or KUBECTL_CONTEXT)
#
# Exit codes:
#   0  purge succeeded (data wiped, deployment back to its prior replica count)
#   1  purge failed somewhere; deployment may be at 0 replicas — re-run
#      `kubectl scale deploy/temporal --replicas=N` to recover
#   2  bad input / preflight failed before any mutation

set -euo pipefail

# ----- defaults --------------------------------------------------------------

DEFAULT_NAMESPACE="support-services-dev"
DEFAULT_DEPLOY="temporal"
DEFAULT_PG_POD="postgres-temporal-1"
DEFAULT_PG_USER="postgres"
DEFAULT_DB="temporal"
DEFAULT_VIS_DB="temporal_visibility"
DEFAULT_CONTEXT="${KUBECTL_CONTEXT:-yoizen-arch}"

# Per-resource readiness timeout for `kubectl wait` and the rollback
# rollout. Auto-setup against an existing schema is fast (<30s); 180s
# leaves plenty of slack on a busy minikube.
SCALE_TIMEOUT=180

# ----- color logging --------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
info() { echo -e "${BLUE}[ ... ]${NC} $*"; }

# ----- table inventory ------------------------------------------------------
#
# Hardcoded against temporalio/auto-setup:1.28.4 schema (verified live
# against `pg_tables` on 2026-05-07). Splitting by category keeps the
# diff readable when a future Temporal release adds a new table.

# Workflow execution mutable state.
WORKFLOW_TABLES=(
  shards
  executions
  current_executions
  buffered_events
  signals_requested_sets
  activity_info_maps
  timer_info_maps
  child_execution_info_maps
  request_cancel_info_maps
  signal_info_maps
  chasm_node_maps
)

# Event history (immutable per execution, but we wipe it because the
# parent workflow row is also gone).
HISTORY_TABLES=(
  history_node
  history_tree
)

# Per-shard task queues (transfer / timer / visibility / replication
# / history archival). Wiping these prevents the matching service from
# replaying old tasks against truncated executions on next start.
PERSHARD_TASK_TABLES=(
  transfer_tasks
  timer_tasks
  visibility_tasks
  replication_tasks
  replication_tasks_dlq
  history_immediate_tasks
  history_scheduled_tasks
)

# Matching-service task queue rows. `task_queue_user_data` and
# `build_id_to_task_queue` hold worker-versioning state; they regenerate
# automatically but a paranoid caller can skip them with --keep-task-queues.
TASKQ_CORE_TABLES=(
  tasks
  task_queues
)
TASKQ_VERSIONING_TABLES=(
  task_queue_user_data
  build_id_to_task_queue
)

# Visibility DB. Visibility rows are denormalized projections of
# `executions` so they MUST be wiped together to avoid orphans showing
# up in the Temporal Web UI / List Workflows.
VISIBILITY_TABLES=(
  executions_visibility
)

# ----- usage ----------------------------------------------------------------

usage() {
  cat <<EOF
Usage:
  $(basename "$0") purge  [flags]
  $(basename "$0") counts [flags]

Defaults:
  --namespace      ${DEFAULT_NAMESPACE}
  --deployment     ${DEFAULT_DEPLOY}
  --pg-pod         ${DEFAULT_PG_POD}
  --pg-user        ${DEFAULT_PG_USER}
  --db             ${DEFAULT_DB}
  --visibility-db  ${DEFAULT_VIS_DB}
  --context        ${DEFAULT_CONTEXT}

Examples:
  # Standard between-runs reset (asks for confirmation):
  ./scripts/purge-temporal.sh

  # Non-interactive (CI / scripted):
  ./scripts/purge-temporal.sh --yes

  # Dry-run (prints SQL and kubectl commands):
  ./scripts/purge-temporal.sh --dry-run

  # Inspect current row counts without touching anything:
  ./scripts/purge-temporal.sh counts

  # Wipe but leave temporal at 0 replicas (you'll start it later):
  ./scripts/purge-temporal.sh --skip-restart

  # Wipe and DON'T touch task_queue_user_data (preserve versioning rules):
  ./scripts/purge-temporal.sh --keep-task-queues

Behavior:
  purge   Captures current temporal Deployment replica count, scales to
          0, waits for pods to terminate, runs one TRUNCATE statement
          across every workflow-state table in 'temporal' plus
          'executions_visibility' in 'temporal_visibility', then scales
          temporal back to its prior replicas and waits for Ready.
          Namespaces, schema_version, and cluster_metadata are NEVER
          touched, so the auto-setup container does not redo schema
          migrations on the next start.
  counts  Read-only. Prints row counts for the workflow-state tables in
          both DBs. Useful as a before/after sanity check.
EOF
}

# ----- preflight ------------------------------------------------------------

require_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 2
  fi
}

KCTL=()
make_kctl() {
  KCTL=(kubectl --context "$CONTEXT")
}

ensure_namespace_exists() {
  local ns=$1
  if ! "${KCTL[@]}" get ns "$ns" >/dev/null 2>&1; then
    err "Namespace not found: $ns"
    exit 2
  fi
}

ensure_deployment_exists() {
  if ! "${KCTL[@]}" -n "$NAMESPACE" get deploy "$DEPLOYMENT" >/dev/null 2>&1; then
    err "Deployment not found: ${NAMESPACE}/${DEPLOYMENT}"
    exit 2
  fi
}

ensure_pg_pod_exists() {
  if ! "${KCTL[@]}" -n "$NAMESPACE" get pod "$PG_POD" >/dev/null 2>&1; then
    err "Postgres pod not found: ${NAMESPACE}/${PG_POD}"
    exit 2
  fi
}

# ----- arg parsing ----------------------------------------------------------

parse_flags() {
  NAMESPACE="$DEFAULT_NAMESPACE"
  DEPLOYMENT="$DEFAULT_DEPLOY"
  PG_POD="$DEFAULT_PG_POD"
  PG_USER="$DEFAULT_PG_USER"
  DB="$DEFAULT_DB"
  VIS_DB="$DEFAULT_VIS_DB"
  CONTEXT="$DEFAULT_CONTEXT"
  SKIP_SCALE=false
  SKIP_RESTART=false
  KEEP_TASK_QUEUES=false
  DRY_RUN=false
  ASSUME_YES=false

  for arg in "$@"; do
    case "$arg" in
      --namespace=*)      NAMESPACE="${arg#*=}" ;;
      --deployment=*)     DEPLOYMENT="${arg#*=}" ;;
      --pg-pod=*)         PG_POD="${arg#*=}" ;;
      --pg-user=*)        PG_USER="${arg#*=}" ;;
      --db=*)             DB="${arg#*=}" ;;
      --visibility-db=*)  VIS_DB="${arg#*=}" ;;
      --context=*)        CONTEXT="${arg#*=}" ;;
      --skip-scale)       SKIP_SCALE=true ;;
      --skip-restart)     SKIP_RESTART=true ;;
      --keep-task-queues) KEEP_TASK_QUEUES=true ;;
      --dry-run)          DRY_RUN=true ;;
      -y|--yes)           ASSUME_YES=true ;;
      -h|--help)          usage; exit 0 ;;
      *)
        err "Unknown flag: $arg"
        usage
        exit 2
        ;;
    esac
  done
}

# Build the final list of tables to truncate in the primary DB based on
# the flags. Returned via `printf '%s\n'` so the caller can iterate or
# join. Doing this once means the SQL builder + counts function stay in
# sync without divergent table sets.
build_workflow_truncate_list() {
  printf '%s\n' "${WORKFLOW_TABLES[@]}"
  printf '%s\n' "${HISTORY_TABLES[@]}"
  printf '%s\n' "${PERSHARD_TASK_TABLES[@]}"
  printf '%s\n' "${TASKQ_CORE_TABLES[@]}"
  if [[ "$KEEP_TASK_QUEUES" == "false" ]]; then
    printf '%s\n' "${TASKQ_VERSIONING_TABLES[@]}"
  fi
}

# ----- psql plumbing --------------------------------------------------------

# Runs psql inside the CNPG primary pod. We pipe SQL via stdin so we
# don't have to shell-quote big multi-line statements. `-v ON_ERROR_STOP=1`
# makes psql exit non-zero on the FIRST error in a transaction script
# instead of continuing past it (which would leave us with a half-wiped
# DB).
psql_exec() {
  local target_db=$1
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] psql -U ${PG_USER} -d ${target_db}  <<<  (stdin)"
    cat
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" exec -i "$PG_POD" -c postgres -- \
    psql -U "$PG_USER" -d "$target_db" -v ON_ERROR_STOP=1
}

# Counts rows in a comma-separated list of tables. UNION ALL over the
# whole list is one round-trip and the planner picks index-only scans
# automatically against `pg_class.reltuples` if needed; we use COUNT(*)
# anyway because the user wants exact numbers, not stats.
counts_for_tables() {
  local target_db=$1
  shift
  local tables=("$@")
  local n=${#tables[@]}
  if [[ $n -eq 0 ]]; then
    return 0
  fi

  # Compose a single SELECT that emits "<table>\t<count>" per row. We
  # build the UNION ALL once instead of N round-trips.
  local sql=""
  local first=true
  for t in "${tables[@]}"; do
    if [[ "$first" == "true" ]]; then
      sql+="SELECT '${t}'::text AS tbl, COUNT(*)::bigint AS rows FROM ${t}"
      first=false
    else
      sql+=" UNION ALL SELECT '${t}'::text, COUNT(*)::bigint FROM ${t}"
    fi
  done
  sql+=" ORDER BY tbl;"

  "${KCTL[@]}" -n "$NAMESPACE" exec -i "$PG_POD" -c postgres -- \
    psql -U "$PG_USER" -d "$target_db" -v ON_ERROR_STOP=1 \
    -At -F $'\t' -c "$sql"
}

print_counts_report() {
  local label=$1

  printf '\n%s\n' "==== ${label} ===="

  printf '\n[%s]\n' "$DB"
  printf '%-40s %12s\n' "table" "rows"
  printf '%-40s %12s\n' "----------------------------------------" "------------"

  # Read each "tbl<TAB>count" line into two fields. We don't sort here
  # — psql already ORDER BY'd.
  local tbl rows
  local primary_tables
  mapfile -t primary_tables < <(build_workflow_truncate_list)
  while IFS=$'\t' read -r tbl rows; do
    [[ -z "$tbl" ]] && continue
    printf '%-40s %12s\n' "$tbl" "$rows"
  done < <(counts_for_tables "$DB" "${primary_tables[@]}")

  printf '\n[%s]\n' "$VIS_DB"
  printf '%-40s %12s\n' "table" "rows"
  printf '%-40s %12s\n' "----------------------------------------" "------------"
  while IFS=$'\t' read -r tbl rows; do
    [[ -z "$tbl" ]] && continue
    printf '%-40s %12s\n' "$tbl" "$rows"
  done < <(counts_for_tables "$VIS_DB" "${VISIBILITY_TABLES[@]}")
  printf '\n'
}

# ----- scaling --------------------------------------------------------------

current_replicas() {
  "${KCTL[@]}" -n "$NAMESPACE" get deploy "$DEPLOYMENT" \
    -o jsonpath='{.spec.replicas}' 2>/dev/null
}

scale_deployment() {
  local replicas=$1
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] kubectl scale deploy/${DEPLOYMENT} --replicas=${replicas}"
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" scale deploy "$DEPLOYMENT" \
    --replicas="$replicas" >/dev/null
}

# Blocks until the deployment has 0 ready replicas AND 0 pods left
# (matching the deploy's selector). We wait on the pods directly
# because `kubectl rollout status` returns success on `--replicas=0`
# the moment the spec changes — the actual pod termination is what
# we care about for the lock-acquisition story.
wait_for_zero_pods() {
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] wait for pods of deploy/${DEPLOYMENT} to terminate"
    return 0
  fi

  local selector
  selector=$("${KCTL[@]}" -n "$NAMESPACE" get deploy "$DEPLOYMENT" \
    -o jsonpath='{.spec.selector.matchLabels}' \
    | sed -e 's/[{}"]//g' -e 's/:/=/g' -e 's/,/,/g')

  log "Waiting for deploy/${DEPLOYMENT} pods to terminate (selector=${selector})"

  local deadline=$((SECONDS + SCALE_TIMEOUT))
  while (( SECONDS < deadline )); do
    local count
    count=$("${KCTL[@]}" -n "$NAMESPACE" get pods \
      -l "$selector" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" == "0" ]]; then
      log "All ${DEPLOYMENT} pods terminated."
      return 0
    fi
    info "Still ${count} pod(s) terminating..."
    sleep 2
  done

  err "Timed out waiting for pods of deploy/${DEPLOYMENT} to terminate"
  return 1
}

wait_for_rollout() {
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] kubectl rollout status deploy/${DEPLOYMENT}"
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" rollout status deploy "$DEPLOYMENT" \
    --timeout="${SCALE_TIMEOUT}s"
}

# ----- truncate -------------------------------------------------------------

# We TRUNCATE every primary-DB table in a SINGLE statement so PostgreSQL
# can take all the AccessExclusiveLocks atomically (one fast lock-set,
# no risk of partial wipes on signal). RESTART IDENTITY resets serial
# counters; CASCADE is intentionally NOT used — we list every table
# explicitly so a future schema addition fails loudly here instead of
# being silently cascaded into.
build_truncate_sql_primary() {
  local tables
  mapfile -t tables < <(build_workflow_truncate_list)

  printf 'BEGIN;\n'
  printf 'TRUNCATE TABLE\n'
  local i=0
  local n=${#tables[@]}
  for t in "${tables[@]}"; do
    i=$((i + 1))
    if (( i < n )); then
      printf '  %s,\n' "$t"
    else
      printf '  %s\n' "$t"
    fi
  done
  printf 'RESTART IDENTITY;\n'
  printf 'COMMIT;\n'
}

build_truncate_sql_visibility() {
  printf 'BEGIN;\n'
  printf 'TRUNCATE TABLE\n'
  local i=0
  local n=${#VISIBILITY_TABLES[@]}
  for t in "${VISIBILITY_TABLES[@]}"; do
    i=$((i + 1))
    if (( i < n )); then
      printf '  %s,\n' "$t"
    else
      printf '  %s\n' "$t"
    fi
  done
  printf 'RESTART IDENTITY;\n'
  printf 'COMMIT;\n'
}

run_truncates() {
  log "Truncating workflow tables in DB=${DB}"
  build_truncate_sql_primary | psql_exec "$DB"

  log "Truncating visibility tables in DB=${VIS_DB}"
  build_truncate_sql_visibility | psql_exec "$VIS_DB"
}

# ----- confirmation ---------------------------------------------------------

confirm() {
  if [[ "$ASSUME_YES" == "true" || "$DRY_RUN" == "true" ]]; then
    return 0
  fi

  local primary_count
  primary_count=$(build_workflow_truncate_list | wc -l | tr -d ' ')

  cat <<EOF

This will:
  - Scale ${NAMESPACE}/deploy/${DEPLOYMENT} to 0 (and back to its current value).
  - TRUNCATE ${primary_count} table(s) in DB=${DB} (workflow / history / tasks / shards).
  - TRUNCATE ${#VISIBILITY_TABLES[@]} table(s) in DB=${VIS_DB} (executions_visibility).
  - PRESERVE: namespaces, schema_*, cluster_metadata*, nexus_*, queue*.

EOF

  read -r -p "Type 'yes' to proceed: " answer
  if [[ "$answer" != "yes" ]]; then
    err "Aborted."
    exit 1
  fi
}

# ----- main flows -----------------------------------------------------------

cmd_purge() {
  ensure_namespace_exists "$NAMESPACE"
  ensure_deployment_exists
  ensure_pg_pod_exists

  local original_replicas
  original_replicas=$(current_replicas)
  if [[ -z "$original_replicas" ]]; then
    err "Could not read current replica count for deploy/${DEPLOYMENT}"
    exit 1
  fi
  log "Current replicas of deploy/${DEPLOYMENT}: ${original_replicas}"

  # Print BEFORE counts first so the operator sees how much state is
  # actually at stake before typing 'yes'. This is one extra read-only
  # SQL trip; the user-facing latency is dominated by the truncate
  # below regardless.
  print_counts_report "BEFORE"

  confirm

  # 1. Scale temporal down so we don't fight for AccessExclusiveLock.
  if [[ "$SKIP_SCALE" == "false" ]]; then
    log "Scaling deploy/${DEPLOYMENT} to 0"
    scale_deployment 0
    wait_for_zero_pods || {
      err "Aborting before truncate — temporal pods did not terminate"
      exit 1
    }
  else
    info "Skipping scale-down (--skip-scale)"
  fi

  # 2. Truncate. If the SQL fails, restore replicas before exiting so
  #    we never leave the operator with a permanently down server.
  local truncate_rc=0
  run_truncates || truncate_rc=$?

  if [[ $truncate_rc -ne 0 ]]; then
    err "TRUNCATE failed (exit ${truncate_rc}); attempting to restore replicas"
    if [[ "$SKIP_SCALE" == "false" && "$SKIP_RESTART" == "false" ]]; then
      scale_deployment "$original_replicas" || true
    fi
    exit 1
  fi

  # 3. Scale back up unless the operator asked us to keep it down.
  if [[ "$SKIP_RESTART" == "true" ]]; then
    info "Skipping scale-up (--skip-restart). deploy/${DEPLOYMENT} stays at 0 replicas."
  elif [[ "$SKIP_SCALE" == "true" ]]; then
    info "Skipping scale-up because scale-down was skipped (--skip-scale)."
  else
    log "Scaling deploy/${DEPLOYMENT} back to ${original_replicas}"
    scale_deployment "$original_replicas"
    wait_for_rollout || {
      err "deploy/${DEPLOYMENT} did not become Ready in ${SCALE_TIMEOUT}s"
      exit 1
    }
  fi

  print_counts_report "AFTER"

  log "Purge complete."
}

cmd_counts() {
  ensure_namespace_exists "$NAMESPACE"
  ensure_pg_pod_exists
  print_counts_report "CURRENT"
}

# ----- entry ----------------------------------------------------------------

main() {
  # Allow flag-first invocation: `./purge-temporal.sh --yes` is the same
  # as `./purge-temporal.sh purge --yes`. Mirrors warmup.sh ergonomics.
  local subcommand
  if [[ $# -lt 1 ]]; then
    subcommand="purge"
  elif [[ "$1" == -* ]]; then
    subcommand="purge"
  else
    subcommand=$1
    shift
  fi

  require_cmd kubectl

  parse_flags "$@"
  make_kctl

  case "$subcommand" in
    purge)          cmd_purge ;;
    counts)         cmd_counts ;;
    -h|--help|help) usage ;;
    *)
      err "Unknown subcommand: $subcommand"
      usage
      exit 2
      ;;
  esac
}

main "$@"
