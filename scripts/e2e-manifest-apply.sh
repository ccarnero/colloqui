#!/usr/bin/env bash
set -euo pipefail

# End-to-end check of the T04 declarative-provisioning apply engine
# (manual-loops/declarative-provisioning.md): plan -> apply -> re-plan
# (all-noop) -> re-apply (no-op) -> teardown, driven directly against the
# deployed provisioning-service.
#
# No api-gateway route exists yet (that lands in T07), so this script talks
# to the Knative ingress hostnames of the services directly — the SAME
# transport pattern every other e2e script uses (see e2e-http-workflow.sh:
# dev.local base URLs + Host header + --resolve for macOS mDNS). Knative
# ksvc Services are activator/ingress-routed, so `kubectl port-forward`
# does NOT work on them — hence direct ingress URLs, never port-forward.
#
#   1. PUT a minimal manifest (one inbound `http` channel + one `jsFunction`
#      workflow — the smallest shape satisfying the T01 structural rules:
#      >=1 inbound channel, >=1 process) under an e2e-prefixed,
#      account-scoped name.
#   2. POST .../plan: expect BOTH resources verdict `create`.
#   3. POST .../apply: expect BOTH resources applied (`create`), HTTP 200.
#   4. POST .../plan again: expect BOTH resources verdict `noop` (idempotent
#      convergence — the exact criterion SPEC.md requires).
#   5. POST .../apply again: expect an all-noop apply (appliedCount 0),
#      proving re-apply is a true no-op.
#   6. Teardown: delete the channel account and the workflow definition
#      created above, directly via their owning services (provisioning-
#      service has no delete/prune route by design — decision 8). Runs via
#      an EXIT trap, idempotent (resolves by e2e-prefixed NAME as a
#      fallback, safe to rerun after a crashed prior run).
#
# Exit code 0 = full round trip verified; 1 = any stage failed.

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
TENANT="${E2E_TENANT:-acme}"

# Knative ingress hostnames (dev.local), each env-overridable. The three
# services this script touches are separate ksvc, so each carries its own
# Host header (the ingress routes by Host, not path).
PROVISIONING_URL="${E2E_PROVISIONING_URL:-http://provisioning-service.platform-services-dev.dev.local}"
PROVISIONING_HOST="${E2E_PROVISIONING_HOST:-provisioning-service.platform-services-dev.dev.local}"
CHANNEL_URL="${E2E_CHANNEL_URL:-http://channel-service-api.platform-services-dev.dev.local}"
CHANNEL_HOST="${E2E_CHANNEL_HOST:-channel-service-api.platform-services-dev.dev.local}"
WORKFLOW_URL="${E2E_WORKFLOW_URL:-http://workflow-service-api.platform-services-dev.dev.local}"
WORKFLOW_HOST="${E2E_WORKFLOW_HOST:-workflow-service-api.platform-services-dev.dev.local}"

POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-60}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

command -v curl >/dev/null 2>&1 || { err "curl not found in PATH"; exit 1; }
command -v jq >/dev/null 2>&1 || { err "jq not found in PATH"; exit 1; }

# macOS mDNS resolves *.dev.local in ~5s even with /etc/hosts entries;
# --resolve skips DNS. Override/disable via E2E_RESOLVE_IP (set empty to let
# curl resolve the hostname itself, e.g. in-cluster runners). Every dev.local
# ksvc shares the same ingress IP, so one resolve IP covers all three hosts.
E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"

# Port is derived from each URL's scheme; all three use plain http:80 by
# default, but keep the derivation generic so an https or :PORT override works.
url_port() {
  local url="$1" scheme host_port
  scheme="${url%%://*}"
  host_port="${url#*://}"
  host_port="${host_port%%/*}"
  if [[ "$host_port" == *:* ]]; then
    echo "${host_port##*:}"
  elif [[ "$scheme" == "https" ]]; then
    echo 443
  else
    echo 80
  fi
}

PROVISIONING_PORT="$(url_port "$PROVISIONING_URL")"
CHANNEL_PORT="$(url_port "$CHANNEL_URL")"
WORKFLOW_PORT="$(url_port "$WORKFLOW_URL")"

