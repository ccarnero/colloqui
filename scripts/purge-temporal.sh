#!/usr/bin/env bash
# purge-temporal.sh — TRUNCATE Temporal workflow state in postgres-temporal
# AND `executions_visibility` in postgres-temporal-visibility WITHOUT
# dropping any database, schema, or registered namespace.
#
# Use case: between stress runs you want a clean slate (no Running, no
# pending tasks, no visibility rows) without paying the cost of a full
# DB recreate (~2–4 min for auto-setup to re-apply v1.28.4 schema +
# re-register the `default` namespace + bootstrap NUM_HISTORY_SHARDS=16).
# Truncating the data tables drops it to ~5–10s end-to-end.
#
# Topology note (2026-05-22 split — see
# `DOCS/RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md`): the visibility datasource
# now lives on its OWN CNPG cluster (`postgres-temporal-visibility`,
# primary pod `postgres-temporal-visibility-1`). The workflow-state
# datasource remains on `postgres-temporal` (primary pod
# `postgres-temporal-1`). This script targets BOTH pods. Legacy
# single-cluster setups (everything on `postgres-temporal-1`) can still
# be purged by passing `--vis-pg-pod=postgres-temporal-1`.
#
# What it does:
#   1. Scales every Temporal role Deployment (`temporal-frontend`,
#      `temporal-history`, `temporal-matching`, `temporal-worker` —
#      post-HA-migration topology, see
#      `DOCS/RUNBOOK-TEMPORAL-HA-MIGRATION.md`) to 0 so no in-flight
#      writer is holding row locks while we TRUNCATE (TRUNCATE takes
#      AccessExclusiveLock; an active history pod would deadlock the
#      script). Each Deployment's original replica count is captured
#      FIRST so we can restore each one independently at the end.
#   2. Waits for every temporal pod (all 4 roles) to terminate (otherwise
#      the locks from a draining shard owner can survive long enough to
#      block).
#   3. Connects to each CNPG primary as the `postgres` local-socket
#      superuser (peer auth via `kubectl exec`, works even with
#      `enableSuperuserAccess: false`) and runs a single `TRUNCATE ...
#      RESTART IDENTITY` per DB:
#        - workflow-state tables on `postgres-temporal-1` / `temporal`
#        - `executions_visibility` on `postgres-temporal-visibility-1`
#          / `temporal_visibility`
#   4. Prints row counts before/after for the most relevant tables so
#      you have a visual confirmation that the wipe landed.
#   5. Restores the deployment to its original replica count and waits
#      for it to roll fully Ready (auto-setup is a no-op on a clean
#      schema, so the second start is fast).
#
# What it preserves (NEVER touched):
#   - namespaces, namespace_metadata
#   - cluster_metadata, cluster_metadata_info
#   - schema_version, schema_update_history                (BOTH clusters)
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
#   --pg-pod=NAME        CNPG primary pod for workflow state
#                          (default: postgres-temporal-1)
#   --pg-user=USER       postgres role on the workflow-state cluster
#                          (default: postgres — local peer-auth role
#                          ships with CNPG and bypasses the per-DB ACL
#                          dance)
#   --vis-pg-pod=NAME    CNPG primary pod for the visibility cluster
#                          (default: postgres-temporal-visibility-1;
#                          pass `postgres-temporal-1` for legacy
#                          single-cluster topologies)
#   --vis-pg-user=USER   postgres role on the visibility cluster
#                          (default: postgres)
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
#   0  purge succeeded (data wiped, every role Deployment back to its
#      prior replica count)
#   1  purge failed somewhere; one or more role Deployments may be at
#      0 replicas — re-run
#      `kubectl -n <ns> scale deploy/temporal-{frontend,history,matching,worker} --replicas=N`
#      to recover
#   2  bad input / preflight failed before any mutation

set -euo pipefail

# ----- defaults --------------------------------------------------------------

