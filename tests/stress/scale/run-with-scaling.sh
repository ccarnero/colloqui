#!/usr/bin/env bash
set -euo pipefail

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
  echo "Usage: $0 --scenario <events-publish|events-roundtrip|webhook-ingress> [--with-sampler true|false]" >&2
  exit 1
fi

SCENARIO_FILE="artillery/scenarios/${SCENARIO}.yml"
if [[ ! -f "$SCENARIO_FILE" ]]; then
  echo "Scenario file not found: $SCENARIO_FILE" >&2
  exit 1
fi

mkdir -p reports

export ARTILLERY_WARMUP_DURATION="${ARTILLERY_WARMUP_DURATION:-30}"
export ARTILLERY_WARMUP_RATE="${ARTILLERY_WARMUP_RATE:-5}"
export ARTILLERY_RAMP_DURATION="${ARTILLERY_RAMP_DURATION:-120}"
export ARTILLERY_RAMP_START_RATE="${ARTILLERY_RAMP_START_RATE:-5}"
export ARTILLERY_RAMP_TO_RATE="${ARTILLERY_RAMP_TO_RATE:-200}"
export ARTILLERY_SUSTAIN_DURATION="${ARTILLERY_SUSTAIN_DURATION:-180}"
export ARTILLERY_SUSTAIN_RATE="${ARTILLERY_SUSTAIN_RATE:-200}"
export ARTILLERY_SPIKE_DURATION="${ARTILLERY_SPIKE_DURATION:-60}"
export ARTILLERY_SPIKE_RATE="${ARTILLERY_SPIKE_RATE:-500}"
export ARTILLERY_COOLDOWN_DURATION="${ARTILLERY_COOLDOWN_DURATION:-60}"
export ARTILLERY_COOLDOWN_RATE="${ARTILLERY_COOLDOWN_RATE:-20}"

export ARTILLERY_EVENTS_PER_VU="${ARTILLERY_EVENTS_PER_VU:-1}"
export ARTILLERY_WEBHOOKS_PER_VU="${ARTILLERY_WEBHOOKS_PER_VU:-1}"
export ARTILLERY_RESULT_POLL_COUNT="${ARTILLERY_RESULT_POLL_COUNT:-6}"
export ARTILLERY_RESULT_POLL_SLEEP_SECONDS="${ARTILLERY_RESULT_POLL_SLEEP_SECONDS:-1}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARTILLERY_OUT="reports/${SCENARIO}-${TIMESTAMP}.json"
SAMPLER_OUT="reports/${SCENARIO}-${TIMESTAMP}.jsonl"
REPORT_OUT="reports/${SCENARIO}-${TIMESTAMP}.scaling.md"

SAMPLER_PID=""

cleanup() {
  if [[ -n "$SAMPLER_PID" ]]; then
    kill "$SAMPLER_PID" >/dev/null 2>&1 || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "$WITH_SAMPLER" == "true" ]]; then
  SAMPLER_NAMESPACE="${STRESS_NAMESPACE:-${SMOKE_TEST_NAMESPACE:-platform-services-dev}}"
  bun run scale/sampler.ts \
    --output "$SAMPLER_OUT" \
    --namespace "$SAMPLER_NAMESPACE" \
    --interval-ms "${STRESS_SAMPLER_INTERVAL_MS:-2000}" &
  SAMPLER_PID="$!"
fi

NODE_OPTIONS="--import tsx ${NODE_OPTIONS:-}" \
  npx artillery run \
    --config artillery/config.common.yml \
    "$SCENARIO_FILE" \
    --output "$ARTILLERY_OUT"

if [[ "$WITH_SAMPLER" == "true" ]]; then
  cleanup
  SAMPLER_PID=""

  bun run scale/report.ts \
    --artillery "$ARTILLERY_OUT" \
    --sampler "$SAMPLER_OUT" \
    --output "$REPORT_OUT" \
    --scenario "$SCENARIO"

  echo "artillery=$ARTILLERY_OUT"
  echo "sampler=$SAMPLER_OUT"
  echo "report=$REPORT_OUT"
else
  echo "artillery=$ARTILLERY_OUT"
fi
