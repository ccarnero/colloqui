#!/usr/bin/env bash
set -euo pipefail

# Auto-load scripts/e2e/.env if present (same convention as scripts/reset/):
# every var below has a script-level ${VAR:-default} fallback, so anything
# set in .env wins over the hardcoded default. See scripts/e2e/README.md.
E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

# End-to-end cluster check of the connector invoke API
# (manual-loops/connector-invoke-api.md T07): sync + async round trip through
# the api-gateway proxy, driven with plain curl against the SDK-visible
# gateway contract (POST .../invoke, GET .../invocations/:id), so this script
# asserts the exact wire contract the SDK's
# `connectors.invoke()`/`connectors.invocations.get()` depend on.
# (When this was written the `sdk/` package had unit tests against a mocked
# HTTP client only. That is no longer true — `sdk/test/e2e/` now holds nine
# live-cluster suites behind `SDK_E2E=1`, and scripts/e2e/manifest-apply.sh
# drives the REAL SDK via manifest-showcase-driver.ts — but connector invoke
# is still not covered there, so this curl-level check stays the only one.)
#
#   1. Login as tenant admin (acme by default)
#   2. Create a fresh adapter/connector ("e2e-connector-invoke-<nonce>")
#      pointed at connector-admin-api's own in-cluster /health endpoint
#      (always HTTP 200, no downstream-state coupling), with ONE GET
#      endpoint definition that has response caching enabled — gives a
#      cheap, deterministic miss-then-hit pair for the sync round trip.
#   3. Apply an ephemeral in-cluster webhook receiver (Pod + Service running
#      a tiny Bun HTTP server via the connector-runtime image already local
#      to the cluster — no image pull) that logs every POST body it
#      receives.
#   4. Sync invoke #1 (mode omitted -> defaults to sync): expect HTTP 200,
#      cache_status "miss" on the resulting
#      connector.endpoint_call.completed.v1 audit event.
#   5. Sync invoke #2 (identical args): expect HTTP 200, cache_status "hit".
#   6. Async invoke (mode: "async", webhook -> the receiver's in-cluster DNS
#      name): expect HTTP 202 + {invocationId}.
#   7. Poll GET /api/v1/connectors/invocations/:invocationId until status
#      flips from "pending" to "completed" (poll fallback, T05).
#   8. Poll the webhook receiver's pod logs for the invocationId — this is
#      the PRIMARY assertion that webhook delivery happened (fatal on
#      failure; see SSRF/in-cluster finding in the header of
#      stage_deploy_webhook_receiver below).
#   9. GET /api/tracking/events?type=connector.endpoint_call.completed.v1
#      &resource=invocation/<id> via the gateway for each of the three
#      invocations (sync miss, sync hit, async) and assert: the event's
#      resource matches invocation/<id>, `cache_status` matches the expected
#      miss/hit (async reuses the SAME warmed cache key, so it is a hit too
#      — asserted informationally, not strictly), and no `causation_id`
#      (HTTP-facade calls start a ROOT correlation — there is no parent to
#      join, unlike the Temporal workflow path http-workflow.sh
#      exercises).
#
# Exit code 0 = full round trip verified; 1 = any stage failed. Cleanup
# (adapter, webhook receiver pod/svc) always runs via an EXIT trap,
# success or failure, and is idempotent (best-effort deletes, safe to rerun
# after a crashed prior run). Invocation Redis keys are NOT explicitly
# deleted — they carry their own TTL (INVOCATION_RESULT_TTL_SECONDS, default
# 900s) and this script does not assert their disappearance (out of scope;
# see final report note).
#
# Runs post-change only, per this task queue's G5a rule — no baseline run.

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
TENANT="${E2E_TENANT:-acme}"
EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
PASSWORD="${E2E_PASSWORD:-admin123}"
CONNECTOR_NAME_PREFIX="e2e-connector-invoke"
# In-cluster target for the seeded adapter's single endpoint —
# connector-admin-api's own GET /health ALWAYS returns HTTP 200 with a
# `{status: "ok"|"degraded", ...}` body regardless of downstream NATS/DB
# state (connector-admin's `HealthController.check` — the `@Get("health")`
# handler — never sets a non-2xx status on this route, unlike its /readyz
# sibling) — the most deterministic same-namespace
# target available, and connector-admin is a hard dependency of this very
# adapter-resolution call, so it is always reachable when the test can run
# at all.
ADAPTER_BASE_URL="http://connector-admin-api.${NAMESPACE}.svc.cluster.local"
WEBHOOK_RECEIVER_NAME="e2e-webhook-receiver"
WEBHOOK_PORT=8080
POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-90}"