DEFAULT_NAMESPACE="support-services-dev"
# Post-HA-migration the single `temporal` Deployment was split into 4
# role-specific Deployments. Hardcoded list because the purge flow has
# to scale ALL of them down before TRUNCATE (otherwise the remaining
# role would hold row locks). Order matters: roll history last in the
# scale-up so the frontend has a ring to discover when it boots.
TEMPORAL_DEPLOYMENTS=(
  temporal-frontend
  temporal-history
  temporal-matching
  temporal-worker
)
DEFAULT_PG_POD="postgres-temporal-1"
DEFAULT_PG_USER="postgres"
# Visibility moved to its own CNPG cluster on 2026-05-22 (see
# RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md). Default targets the dedicated
# primary; legacy collapsed-cluster setups can override with
# `--vis-pg-pod=postgres-temporal-1`.
DEFAULT_VIS_PG_POD="postgres-temporal-visibility-1"
DEFAULT_VIS_PG_USER="postgres"
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
  --pg-pod         ${DEFAULT_PG_POD}            (workflow-state cluster)
  --pg-user        ${DEFAULT_PG_USER}
  --vis-pg-pod     ${DEFAULT_VIS_PG_POD}  (visibility cluster)
  --vis-pg-user    ${DEFAULT_VIS_PG_USER}
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

  # Legacy single-cluster topology (visibility still on postgres-temporal-1):
  ./scripts/purge-temporal.sh --vis-pg-pod=postgres-temporal-1

Behavior:
  purge   Captures current replica count for each Temporal role
          Deployment (frontend, history, matching, worker), scales all
          of them to 0, waits for every pod to terminate, runs one
          TRUNCATE statement per DB: workflow-state tables on the
          'temporal' DB ('postgres-temporal-1') and
          'executions_visibility' on 'temporal_visibility'
          ('postgres-temporal-visibility-1'), then scales each role
          back to its prior replica count and waits for Ready.
          Namespaces, schema_version, and cluster_metadata on both
          clusters are NEVER touched, so the schema bootstrap Job
          (`temporal-schema-setup-<version>`) becomes a no-op on the
          next reapply.
  counts  Read-only. Prints row counts for the workflow-state tables on
          the primary cluster and 'executions_visibility' on the
          visibility cluster. Useful as a before/after sanity check.
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

ensure_deployments_exist() {
  local missing=()
  for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
    if ! "${KCTL[@]}" -n "$NAMESPACE" get deploy "$d" >/dev/null 2>&1; then
      missing+=("$d")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    err "Temporal role Deployments not found in ${NAMESPACE}: ${missing[*]}"
    err "  Hint: post-HA-migration the cluster runs 4 Deployments"
    err "        (frontend, history, matching, worker). If you are on"
    err "        the legacy single-Deployment topology, pin to the old"
    err "        purge-temporal.sh revision tagged pre-HA-migration."
    exit 2
  fi
}

ensure_pg_pod_exists() {
  if ! "${KCTL[@]}" -n "$NAMESPACE" get pod "$PG_POD" >/dev/null 2>&1; then
    err "Postgres pod not found: ${NAMESPACE}/${PG_POD}"
    exit 2
  fi
}

# Checked separately so the error message points at the correct pod
# when only the visibility cluster is missing (common during partial
# cutovers — e.g. workflow cluster came up but the visibility CNPG is
# still bootstrapping).
ensure_vis_pg_pod_exists() {
  if [[ "$VIS_PG_POD" == "$PG_POD" ]]; then
    return 0
  fi
  if ! "${KCTL[@]}" -n "$NAMESPACE" get pod "$VIS_PG_POD" >/dev/null 2>&1; then
    err "Visibility Postgres pod not found: ${NAMESPACE}/${VIS_PG_POD}"
    err "  Hint: pass --vis-pg-pod=postgres-temporal-1 for legacy"
    err "        single-cluster setups; see RUNBOOK-TEMPORAL-VISIBILITY-SPLIT.md."
    exit 2
  fi
}

# ----- arg parsing ----------------------------------------------------------

parse_flags() {
  NAMESPACE="$DEFAULT_NAMESPACE"
  PG_POD="$DEFAULT_PG_POD"
  PG_USER="$DEFAULT_PG_USER"
  VIS_PG_POD="$DEFAULT_VIS_PG_POD"
  VIS_PG_USER="$DEFAULT_VIS_PG_USER"
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
      --pg-pod=*)         PG_POD="${arg#*=}" ;;
      --pg-user=*)        PG_USER="${arg#*=}" ;;
      --vis-pg-pod=*)     VIS_PG_POD="${arg#*=}" ;;
      --vis-pg-user=*)    VIS_PG_USER="${arg#*=}" ;;
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

