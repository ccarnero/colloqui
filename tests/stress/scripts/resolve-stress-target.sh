#!/usr/bin/env bash
# Resolves STRESS_TARGET / DEV_DOMAIN for k6 against Knative ingress (Kourier).
# Source from run.sh:  source "$(dirname "$0")/resolve-stress-target.sh"
#
# Honors existing STRESS_TARGET. When unset, uses the stable dev.local domain
# (overridable via DEV_DOMAIN env var) and exports:
#   STRESS_TARGET=http://api-gateway.<namespace>.<domain>
#   DEV_DOMAIN=dev.local
#   API_GATEWAY_URL=http://api-gateway.<namespace>.<domain>  (for reconciler/provision)

resolve_stress_target() {
  if [[ -n "${STRESS_TARGET:-}" ]]; then
    return 0
  fi

  local platform_ns="${STRESS_NAMESPACE:-${SMOKE_TEST_NAMESPACE:-platform-services-dev}}"
  # DEV_DOMAIN accepts MINIKUBE_DOMAIN as a backward-compat fallback.
  export DEV_DOMAIN="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"
  export API_GATEWAY_URL="${API_GATEWAY_URL:-http://api-gateway.${platform_ns}.${DEV_DOMAIN}}"
  export STRESS_TARGET="${API_GATEWAY_URL}"
  echo "[run] STRESS_TARGET=${STRESS_TARGET}"
  return 0
}
