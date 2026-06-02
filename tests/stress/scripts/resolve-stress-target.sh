#!/usr/bin/env bash
# Resolves STRESS_TARGET / MINIKUBE_DOMAIN for k6 against Knative ingress (Kourier).
# Source from run.sh:  source "$(dirname "$0")/resolve-stress-target.sh"
#
# Honors existing STRESS_TARGET. When unset, discovers Kourier LB IP and exports:
#   STRESS_TARGET=http://<kourier-host>:<port>  (default port 8080)
#   MINIKUBE_DOMAIN=<ip>.sslip.io
#   API_GATEWAY_URL=http://api-gateway.<namespace>.<domain>  (for reconciler/provision)

resolve_stress_target() {
  if [[ -n "${STRESS_TARGET:-}" ]]; then
    return 0
  fi

  local profile="${MINIKUBE_PROFILE:-yoizen-arch}"
  local ns="${INGRESS_NS:-kourier-system}"
  local svc="${INGRESS_SVC:-kourier}"
  local platform_ns="${STRESS_NAMESPACE:-${SMOKE_TEST_NAMESPACE:-platform-services-dev}}"
  local kourier_port="${KOURIER_PORT:-8080}"
  local ingress_ip=""

  if command -v kubectl >/dev/null 2>&1; then
    ingress_ip="$(kubectl -n "$ns" get svc "$svc" \
      -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  fi

  if [[ -z "$ingress_ip" ]] && command -v minikube >/dev/null 2>&1; then
    ingress_ip="$(minikube ip -p "$profile" 2>/dev/null || true)"
  fi

  if [[ -z "$ingress_ip" ]]; then
    echo "[run] Could not discover Kourier IP; set STRESS_TARGET or start minikube." >&2
    return 1
  fi

  export MINIKUBE_DOMAIN="${MINIKUBE_DOMAIN:-${ingress_ip}.sslip.io}"
  export API_GATEWAY_URL="${API_GATEWAY_URL:-http://api-gateway.${platform_ns}.${MINIKUBE_DOMAIN}}"
  # Hit api-gateway via Kourier ingress DNS (load-balanced across KPA replicas).
  export STRESS_TARGET="${API_GATEWAY_URL}"
  echo "[run] STRESS_TARGET=${STRESS_TARGET} (Kourier ingress, port ${kourier_port} on LB)"
  return 0
}