# Runs psql inside an arbitrary CNPG pod (workflow OR visibility cluster
# — caller supplies pod + user). We pipe SQL via stdin so we don't have
# to shell-quote big multi-line statements. `-v ON_ERROR_STOP=1` makes
# psql exit non-zero on the FIRST error in a transaction script instead
# of continuing past it (which would leave us with a half-wiped DB).
#
# Usage: psql_exec <pod> <user> <db>   (SQL on stdin)
psql_exec() {
  local pod=$1
  local user=$2
  local target_db=$3
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] kubectl exec ${pod} -- psql -U ${user} -d ${target_db}  <<<  (stdin)"
    cat
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" exec -i "$pod" -c postgres -- \
    psql -U "$user" -d "$target_db" -v ON_ERROR_STOP=1
}

# Counts rows in a list of tables on a specific (pod, user, db) tuple.
# UNION ALL over the whole list is one round-trip; we use COUNT(*)
# (exact) instead of `pg_class.reltuples` because the user wants exact
# numbers in the before/after diff, not estimates.
#
# Usage: counts_for_tables <pod> <user> <db> <table>...
counts_for_tables() {
  local pod=$1
  local user=$2
  local target_db=$3
  shift 3
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

  "${KCTL[@]}" -n "$NAMESPACE" exec -i "$pod" -c postgres -- \
    psql -U "$user" -d "$target_db" -v ON_ERROR_STOP=1 \
    -At -F $'\t' -c "$sql"
}

print_counts_report() {
  local label=$1

  printf '\n%s\n' "==== ${label} ===="

  printf '\n[%s on %s]\n' "$DB" "$PG_POD"
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
  done < <(counts_for_tables "$PG_POD" "$PG_USER" "$DB" "${primary_tables[@]}")

  printf '\n[%s on %s]\n' "$VIS_DB" "$VIS_PG_POD"
  printf '%-40s %12s\n' "table" "rows"
  printf '%-40s %12s\n' "----------------------------------------" "------------"
  while IFS=$'\t' read -r tbl rows; do
    [[ -z "$tbl" ]] && continue
    printf '%-40s %12s\n' "$tbl" "$rows"
  done < <(counts_for_tables "$VIS_PG_POD" "$VIS_PG_USER" "$VIS_DB" "${VISIBILITY_TABLES[@]}")
  printf '\n'
}

# ----- scaling --------------------------------------------------------------
#
# All scaling helpers take a deploy name as argument so the cmd_purge
# flow can iterate over TEMPORAL_DEPLOYMENTS without duplicating
# logic per role.

current_replicas() {
  local deploy=$1
  "${KCTL[@]}" -n "$NAMESPACE" get deploy "$deploy" \
    -o jsonpath='{.spec.replicas}' 2>/dev/null
}

scale_deployment() {
  local deploy=$1
  local replicas=$2
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] kubectl scale deploy/${deploy} --replicas=${replicas}"
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" scale deploy "$deploy" \
    --replicas="$replicas" >/dev/null
}

# Blocks until the deployment has 0 ready replicas AND 0 pods left
# (matching the deploy's selector). We wait on the pods directly
# because `kubectl rollout status` returns success on `--replicas=0`
# the moment the spec changes — the actual pod termination is what
# we care about for the lock-acquisition story.
wait_for_zero_pods() {
  local deploy=$1
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] wait for pods of deploy/${deploy} to terminate"
    return 0
  fi

  local selector
  selector=$("${KCTL[@]}" -n "$NAMESPACE" get deploy "$deploy" \
    -o jsonpath='{.spec.selector.matchLabels}' \
    | sed -e 's/[{}"]//g' -e 's/:/=/g' -e 's/,/,/g')

  log "Waiting for deploy/${deploy} pods to terminate (selector=${selector})"

  local deadline=$((SECONDS + SCALE_TIMEOUT))
  while (( SECONDS < deadline )); do
    local count
    count=$("${KCTL[@]}" -n "$NAMESPACE" get pods \
      -l "$selector" --no-headers 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" == "0" ]]; then
      log "All ${deploy} pods terminated."
      return 0
    fi
    info "${deploy}: still ${count} pod(s) terminating..."
    sleep 2
  done

  err "Timed out waiting for pods of deploy/${deploy} to terminate"
  return 1
}