E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"
API_SCHEME="${API_URL%%://*}"
API_HOST_PORT="${API_URL#*://}"
API_HOST_PORT="${API_HOST_PORT%%/*}"
if [[ "$API_HOST_PORT" == *:* ]]; then
  API_PORT="${API_HOST_PORT##*:}"
elif [[ "$API_SCHEME" == "https" ]]; then
  API_PORT=443
else
  API_PORT=80
fi
RESOLVE_ARGS=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  RESOLVE_ARGS=(--resolve "${HOST_HEADER}:${API_PORT}:${E2E_RESOLVE_IP}")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-invoke-$(date +%s)-$RANDOM"
TOKEN=""
CONNECTOR_ID=""
ENDPOINT_ID=""
SYNC_MISS_INVOCATION_ID=""
SYNC_HIT_INVOCATION_ID=""
ASYNC_INVOCATION_ID=""

cleanup_e2e_resources() {
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    warn "Cleanup: E2E_KEEP=1 set — leaving e2e connector/webhook receiver in place"
    return 0
  fi
  log "Cleanup: removing this run's connector(s) and webhook receiver (best-effort)"

  local ids
  ids="$(api GET "/api/connectors?context=external" 2>/dev/null \
    | jq -r ".[]? | select(.name | startswith(\"${CONNECTOR_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  local id
  for id in $ids; do
    cleanup_delete "connector" "/api/connectors/${id}" "${id}"
  done

  kubectl delete pod "${WEBHOOK_RECEIVER_NAME}" -n "$NAMESPACE" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete svc "${WEBHOOK_RECEIVER_NAME}" -n "$NAMESPACE" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  log "Cleanup: done"
}

cleanup_delete() {
  local label="$1" path="$2" id="$3"
  local combined status body
  combined="$(api_status DELETE "$path" '{}' 2>/dev/null || true)"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  case "$status" in
    2??|404)
      log "Cleanup: deleted ${label} ${id} (status ${status})"
      ;;
    *)
      warn "Cleanup: failed to delete ${label} ${id} (status ${status}: ${body}) — non-fatal"
      ;;
  esac
}

on_exit() {
  local exit_code=$?
  cleanup_e2e_resources
  exit "$exit_code"
}
trap on_exit EXIT

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -w '\n%{http_code}' -X "$method" "${API_URL}${path}"
    -H "Host: ${HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_status_body() {
  local combined="$1"
  printf '%s' "${combined%$'\n'*}"
}

api_status_code() {
  local combined="$1"
  printf '%s' "${combined##*$'\n'}"
}

stage_login() {
  log "Stage 1: login as ${EMAIL} (tenant ${TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  if [[ -z "$TOKEN" ]]; then
    err "Login failed: $resp"
    return 1
  fi
}

