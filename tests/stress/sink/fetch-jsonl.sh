#!/usr/bin/env bash
# Pull the sink JSONL out of the in-cluster pod for offline reconciliation.
#
# Two strategies, in order of preference:
#   1. `kubectl logs` — works while the pod is running OR has just terminated;
#                       requires STRESS_SINK_STDOUT=true (default in the
#                       Knative manifest).
#   2. `kubectl cp`    — copies the JSONL file from the pod's emptyDir.
#
# Usage:
#   ./sink/fetch-jsonl.sh [--namespace NS] [--service stress-sink] [--out path]
#                         [--mode logs|cp]

set -euo pipefail

NAMESPACE="${STRESS_NAMESPACE:-${SMOKE_TEST_NAMESPACE:-platform-services-dev}}"
SERVICE="stress-sink"
CONTAINER="stress-sink"
OUT=""
MODE="logs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --service)   SERVICE="$2";   shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --out)       OUT="$2";       shift 2 ;;
    --mode)      MODE="$2";      shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OUT" ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  OUT="reports/${SERVICE}-${TS}.sink.jsonl"
fi

mkdir -p "$(dirname "$OUT")"

selector="serving.knative.dev/service=${SERVICE}"
pods="$(kubectl -n "$NAMESPACE" get pods -l "$selector" -o jsonpath='{.items[*].metadata.name}')"
if [[ -z "$pods" ]]; then
  echo "No pods found for service '$SERVICE' in namespace '$NAMESPACE'." >&2
  exit 1
fi

echo "[fetch] namespace=$NAMESPACE service=$SERVICE pods=$pods mode=$MODE -> $OUT"

case "$MODE" in
  logs)
    : > "$OUT"
    for pod in $pods; do
      kubectl -n "$NAMESPACE" logs --tail=-1 --container="$CONTAINER" "$pod" \
        | grep -E '^\{"correlation_id"' >> "$OUT" || true
    done
    ;;
  cp)
    : > "$OUT"
    for pod in $pods; do
      tmp="$(mktemp)"
      kubectl -n "$NAMESPACE" cp \
        "$pod:/var/log/stress/sink.jsonl" "$tmp" \
        --container="$CONTAINER" 2>/dev/null || true
      if [[ -s "$tmp" ]]; then
        cat "$tmp" >> "$OUT"
      fi
      rm -f "$tmp"
    done
    ;;
  *)
    echo "Unknown --mode: $MODE (expected logs|cp)" >&2
    exit 1
    ;;
esac

LINES="$(wc -l < "$OUT" | tr -d ' ')"
echo "lines=$LINES out=$OUT"