# Per-host --resolve args, appended only when E2E_RESOLVE_IP is set.
PROVISIONING_RESOLVE=()
CHANNEL_RESOLVE=()
WORKFLOW_RESOLVE=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  PROVISIONING_RESOLVE=(--resolve "${PROVISIONING_HOST}:${PROVISIONING_PORT}:${E2E_RESOLVE_IP}")
  CHANNEL_RESOLVE=(--resolve "${CHANNEL_HOST}:${CHANNEL_PORT}:${E2E_RESOLVE_IP}")
  WORKFLOW_RESOLVE=(--resolve "${WORKFLOW_HOST}:${WORKFLOW_PORT}:${E2E_RESOLVE_IP}")
fi

# Thin curl wrappers: each pins the correct Host header + --resolve for its
# target service. All args after the method/path are forwarded to curl.
prov_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${PROVISIONING_RESOLVE[@]}" -X "$method" \
    -H "Host: ${PROVISIONING_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${PROVISIONING_URL}${path}"
}
channel_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${CHANNEL_RESOLVE[@]}" -X "$method" \
    -H "Host: ${CHANNEL_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${CHANNEL_URL}${path}"
}
workflow_curl() {
  local method="$1" path="$2"; shift 2
  curl -fsS "${WORKFLOW_RESOLVE[@]}" -X "$method" \
    -H "Host: ${WORKFLOW_HOST}" -H "x-yoizen-tenant: ${TENANT}" \
    "$@" "${WORKFLOW_URL}${path}"
}

NONCE="e2e-$(date +%s)-$RANDOM"
MANIFEST_NAME="e2e-manifest-apply-${NONCE}"
CHANNEL_NAME="e2e-http-${NONCE}"
WORKFLOW_NAME="e2e-flow-${NONCE}"

CHANNEL_EXTERNAL_ID=""
WORKFLOW_EXTERNAL_ID=""

wait_for_health() {
  local svc="$1"
  local deadline=$((SECONDS + POLL_TIMEOUT_S))
  until "${svc}_curl" GET /health >/dev/null 2>&1; do
    if [[ $SECONDS -ge $deadline ]]; then
      err "${svc} did not respond on /health within ${POLL_TIMEOUT_S}s"
      exit 1
    fi
    sleep 2
  done
  log "${svc} is reachable"
}

cleanup() {
  local status=$?
  log "Cleanup: tearing down e2e-created resources (idempotent)"

  # Resolve by e2e-prefixed NAME as a fallback when no externalId was
  # captured yet (e.g. the script failed before the first apply).
  if [[ -z "$CHANNEL_EXTERNAL_ID" ]]; then
    CHANNEL_EXTERNAL_ID="$(channel_curl GET /channels/accounts 2>/dev/null \
      | jq -r --arg n "$CHANNEL_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
  fi
  if [[ -n "$CHANNEL_EXTERNAL_ID" ]]; then
    channel_curl DELETE "/channels/accounts/${CHANNEL_EXTERNAL_ID}" >/dev/null 2>&1 || true
    log "deleted channel account externalId=${CHANNEL_EXTERNAL_ID}"
  fi

  if [[ -z "$WORKFLOW_EXTERNAL_ID" ]]; then
    WORKFLOW_EXTERNAL_ID="$(workflow_curl GET /workflows 2>/dev/null \
      | jq -r --arg n "$WORKFLOW_NAME" '[.[]? | select(.name == $n)][0].id // empty' 2>/dev/null || true)"
  fi
  if [[ -n "$WORKFLOW_EXTERNAL_ID" ]]; then
    workflow_curl DELETE "/workflows/${WORKFLOW_EXTERNAL_ID}" >/dev/null 2>&1 || true
    log "deleted workflow definition externalId=${WORKFLOW_EXTERNAL_ID}"
  fi

  if [[ $status -eq 0 ]]; then
    log "e2e-manifest-apply: PASSED"
  else
    err "e2e-manifest-apply: FAILED (exit=$status)"
  fi
  exit "$status"
}
trap cleanup EXIT

# --- 0. reachability -----------------------------------------------------

log "Targeting provisioning-service at ${PROVISIONING_URL} (Host: ${PROVISIONING_HOST})"
wait_for_health prov
wait_for_health channel
wait_for_health workflow

# --- 1. PUT the minimal manifest ----------------------------------------

