#!/usr/bin/env bash
set -euo pipefail

LABEL="${1:?usage: run-stage.sh <label> <rate> <duration>}"
RATE="${2:?usage: run-stage.sh <label> <rate> <duration>}"
DURATION="${3:?usage: run-stage.sh <label> <rate> <duration>}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_ROOT="$ROOT_DIR/experiments/temporal-persistence/results/$LABEL"
mkdir -p "$REPORT_ROOT"

{
  printf 'label=%s\n' "$LABEL"
  printf 'target_rate=%s\n' "$RATE"
  printf 'duration=%s\n' "$DURATION"
  printf 'created_at=%s\n' "$(date -u +%FT%TZ)"
  printf 'kube_context=%s\n' "$(kubectl config current-context 2>/dev/null || true)"
  printf 'git_head=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
  printf 'git_dirty=%s\n' "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  printf 'api_gateway_url=%s\n' "${API_GATEWAY_URL:-}"
  printf 'kourier_host=%s\n' "${KOURIER_HOST:-}"
  printf 'kourier_port=%s\n' "${KOURIER_PORT:-}"
  printf 'stress_target=%s\n' "${STRESS_TARGET:-}"
  printf 'telegram_webhook_secret_set=%s\n' "${TELEGRAM_WEBHOOK_SECRET:+true}"
  printf 'workflow_trigger_concurrency=%s\n' "${WORKFLOW_TRIGGER_CONCURRENCY:-cluster-default}"
  for scaler in workflow-worker-scaler workflow-service-worker-scaler connector-runtime-scaler; do
    min_replicas="$(kubectl -n platform-services-dev get scaledobject "$scaler" -o jsonpath='{.spec.minReplicaCount}' 2>/dev/null || true)"
    max_replicas="$(kubectl -n platform-services-dev get scaledobject "$scaler" -o jsonpath='{.spec.maxReplicaCount}' 2>/dev/null || true)"
    printf '%s_min_replicas=%s\n' "${scaler//-/_}" "$min_replicas"
    printf '%s_max_replicas=%s\n' "${scaler//-/_}" "$max_replicas"
  done
} >"$REPORT_ROOT/manifest.env"

cd "$ROOT_DIR/tests/stress"

export STRESS_BASELINE_RATE="1"
export STRESS_LIGHT_RATE="1"
export STRESS_MEDIUM_RATE="$RATE"
export STRESS_HEAVY_RATE="1"
export STRESS_PEAK_RATE="1"
export STRESS_SPIKE_PEAK_RATE="1"
export STRESS_SPIKE_RECOVER_RATE="1"

export STRESS_BASELINE_DURATION="0s"
export STRESS_LIGHT_DURATION="0s"
export STRESS_MEDIUM_DURATION="$DURATION"
export STRESS_HEAVY_DURATION="0s"
export STRESS_PEAK_DURATION="0s"
export STRESS_SPIKE_RAMP="0s"
export STRESS_SPIKE_HOLD="0s"

export STRESS_MEDIUM_VUS="${STRESS_MEDIUM_VUS:-100}"

export STRESS_SINK_URL="${STRESS_SINK_URL:-http://stress-sink.platform-services-dev.svc.cluster.local/sink}"
export STRESS_SINK_OUTPUT="$REPORT_ROOT/$LABEL.sink.jsonl"

./scripts/run.sh --scenario webhook-ingress --with-sampler false | tee "$REPORT_ROOT/run.log"
