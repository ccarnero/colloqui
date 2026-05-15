#!/usr/bin/env bash
# Phase 1 runner — orchestrates k6 + Knative sampler + reconciler.
#
# Usage:
#   ./scripts/run.sh --scenario events-callback [--with-sampler false]
#
# Inputs (env):
#   STRESS_SINK_OUTPUT       Path to the sink JSONL (read by reconcile.ts).
#                            Default: ./reports/<scenario>-<ts>.sink.jsonl
#   STRESS_SAMPLER_INTERVAL_MS, STRESS_NAMESPACE, STRESS_WATCH_SERVICES — passed to sampler.
#   K6_BIN                   Override the k6 binary (default: k6 in PATH).
#   ADMIN_EMAIL/ADMIN_PASSWORD or E2E_CLIENT_ID/E2E_CLIENT_SECRET — credentials.
#
# Outputs (under ./reports/<scenario>-<ts>.*):
#   - <scenario>-<ts>.k6.json          Streaming NDJSON output.
#   - <scenario>-<ts>.k6.summary.json  Final summary export.
#   - <scenario>-<ts>.sampler.jsonl    (optional) replica/HPA sampler timeline.
#   - <scenario>-<ts>.reconcile.md     Per-stage e2e report.
#   - <scenario>-<ts>.reconcile.csv    Per-stage e2e CSV.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

SCENARIO=""
WITH_SAMPLER="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)
      SCENARIO="${2:-}"
      shift 2
      ;;
    --with-sampler)
      WITH_SAMPLER="${2:-true}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SCENARIO" ]]; then
  echo "Usage: $0 --scenario <webhook-ingress> [--with-sampler true|false]" >&2
  exit 1
fi

SCENARIO_FILE="scenarios/${SCENARIO}.ts"
if [[ ! -f "$SCENARIO_FILE" ]]; then
  echo "Scenario file not found: $SCENARIO_FILE" >&2
  exit 1
fi

mkdir -p reports

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
K6_OUT_NDJSON="reports/${SCENARIO}-${TIMESTAMP}.k6.json"
K6_OUT_SUMMARY="reports/${SCENARIO}-${TIMESTAMP}.k6.summary.json"
SAMPLER_OUT="reports/${SCENARIO}-${TIMESTAMP}.sampler.jsonl"
SINK_JSONL="${STRESS_SINK_OUTPUT:-reports/${SCENARIO}-${TIMESTAMP}.sink.jsonl}"

export STRESS_SINK_OUTPUT="$SINK_JSONL"

K6_BIN="${K6_BIN:-k6}"
if ! command -v "$K6_BIN" >/dev/null 2>&1; then
  echo "k6 binary '$K6_BIN' not found in PATH." >&2
  exit 1
fi

SAMPLER_PID=""
SINK_PID=""

cleanup() {
  if [[ -n "$SAMPLER_PID" ]]; then
    kill "$SAMPLER_PID" >/dev/null 2>&1 || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SINK_PID" ]]; then
    kill "$SINK_PID" >/dev/null 2>&1 || true
    wait "$SINK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Optional in-process sink (used when STRESS_SINK_LOCAL=true). Otherwise we
# expect the in-cluster Knative `stress-sink` service to be reachable via
# STRESS_SINK_URL.
if [[ "${STRESS_SINK_LOCAL:-false}" == "true" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "Local sink requested but bun is not installed." >&2
    exit 1
  fi
  STRESS_SINK_PORT="${STRESS_SINK_PORT:-8090}"
  STRESS_SINK_URL="${STRESS_SINK_URL:-http://127.0.0.1:${STRESS_SINK_PORT}/sink}"
  export STRESS_SINK_PORT STRESS_SINK_URL
  bun run sink/server.ts >>"reports/${SCENARIO}-${TIMESTAMP}.sink.log" 2>&1 &
  SINK_PID="$!"
  sleep 1
  echo "[run] local sink pid=$SINK_PID port=$STRESS_SINK_PORT output=$SINK_JSONL"
fi

if [[ "$WITH_SAMPLER" == "true" ]]; then
  SAMPLER_NAMESPACE="${STRESS_NAMESPACE:-${SMOKE_TEST_NAMESPACE:-platform-services-dev}}"
  SAMPLER_INTERVAL="${STRESS_SAMPLER_INTERVAL_MS:-2000}"
  if ! command -v bun >/dev/null 2>&1; then
    echo "Sampler requested but bun is not installed; skipping." >&2
  else
    bun run ../scale/sampler.ts \
      --output "$SAMPLER_OUT" \
      --namespace "$SAMPLER_NAMESPACE" \
      --interval-ms "$SAMPLER_INTERVAL" >>"reports/${SCENARIO}-${TIMESTAMP}.sampler.log" 2>&1 &
    SAMPLER_PID="$!"
    echo "[run] sampler pid=$SAMPLER_PID -> $SAMPLER_OUT"
  fi
fi

echo "[run] scenario=$SCENARIO ndjson=$K6_OUT_NDJSON summary=$K6_OUT_SUMMARY"

"$K6_BIN" run \
  --out "json=$K6_OUT_NDJSON" \
  --summary-export "$K6_OUT_SUMMARY" \
  "$SCENARIO_FILE"

if [[ -n "$SAMPLER_PID" ]]; then
  kill "$SAMPLER_PID" >/dev/null 2>&1 || true
  wait "$SAMPLER_PID" 2>/dev/null || true
  SAMPLER_PID=""
fi

if [[ -n "$SINK_PID" ]]; then
  # Give the sink one extra second to flush before reading the JSONL.
  sleep 1
  kill "$SINK_PID" >/dev/null 2>&1 || true
  wait "$SINK_PID" 2>/dev/null || true
  SINK_PID=""
fi

if [[ -f "$SINK_JSONL" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "[run] bun not installed — skipping reconcile." >&2
  else
    bun run reconcile/reconcile.ts \
      --scenario "$SCENARIO" \
      --sink "$SINK_JSONL" \
      --k6 "$K6_OUT_NDJSON" \
      --output "reports"
  fi
else
  echo "[run] sink JSONL not found at $SINK_JSONL — reconcile skipped." >&2
fi

echo "[run] done."
echo "k6.ndjson=$K6_OUT_NDJSON"
echo "k6.summary=$K6_OUT_SUMMARY"
echo "sampler=$SAMPLER_OUT"
echo "sink.jsonl=$SINK_JSONL"
