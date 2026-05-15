#!/usr/bin/env bash
# Build the stress-sink image and make it available to the cluster.
#
# Supports three modes (auto-detected, override with STRESS_SINK_PUSH_MODE):
#   - minikube : `minikube image load` (default when minikube is in PATH)
#   - registry : push to $STRESS_SINK_IMAGE (must be set)
#   - none     : just build, do nothing else (for inspection)
#
# Usage:
#   ./sink/build-and-load.sh                       # default: build + load into minikube
#   STRESS_SINK_IMAGE=ghcr.io/me/stress-sink:dev \
#     STRESS_SINK_PUSH_MODE=registry \
#     ./sink/build-and-load.sh
#
# Outputs a final line `image=<resolved-image-ref>` so callers can capture it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$STRESS_DIR/../.." && pwd)"

IMAGE="${STRESS_SINK_IMAGE:-dev.local/stress-sink:dev}"
MODE="${STRESS_SINK_PUSH_MODE:-}"
PROFILE="${MINIKUBE_PROFILE:-}"

# Auto-detect the minikube profile from the active kubectl context if the
# caller didn't pin one. Falls back to the literal `minikube` default.
if [[ -z "$PROFILE" ]] && command -v minikube >/dev/null 2>&1; then
  CURRENT_CTX="$(kubectl config current-context 2>/dev/null || true)"
  if [[ -n "$CURRENT_CTX" ]] \
    && minikube profile list -o json 2>/dev/null \
      | grep -q "\"Name\":\"$CURRENT_CTX\""; then
    PROFILE="$CURRENT_CTX"
  fi
fi

if [[ -z "$MODE" ]]; then
  if command -v minikube >/dev/null 2>&1; then
    MODE="minikube"
  else
    MODE="none"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build the image." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[sink] building $IMAGE (context=$ROOT_DIR)"
docker build \
  -f tests/stress/sink/Dockerfile \
  -t "$IMAGE" \
  .

case "$MODE" in
  minikube)
    if ! command -v minikube >/dev/null 2>&1; then
      echo "minikube not in PATH; cannot load image." >&2
      exit 1
    fi
    PROFILE_ARG=()
    if [[ -n "$PROFILE" ]]; then
      PROFILE_ARG=(--profile "$PROFILE")
    fi
    echo "[sink] loading $IMAGE into minikube${PROFILE:+ profile=$PROFILE}"
    minikube image load "${PROFILE_ARG[@]}" "$IMAGE"
    ;;
  registry)
    if [[ "$IMAGE" == "dev.local/"* ]]; then
      echo "STRESS_SINK_PUSH_MODE=registry but STRESS_SINK_IMAGE is unset or 'dev.local/...'." >&2
      echo "Set STRESS_SINK_IMAGE=ghcr.io/<org>/stress-sink:<tag> first." >&2
      exit 1
    fi
    echo "[sink] pushing $IMAGE to remote registry"
    docker push "$IMAGE"
    ;;
  none)
    echo "[sink] mode=none — built only, not loaded anywhere"
    ;;
  *)
    echo "Unknown STRESS_SINK_PUSH_MODE=$MODE (expected: minikube|registry|none)" >&2
    exit 1
    ;;
esac

echo "image=$IMAGE"