MANIFEST_JSON="$(jq -n \
  --arg name "$MANIFEST_NAME" \
  --arg channel "$CHANNEL_NAME" \
  --arg workflow "$WORKFLOW_NAME" \
  '{
    apiVersion: "yoizen.io/v1",
    kind: "IntegrationManifest",
    metadata: { name: $name },
    spec: {
      channels: [
        { name: $channel, type: "http", direction: "inbound" }
      ],
      connectors: [],
      agents: [],
      knowledgeBases: [],
      services: [],
      workflows: [
        {
          name: $workflow,
          definition: {
            application: $name,
            actions: [
              {
                activity: "jsFunction",
                name: "log-e2e-nonce",
                args: { code: "(ctx) => ({ ok: true })" }
              }
            ]
          }
        }
      ],
      secrets: []
    }
  }')"

log "PUT /manifests/${MANIFEST_NAME}"
prov_curl PUT "/manifests/${MANIFEST_NAME}" \
  -H "content-type: application/json" \
  -d "$MANIFEST_JSON" | jq -e '.revision == 1' >/dev/null \
  || { err "manifest PUT did not return revision 1"; exit 1; }

# --- 2. first plan: both resources must be 'create' ---------------------

log "POST /manifests/${MANIFEST_NAME}/plan (expect all-create)"
FIRST_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"

FIRST_VERDICTS="$(echo "$FIRST_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$FIRST_VERDICTS" != "create" ]]; then
  err "expected all-create plan, got verdicts: ${FIRST_VERDICTS}"
  echo "$FIRST_PLAN" | jq .
  exit 1
fi
log "first plan: all resources verdict=create (OK)"

# --- 3. first apply: both resources applied ------------------------------

log "POST /manifests/${MANIFEST_NAME}/apply (expect appliedCount=2)"
FIRST_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply")"

APPLIED_COUNT="$(echo "$FIRST_APPLY" | jq -r '.appliedCount')"
if [[ "$APPLIED_COUNT" != "2" ]]; then
  err "expected appliedCount=2, got: ${APPLIED_COUNT}"
  echo "$FIRST_APPLY" | jq .
  exit 1
fi
log "first apply: appliedCount=2 (OK)"

CHANNEL_EXTERNAL_ID="$(echo "$FIRST_APPLY" | jq -r --arg n "$CHANNEL_NAME" '.resources[] | select(.name == $n) | .externalId')"
WORKFLOW_EXTERNAL_ID="$(echo "$FIRST_APPLY" | jq -r --arg n "$WORKFLOW_NAME" '.resources[] | select(.name == $n) | .externalId')"
log "created channel externalId=${CHANNEL_EXTERNAL_ID} workflow externalId=${WORKFLOW_EXTERNAL_ID}"

# --- 4. second plan: both resources must be 'noop' (idempotent) ---------

log "POST /manifests/${MANIFEST_NAME}/plan again (expect all-noop)"
SECOND_PLAN="$(prov_curl POST "/manifests/${MANIFEST_NAME}/plan")"

SECOND_VERDICTS="$(echo "$SECOND_PLAN" | jq -r '.resources[].verdict' | sort -u)"
if [[ "$SECOND_VERDICTS" != "noop" ]]; then
  err "expected all-noop plan on re-plan, got verdicts: ${SECOND_VERDICTS}"
  echo "$SECOND_PLAN" | jq .
  exit 1
fi
log "second plan: all resources verdict=noop (OK — converged)"

# --- 5. second apply: no-op (appliedCount=0) ----------------------------

log "POST /manifests/${MANIFEST_NAME}/apply again (expect appliedCount=0)"
SECOND_APPLY="$(prov_curl POST "/manifests/${MANIFEST_NAME}/apply")"

SECOND_APPLIED_COUNT="$(echo "$SECOND_APPLY" | jq -r '.appliedCount')"
SECOND_NOOP_COUNT="$(echo "$SECOND_APPLY" | jq -r '.noopCount')"
if [[ "$SECOND_APPLIED_COUNT" != "0" || "$SECOND_NOOP_COUNT" != "2" ]]; then
  err "expected second apply to be a no-op (appliedCount=0 noopCount=2), got appliedCount=${SECOND_APPLIED_COUNT} noopCount=${SECOND_NOOP_COUNT}"
  echo "$SECOND_APPLY" | jq .
  exit 1
fi
log "second apply: no-op (appliedCount=0, noopCount=2) — idempotent apply verified (OK)"

log "All stages passed"
