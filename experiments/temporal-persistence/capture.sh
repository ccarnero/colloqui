#!/usr/bin/env bash
set -euo pipefail

LABEL="${1:-snapshot}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/experiments/temporal-persistence/results/$LABEL"
SUPPORT_NS="${SUPPORT_NS:-support-services-dev}"
PLATFORM_NS="${PLATFORM_NS:-platform-services-dev}"
TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-temporal:7233}"
TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"

mkdir -p "$OUT_DIR"

prom_query() {
  local name="$1"
  local query="$2"
  kubectl exec -n "$SUPPORT_NS" deploy/prometheus -- \
    wget -qO- --post-data "query=$query" \
    "http://localhost:9090/api/v1/query" >"$OUT_DIR/$name.json"
}

date -u +%FT%TZ >"$OUT_DIR/timestamp.txt"
kubectl get hpa -n "$PLATFORM_NS" >"$OUT_DIR/hpa.txt"
kubectl get scaledobject -n "$PLATFORM_NS" >"$OUT_DIR/scaledobjects.txt"
kubectl top pods -n "$SUPPORT_NS" >"$OUT_DIR/top-support.txt" || true
kubectl top pods -n "$PLATFORM_NS" >"$OUT_DIR/top-platform.txt" || true

kubectl exec -n "$SUPPORT_NS" deploy/temporal-frontend -- \
  temporal workflow count --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --query 'ExecutionStatus="Running"' >"$OUT_DIR/temporal-running-count.txt"

kubectl exec -n "$SUPPORT_NS" deploy/temporal-frontend -- \
  temporal task-queue describe --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --task-queue workflow-orchestrator --task-queue-type workflow \
  >"$OUT_DIR/taskqueue-workflow-orchestrator-workflow.txt"

kubectl exec -n "$SUPPORT_NS" deploy/temporal-frontend -- \
  temporal task-queue describe --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --task-queue workflow-orchestrator --task-queue-type activity \
  >"$OUT_DIR/taskqueue-workflow-orchestrator-activity.txt"

kubectl exec -n "$SUPPORT_NS" deploy/temporal-frontend -- \
  temporal task-queue describe --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --task-queue http-adapter --task-queue-type activity \
  >"$OUT_DIR/taskqueue-http-adapter-activity.txt"

kubectl exec -n "$SUPPORT_NS" deploy/temporal-frontend -- \
  temporal task-queue describe --address "$TEMPORAL_ADDRESS" --namespace "$TEMPORAL_NAMESPACE" \
  --task-queue connector-runtime --task-queue-type activity \
  >"$OUT_DIR/taskqueue-connector-runtime-activity.txt"

prom_query temporal_persistence_rps 'topk(20, sum by (operation, service_name, namespace) (rate(persistence_requests[5m])))'
prom_query temporal_persistence_p95 'topk(20, histogram_quantile(0.95, sum by (le, operation, service_name) (rate(persistence_latency_bucket[5m]))))'
prom_query temporal_persistence_errors 'topk(20, sum by (operation, service_name, type) (rate(persistence_error_with_type[5m])))'
prom_query temporal_db_commits 'sum by (datname) (rate(cnpg_pg_stat_database_xact_commit{datname=~"temporal|temporal_visibility"}[5m]))'
prom_query temporal_db_inserts 'sum by (datname) (rate(cnpg_pg_stat_database_tup_inserted{datname=~"temporal|temporal_visibility"}[5m]))'
prom_query temporal_db_updates 'sum by (datname) (rate(cnpg_pg_stat_database_tup_updated{datname=~"temporal|temporal_visibility"}[5m]))'
prom_query temporal_db_write_time 'sum by (datname) (rate(cnpg_pg_stat_database_blk_write_time{datname=~"temporal|temporal_visibility"}[5m]))'
prom_query temporal_db_blocks_read 'sum by (datname) (rate(cnpg_pg_stat_database_blks_read{datname=~"temporal|temporal_visibility"}[5m]))'
prom_query workflow_worker_slots 'sum by (worker_type, task_queue) (temporal_worker_task_slots_used{job="workflow-worker-sdk"})'
prom_query workflow_worker_schedule_to_start_p95 '1000 * histogram_quantile(0.95, sum by (le) (rate(temporal_workflow_task_schedule_to_start_latency_bucket{job="workflow-worker-sdk",task_queue="workflow-orchestrator"}[5m])))'
prom_query connector_runtime_slots 'sum by (worker_type, task_queue) (temporal_worker_task_slots_used{job="connector-runtime-sdk"})'
prom_query connector_runtime_schedule_to_start_p95 '1000 * histogram_quantile(0.95, sum by (le) (rate(temporal_activity_schedule_to_start_latency_bucket{job="connector-runtime-sdk",task_queue="connector-runtime"}[5m])))'
prom_query jetstream_pending 'jetstream_consumer_num_pending'
prom_query jetstream_ack_pending 'jetstream_consumer_num_ack_pending'
prom_query jetstream_redelivered 'jetstream_consumer_num_redelivered'
prom_query jetstream_api_errors 'rate(gnatsd_varz_jetstream_stats_api_errors[5m])'

printf 'captured=%s\n' "$OUT_DIR"