stage_ensure_connector() {
  local name="${CONNECTOR_NAME_PREFIX}-${NONCE}"
  log "Stage 2: create connector '${name}' (baseUrl=${ADAPTER_BASE_URL}, GET /health, cache enabled)"

  # Best-effort hygiene: remove connectors from previous crashed runs.
  local stale
  stale="$(api GET "/api/connectors?context=external" \
    | jq -r ".[]? | select(.name | startswith(\"${CONNECTOR_NAME_PREFIX}\")) | .id" 2>/dev/null || true)"
  local sid
  for sid in $stale; do
    api DELETE "/api/connectors/${sid}" '{}' >/dev/null 2>&1 || true
  done

  local resp
  resp="$(api POST /api/connectors "$(cat <<JSON
{
  "name": "${name}",
  "context": "external",
  "baseUrl": "${ADAPTER_BASE_URL}",
  "endpoints": [
    {
      "label": "health",
      "method": "GET",
      "path": "/health",
      "cache": { "enabled": true, "ttlSeconds": 60, "methods": ["GET"] }
    }
  ]
}
JSON
)")"
  CONNECTOR_ID="$(echo "$resp" | jq -r '.id // empty')"
  if [[ -z "$CONNECTOR_ID" ]]; then
    err "Connector creation failed: $resp"
    return 1
  fi
  ENDPOINT_ID="$(echo "$resp" | jq -r '.endpoints[0].id // empty')"
  if [[ -z "$ENDPOINT_ID" ]]; then
    err "Connector creation response missing endpoints[0].id: $resp"
    return 1
  fi
  log "Connector created: ${CONNECTOR_ID} (endpoint ${ENDPOINT_ID})"
}

stage_deploy_webhook_receiver() {
  log "Stage 3: apply ephemeral webhook receiver (${WEBHOOK_RECEIVER_NAME})"
  # Tiny Bun HTTP server, no external deps: logs every POST body (prefixed
  # WEBHOOK_RECEIVED) to stdout so stage_verify_webhook_delivery can grep
  # `kubectl logs` for the invocationId. Runs off the connector-runtime image
  # (already local to the cluster, dev.local/connector-runtime:local — zero
  # extra image pulls) with a `bun -e` inline script, so no new ConfigMap/
  # volume mount is needed for the script body itself.
  #
  # SSRF/in-cluster finding: `validateOutboundUrl` (services/connector-runtime/
  # src/activities/_shared/validate-outbound-url.ts) rejects by LITERAL
  # hostname string (localhost/127.0.0.1/::1, 169.254.*, and RFC1918 dotted-
  # quad octets) — it never resolves DNS. A ClusterIP Service's in-cluster DNS
  # name (`<name>.<namespace>.svc.cluster.local`) is neither of those literal
  # forms, so it passes the guard even though it resolves to an RFC1918
  # ClusterIP — confirmed by this stage's webhook actually being invoked
  # below. In-cluster webhook receivers are therefore usable as the PRIMARY
  # delivery assertion here, not just the poll fallback.
  kubectl apply -n "$NAMESPACE" -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: ${WEBHOOK_RECEIVER_NAME}
  labels:
    app.kubernetes.io/name: ${WEBHOOK_RECEIVER_NAME}
spec:
  restartPolicy: Never
  containers:
    - name: receiver
      image: dev.local/connector-runtime:local
      imagePullPolicy: IfNotPresent
      command:
        - bun
        - -e
        - |
          Bun.serve({
            port: ${WEBHOOK_PORT},
            async fetch(req) {
              if (req.method === "POST") {
                const body = await req.text();
                console.log("WEBHOOK_RECEIVED " + body);
                return new Response("ok");
              }
              return new Response("ok");
            },
          });
          console.log("webhook receiver listening on ${WEBHOOK_PORT}");
      ports:
        - name: http
          containerPort: ${WEBHOOK_PORT}
      readinessProbe:
        tcpSocket:
          port: ${WEBHOOK_PORT}
        initialDelaySeconds: 1
        periodSeconds: 2
---
apiVersion: v1
kind: Service
metadata:
  name: ${WEBHOOK_RECEIVER_NAME}
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: ${WEBHOOK_RECEIVER_NAME}
  ports:
    - name: http
      port: ${WEBHOOK_PORT}
      targetPort: http
YAML

  if ! kubectl wait pod "${WEBHOOK_RECEIVER_NAME}" -n "$NAMESPACE" \
      --for=condition=Ready --timeout=60s >/dev/null 2>&1; then
    err "Webhook receiver pod never became Ready"
    kubectl logs "${WEBHOOK_RECEIVER_NAME}" -n "$NAMESPACE" 2>&1 || true
    return 1
  fi
  log "Webhook receiver ready at http://${WEBHOOK_RECEIVER_NAME}.${NAMESPACE}.svc.cluster.local:${WEBHOOK_PORT}"
}

# Set by stage_sync_invoke. NOT returned via `echo` + command substitution —
# log()/warn()/err() all write to stdout too (same as http-workflow.sh),
# so wrapping this function in `$(...)` would have captured the log lines
# into the "return value" right along with the invocationId. Assigning
# directly to a global and calling the function unwrapped avoids that trap.
LAST_SYNC_INVOCATION_ID=""

stage_sync_invoke() {
  # stage_sync_invoke <label> <expected-cache-result>
  #
  # `params.e2eNonce=$NONCE` (identical across BOTH calls this run, unique
  # PER RUN): the HTTP response cache key is `[tenantId, method,
  # canonicalUrl, headerParts, bodyPart]` (cache-policy.ts) — NOT scoped by
  # adapterId/endpointId — so two different connectors pointed at the same
  # baseUrl+path collide on the SAME cache entry. A finding from this task:
  # rerunning this script within the cache TTL (60s here) against a
  # freshly-created connector previously read a stale "hit" on the very
  # first call because a PRIOR run's cache entry for the identical resolved
  # URL was still warm. The query param busts that cross-run collision so
  # "miss" is deterministic regardless of how recently this script last ran.
  local label="$1" expected_cache="$2"
  log "Stage: sync invoke (${label}, expect cacheResult=${expected_cache})"
  local combined status body
  combined="$(api_status POST "/api/v1/connectors/${CONNECTOR_ID}/endpoints/${ENDPOINT_ID}/invoke" \
    "{\"args\":{\"method\":\"GET\",\"params\":{\"e2eNonce\":\"${NONCE}\"}}}")"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "Sync invoke (${label}) expected HTTP 200, got ${status}: ${body}"
    return 1
  fi
  local invocation_id
  invocation_id="$(echo "$body" | jq -r '.invocationId // empty')"
  if [[ -z "$invocation_id" ]]; then
    err "Sync invoke (${label}) response missing invocationId: ${body}"
    return 1
  fi
  log "Sync invoke (${label}) OK invocationId=${invocation_id}"
  LAST_SYNC_INVOCATION_ID="$invocation_id"
}

stage_async_invoke() {
  log "Stage: async invoke (mode=async, webhook -> in-cluster receiver)"
  local webhook_url="http://${WEBHOOK_RECEIVER_NAME}.${NAMESPACE}.svc.cluster.local:${WEBHOOK_PORT}/webhook"
  local combined status body
  combined="$(api_status POST "/api/v1/connectors/${CONNECTOR_ID}/endpoints/${ENDPOINT_ID}/invoke" \
    "{\"args\":{\"method\":\"GET\",\"params\":{\"e2eNonce\":\"${NONCE}\"}},\"mode\":\"async\",\"webhook\":{\"url\":\"${webhook_url}\"}}")"
  status="$(api_status_code "$combined")"
  body="$(api_status_body "$combined")"
  if [[ "$status" != "202" ]]; then
    err "Async invoke expected HTTP 202, got ${status}: ${body}"
    return 1
  fi
  ASYNC_INVOCATION_ID="$(echo "$body" | jq -r '.invocationId // empty')"
  if [[ -z "$ASYNC_INVOCATION_ID" ]]; then
    err "Async invoke response missing invocationId: ${body}"
    return 1
  fi
  log "Async invoke ACCEPTED invocationId=${ASYNC_INVOCATION_ID}"
}

stage_poll_async_completed() {
  log "Stage: poll GET /api/v1/connectors/invocations/${ASYNC_INVOCATION_ID} until completed (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local combined status body invocation_status
  while (( $(date +%s) < deadline )); do
    combined="$(api_status GET "/api/v1/connectors/invocations/${ASYNC_INVOCATION_ID}")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      invocation_status="$(echo "$body" | jq -r '.status // empty')"
      if [[ "$invocation_status" == "completed" ]]; then
        log "Async invocation ${ASYNC_INVOCATION_ID} completed: ${body}"
        return 0
      fi
      log "Async invocation ${ASYNC_INVOCATION_ID} status=${invocation_status}; retrying"
    else
      log "Poll returned status ${status}; retrying"
    fi
    sleep 2
  done
  err "Async invocation ${ASYNC_INVOCATION_ID} never reached completed within ${POLL_TIMEOUT_S}s (last status ${status}: ${body})"
  return 1
}

stage_verify_webhook_delivery() {
  log "Stage: poll webhook receiver logs for invocationId ${ASYNC_INVOCATION_ID} (timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local logs
  while (( $(date +%s) < deadline )); do
    logs="$(kubectl logs "${WEBHOOK_RECEIVER_NAME}" -n "$NAMESPACE" --since=10m 2>/dev/null || true)"
    if grep -q "WEBHOOK_RECEIVED" <<<"$logs" && grep -q "$ASYNC_INVOCATION_ID" <<<"$logs"; then
      log "Confirmed: webhook receiver logged a POST body containing invocationId ${ASYNC_INVOCATION_ID}"
      return 0
    fi
    sleep 2
  done
  err "Webhook receiver never logged invocationId ${ASYNC_INVOCATION_ID} within ${POLL_TIMEOUT_S}s"
  err "Webhook receiver logs:"
  echo "$logs" >&2 || true
  return 1
}

stage_verify_audit_event() {
  # stage_verify_audit_event <label> <invocationId> <expectedCacheResult|""> <expectRootCorrelation>
  #
  # Causal shape differs by mode (verified against
  # src/activities/_shared/invoke-request-publisher.ts /
  # handle-invoke-requested-message.ts):
  #   - sync (facade executes inline): NO causal parent to join ->
  #     endpoint_call_completed is a ROOT event (no causation_id).
  #   - async (consumer executes after dequeuing invoke_requested): the
  #     consumer explicitly threads `parsed.causal` (the invoke_requested
  #     envelope's OWN correlation/causation) into the completed event, so it
  #     is NEVER root — it always carries a causation_id (the invoke_requested
  #     event's id). This is the causal-sanity assertion for async: proof the
  #     async pipeline threads correlation end-to-end instead of starting a
  #     fresh, disconnected chain per hop.
  local label="$1" invocation_id="$2" expected_cache="$3" expect_root="$4"
  log "Stage: verify audit event for ${label} (resource=invocation/${invocation_id}, expectRoot=${expect_root}, timeout ${POLL_TIMEOUT_S}s)"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local combined status body match ok
  while (( $(date +%s) < deadline )); do
    combined="$(api_status GET "/api/tracking/events?type=connector.endpoint_call.completed.v1&resource=invocation/${invocation_id}&limit=5")" || true
    status="$(api_status_code "$combined")"
    body="$(api_status_body "$combined")"
    if [[ "$status" == "200" ]]; then
      match="$(echo "$body" | jq -c '.events[0] // empty')"
      if [[ -n "$match" ]]; then
        # Field names per tracking-ingester-service's EventRow
        # (build-events-query.ts): cacheResult surfaces as the `cache_status`
        # detail column, NOT nested under `payload` (the events-list
        # projection never returns the raw envelope payload).
        local causation cache_result correlation
        causation="$(echo "$match" | jq -r '.causation_id // empty')"
        cache_result="$(echo "$match" | jq -r '.cache_status // empty')"
        correlation="$(echo "$match" | jq -r '.correlation_id // empty')"
        ok=1
        if [[ "$expect_root" == "1" && -n "$causation" && "$causation" != "null" ]]; then
          err "${label}: expected root correlation (no causation_id), got ${causation}"
          ok=0
        fi
        if [[ "$expect_root" == "0" && ( -z "$causation" || "$causation" == "null" ) ]]; then
          err "${label}: expected a causal parent (causation_id) — async completion must thread invoke_requested's causal context, got none"
          ok=0
        fi
        if [[ -n "$expected_cache" && "$cache_result" != "$expected_cache" ]]; then
          err "${label}: expected cache_status=${expected_cache}, got ${cache_result}: ${match}"
          ok=0
        fi
        if [[ -z "$correlation" || "$correlation" == "null" ]]; then
          err "${label}: audit event missing correlation_id: ${match}"
          ok=0
        fi
        if [[ "$ok" == "1" ]]; then
          log "${label}: audit event OK (correlation_id=${correlation}, causation_id=${causation:-none}, cache_status=${cache_result:-n/a})"
          return 0
        fi
        return 1
      fi
      log "${label}: gateway returned 200 but no event yet; retrying"
    else
      log "${label}: gateway events endpoint returned status ${status}; retrying"
    fi
    sleep 2
  done
  err "${label}: no audit event found for invocation/${invocation_id} within ${POLL_TIMEOUT_S}s"
  return 1
}

main() {
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  command -v kubectl >/dev/null || { err "kubectl is required"; exit 1; }

  stage_login
  stage_ensure_connector
  stage_deploy_webhook_receiver

  stage_sync_invoke "miss" "miss"
  SYNC_MISS_INVOCATION_ID="$LAST_SYNC_INVOCATION_ID"
  stage_verify_audit_event "sync miss" "$SYNC_MISS_INVOCATION_ID" "miss" 1

  stage_sync_invoke "hit" "hit"
  SYNC_HIT_INVOCATION_ID="$LAST_SYNC_INVOCATION_ID"
  stage_verify_audit_event "sync hit" "$SYNC_HIT_INVOCATION_ID" "hit" 1

  stage_async_invoke
  stage_poll_async_completed
  stage_verify_webhook_delivery
  stage_verify_audit_event "async" "$ASYNC_INVOCATION_ID" "hit" 0

  log "E2E connector invoke round trip verified: sync miss=${SYNC_MISS_INVOCATION_ID} hit=${SYNC_HIT_INVOCATION_ID} async=${ASYNC_INVOCATION_ID}"
}

main "$@"
