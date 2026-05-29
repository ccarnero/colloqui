#!/usr/bin/env bash
# Reconcile stale RUNNING rows in Mongo workflow_executions against Temporal.
#
# After a stress run, Mongo may still show RUNNING while Temporal already
# completed those workflows. This script lists candidates and, with --apply,
# updates Mongo when Temporal reports a closed execution.
#
# Usage:
#   ./scripts/reconcile-temporal-mongo-executions.sh              # dry-run
#   ./scripts/reconcile-temporal-mongo-executions.sh --apply      # fix rows
#
# Env:
#   TENANT_NAME          Tenant slug (default: acme)
#   STALE_MINUTES        Age threshold for RUNNING rows (default: 30)
#   SUPPORT_NAMESPACE    Infra namespace (default: support-services-dev)
#   MONGO_POD            StatefulSet pod (default: mongo-platform-0)
#   TEMPORAL_NAMESPACE   Temporal namespace (default: default)
#   TEMPORAL_ADDRESS     gRPC address for admin-tools (default: temporal:7233)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=false
LIMIT="${RECONCILE_LIMIT:-500}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --limit)
      LIMIT="${2:-500}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

TENANT="${TENANT_NAME:-acme}"
DB="tenant_${TENANT}"
NS="${SUPPORT_NAMESPACE:-support-services-dev}"
MONGO_POD="${MONGO_POD:-mongo-platform-0}"
STALE_MINUTES="${STALE_MINUTES:-30}"
TEMPORAL_NS="${TEMPORAL_NAMESPACE:-default}"
TEMPORAL_ADDR="${TEMPORAL_ADDRESS:-temporal.${NS}.svc.cluster.local:7233}"
ADMIN_IMAGE="${TEMPORAL_ADMIN_IMAGE:-temporalio/admin-tools:1.28.4-tctl-1.18.4-cli-1.6.2}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd kubectl
require_cmd jq

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "[reconcile] tenant=${TENANT} db=${DB} stale>${STALE_MINUTES}m limit=${LIMIT} apply=${APPLY}"

kubectl -n "$NS" exec "$MONGO_POD" -c mongo -- mongosh --quiet \
  -u yoizen -p yoizen-dev-password --authenticationDatabase yoizen "$DB" --eval "
const cutoff = new Date(Date.now() - ${STALE_MINUTES} * 60 * 1000);
db.workflow_executions.find(
  { status: 'RUNNING', updated_at: { \$lt: cutoff } },
  { _id: 1, temporal_workflow_id: 1, temporal_run_id: 1, updated_at: 1 }
).limit(${LIMIT}).forEach(doc => print(JSON.stringify(doc)));
" >"$TMP" || {
  echo "[reconcile] mongosh query failed" >&2
  exit 1
}

if [[ ! -s "$TMP" ]]; then
  echo "[reconcile] no stale RUNNING rows found."
  exit 0
fi

STALE_COUNT="$(wc -l <"$TMP" | tr -d ' ')"
echo "[reconcile] found ${STALE_COUNT} stale RUNNING row(s)"

fixed=0
skipped=0
errors=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  exec_id="$(echo "$line" | jq -r '._id')"
  temporal_wf="$(echo "$line" | jq -r '.temporal_workflow_id // empty')"
  temporal_run="$(echo "$line" | jq -r '.temporal_run_id // empty')"
  if [[ -z "$exec_id" || "$exec_id" == "null" ]]; then
    continue
  fi
  if [[ -z "$temporal_wf" || -z "$temporal_run" ]]; then
    skipped=$((skipped + 1))
    echo "[reconcile] skip ${exec_id}: missing temporal_workflow_id/run_id"
    continue
  fi

  describe_out="$(kubectl -n "$NS" run "temporal-describe-$$-$RANDOM" \
    --rm -i --restart=Never \
    --image="$ADMIN_IMAGE" \
    --env="TEMPORAL_ADDRESS=${TEMPORAL_ADDR}" \
    --command -- temporal workflow describe \
    --namespace "$TEMPORAL_NS" \
    --workflow-id "$temporal_wf" \
    --run-id "$temporal_run" \
    -o json 2>/dev/null || true)"

  status="$(echo "$describe_out" | jq -r '.workflowExecutionInfo.status // empty' 2>/dev/null || true)"
  if [[ -z "$status" ]]; then
    skipped=$((skipped + 1))
    echo "[reconcile] skip ${exec_id}: temporal describe failed or still open"
    continue
  fi

  case "$status" in
    WORKFLOW_EXECUTION_STATUS_COMPLETED) mongo_status="completed" ;;
    WORKFLOW_EXECUTION_STATUS_FAILED) mongo_status="failed" ;;
    WORKFLOW_EXECUTION_STATUS_CANCELED) mongo_status="canceled" ;;
    WORKFLOW_EXECUTION_STATUS_TERMINATED) mongo_status="terminated" ;;
    WORKFLOW_EXECUTION_STATUS_TIMED_OUT) mongo_status="timed_out" ;;
    *)
      skipped=$((skipped + 1))
      echo "[reconcile] skip ${exec_id}: temporal status=${status}"
      continue
      ;;
  esac

  if [[ "$APPLY" != "true" ]]; then
    echo "[reconcile] would set ${exec_id} -> ${mongo_status} (temporal=${status})"
    fixed=$((fixed + 1))
    continue
  fi

  kubectl -n "$NS" exec "$MONGO_POD" -c mongo -- mongosh --quiet \
    -u yoizen -p yoizen-dev-password --authenticationDatabase yoizen "$DB" --eval "
db.workflow_executions.updateOne(
  { _id: '${exec_id}' },
  { \$set: { status: '${mongo_status}', updated_at: new Date() } }
);
" >/dev/null && {
    fixed=$((fixed + 1))
    echo "[reconcile] updated ${exec_id} -> ${mongo_status}"
  } || {
    errors=$((errors + 1))
    echo "[reconcile] failed to update ${exec_id}" >&2
  }
done <"$TMP"

echo "[reconcile] done fixed=${fixed} skipped=${skipped} errors=${errors} (apply=${APPLY})"