wait_for_rollout() {
  local deploy=$1
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] kubectl rollout status deploy/${deploy}"
    return 0
  fi
  "${KCTL[@]}" -n "$NAMESPACE" rollout status deploy "$deploy" \
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
  log "Truncating workflow tables in DB=${DB} on pod=${PG_POD}"
  build_truncate_sql_primary | psql_exec "$PG_POD" "$PG_USER" "$DB"

  log "Truncating visibility tables in DB=${VIS_DB} on pod=${VIS_PG_POD}"
  build_truncate_sql_visibility | psql_exec "$VIS_PG_POD" "$VIS_PG_USER" "$VIS_DB"
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
  - Scale ${NAMESPACE}/deploy/{$(IFS=,; echo "${TEMPORAL_DEPLOYMENTS[*]}")}
      to 0 (and back to each one's current value).
  - TRUNCATE ${primary_count} table(s) in DB=${DB} on pod=${PG_POD}
      (workflow / history / tasks / shards).
  - TRUNCATE ${#VISIBILITY_TABLES[@]} table(s) in DB=${VIS_DB} on pod=${VIS_PG_POD}
      (executions_visibility).
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
  ensure_deployments_exist
  ensure_pg_pod_exists
  ensure_vis_pg_pod_exists

  # Capture every role's current replica count BEFORE we touch
  # anything. Stored in a bash associative array indexed by deployment
  # name so each role can be restored to its own original value (the
  # 4 roles may have different replica counts per overlay).
  declare -A ORIGINAL_REPLICAS=()
  local d
  for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
    local r
    r=$(current_replicas "$d")
    if [[ -z "$r" ]]; then
      err "Could not read current replica count for deploy/${d}"
      exit 1
    fi
    ORIGINAL_REPLICAS["$d"]="$r"
    log "Current replicas of deploy/${d}: ${r}"
  done

  # Print BEFORE counts first so the operator sees how much state is
  # actually at stake before typing 'yes'. This is one extra read-only
  # SQL trip; the user-facing latency is dominated by the truncate
  # below regardless.
  print_counts_report "BEFORE"

  confirm

  # 1. Scale every role down so we don't fight for AccessExclusiveLock.
  #    Scale-down is non-blocking (kubectl scale returns immediately);
  #    the actual lock-safety wait is in `wait_for_zero_pods` below.
  if [[ "$SKIP_SCALE" == "false" ]]; then
    for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
      log "Scaling deploy/${d} to 0"
      scale_deployment "$d" 0
    done
    # Wait per-role for pods to terminate. Sequential because the
    # output is more readable; total cost is bounded by the slowest
    # role's terminationGracePeriodSeconds (60s on history, 30s on
    # the rest — see deployment-*.yaml).
    for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
      wait_for_zero_pods "$d" || {
        err "Aborting before truncate — ${d} pods did not terminate"
        exit 1
      }
    done
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
      for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
        scale_deployment "$d" "${ORIGINAL_REPLICAS[$d]}" || true
      done
    fi
    exit 1
  fi

  # 3. Scale back up unless the operator asked us to keep it down.
  if [[ "$SKIP_RESTART" == "true" ]]; then
    info "Skipping scale-up (--skip-restart). All role Deployments stay at 0 replicas."
  elif [[ "$SKIP_SCALE" == "true" ]]; then
    info "Skipping scale-up because scale-down was skipped (--skip-scale)."
  else
    # Scale every role back to its captured count, then await Ready
    # per role. Sequential rollout-wait keeps the output ordered;
    # parallel `wait_for_rollout &` would interleave the kubectl
    # spinners.
    for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
      log "Scaling deploy/${d} back to ${ORIGINAL_REPLICAS[$d]}"
      scale_deployment "$d" "${ORIGINAL_REPLICAS[$d]}"
    done
    for d in "${TEMPORAL_DEPLOYMENTS[@]}"; do
      wait_for_rollout "$d" || {
        err "deploy/${d} did not become Ready in ${SCALE_TIMEOUT}s"
        exit 1
      }
    done
  fi

  print_counts_report "AFTER"

  log "Purge complete."
}

cmd_counts() {
  ensure_namespace_exists "$NAMESPACE"
  ensure_pg_pod_exists
  ensure_vis_pg_pod_exists
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
