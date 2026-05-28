#!/usr/bin/env bash
# Phase 1 runner — orchestrates k6 + Knative sampler + reconciler.
#
# Usage:
#   ./scripts/run.sh --scenario webhook-ingress [--use-kourier auto]
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
USE_KOURIER="auto"
# Default off: the legacy ../scale/sampler.ts was removed in the
# stress refactor. Pass --with-sampler true once a replacement lands
# under tests/stress/scale/sampler.ts (or override SAMPLER_SCRIPT).
WITH_SAMPLER="false"

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
    --use-kourier)
      USE_KOURIER="${2:-true}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SCENARIO" ]]; then
  echo "Usage: $0 --scenario <webhook-ingress> [--with-sampler true|false] [--use-kourier auto|true|false]" >&2
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
  SAMPLER_SCRIPT="${SAMPLER_SCRIPT:-../scale/sampler.ts}"
  if ! command -v bun >/dev/null 2>&1; then
    echo "[run] sampler requested but bun is not installed; skipping." >&2
  elif [[ ! -f "$SAMPLER_SCRIPT" ]]; then
    echo "[run] sampler requested but '$SAMPLER_SCRIPT' not found; skipping." >&2
    echo "[run] (set SAMPLER_SCRIPT=<path> or pass --with-sampler false)" >&2
  else
    bun run "$SAMPLER_SCRIPT" \
      --output "$SAMPLER_OUT" \
      --namespace "$SAMPLER_NAMESPACE" \
      --interval-ms "$SAMPLER_INTERVAL" >>"reports/${SCENARIO}-${TIMESTAMP}.sampler.log" 2>&1 &
    SAMPLER_PID="$!"
    echo "[run] sampler pid=$SAMPLER_PID -> $SAMPLER_OUT"
  fi
fi

should_resolve_kourier() {
  case "$USE_KOURIER" in
    true|1|yes) return 0 ;;
    false|0|no) return 1 ;;
    auto)
      [[ -z "${STRESS_TARGET:-}" ]]
      ;;
    *) return 1 ;;
  esac
}

if should_resolve_kourier; then
  # shellcheck source=resolve-stress-target.sh
  source "$SCRIPT_DIR/resolve-stress-target.sh"
  resolve_stress_target || {
    echo "[run] Kourier discovery failed; use STRESS_TARGET=http://... or --use-kourier false with port-forward." >&2
    exit 1
  }
elif [[ -n "${STRESS_TARGET:-}" ]]; then
  echo "[run] STRESS_TARGET=${STRESS_TARGET} (explicit)"
else
  echo "[run] Using default k6 target (localhost:8080); prefer --use-kourier auto for stress runs." >&2
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

# When the sink lives in-cluster (no local sink, sink URL points at a
# Kubernetes service), pull the JSONL out of the pod automatically so
# the reconciler has something to work against. Opt-out via
# STRESS_FETCH_SINK=false; force on with STRESS_FETCH_SINK=true.
SHOULD_FETCH_SINK="${STRESS_FETCH_SINK:-auto}"
if [[ "$SHOULD_FETCH_SINK" == "auto" ]]; then
  if [[ -z "$SINK_PID" && "${STRESS_SINK_URL:-}" == *".svc.cluster.local"* ]]; then
    SHOULD_FETCH_SINK="true"
  else
    SHOULD_FETCH_SINK="false"
  fi
fi
if [[ "$SHOULD_FETCH_SINK" == "true" && ! -f "$SINK_JSONL" ]]; then
  if [[ -x "./sink/fetch-jsonl.sh" ]]; then
    echo "[run] fetching sink JSONL from in-cluster pod -> $SINK_JSONL"
    if ! ./sink/fetch-jsonl.sh --out "$SINK_JSONL"; then
      echo "[run] fetch-jsonl.sh failed; reconcile will rely on k6 only." >&2
      : > "$SINK_JSONL"
    fi
  else
    echo "[run] sink/fetch-jsonl.sh not executable; skipping fetch." >&2
  fi
fi

# Always create an empty sink file when missing, so the reconciler can
# at least produce per-stage rows from k6 (sent counts, ack latency).
if [[ ! -f "$SINK_JSONL" ]]; then
  echo "[run] no sink JSONL on disk; running reconcile against k6 only." >&2
  : > "$SINK_JSONL"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[run] bun not installed — skipping reconcile." >&2
else
  bun run reconcile/reconcile.ts \
    --scenario "$SCENARIO" \
    --sink "$SINK_JSONL" \
    --k6 "$K6_OUT_NDJSON" \
    --output "reports"

  SINK_LINES="$(wc -l <"$SINK_JSONL" | tr -d ' ')"
  if [[ "${SINK_LINES:-0}" -eq 0 ]]; then
    echo "[run] WARNING: sink JSONL is empty (0 deliveries observed)." >&2
    echo "[run] The reconcile report shows sent counts from k6 but no" >&2
    echo "[run] e2e latency. See README 'Reading the results'." >&2
  fi
fi

echo "[run] done."
echo "k6.ndjson=$K6_OUT_NDJSON"
echo "k6.summary=$K6_OUT_SUMMARY"
if [[ -f "$SAMPLER_OUT" ]]; then
  echo "sampler=$SAMPLER_OUT"
fi
echo "sink.jsonl=$SINK_JSONL"
