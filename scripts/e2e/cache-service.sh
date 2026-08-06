#!/usr/bin/env bash
set -euo pipefail

# Auto-load scripts/e2e/.env if present (same convention as connector-invoke.sh
# and scripts/reset/): every var below has a script-level ${VAR:-default}
# fallback, so anything set in .env wins over the hardcoded default.
E2E_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${E2E_SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${E2E_SCRIPT_DIR}/.env"
  set +a
fi

# End-to-end cluster check of cache-service (SPEC 01-bugs-group-b, T10/E36a)
# AND of its first platform consumer, connector-runtime's HTTP-response cache
# (T11/E36b, stage 10).
#
# cache-service has no NATS subject and no gateway route, so stages 1-9 talk
# to its own Knative route directly (http://cache-service.<ns>.dev.local,
# resolved to E2E_RESOLVE_IP like every other script here) with plain curl.
# They are the only executable proof the deployed service works; the service's
# own `bun test` integration suite covers the same contract in-process against
# a port-forwarded Redis.
#
# Stages, all against the DEPLOYED pod:
#   1. GET /health                      -> {"status":"ok","redis":"connected"}
#   2. PUT/GET object round trip        -> value comes back as application/json
#   3. PUT/GET string round trip        -> JSON-QUOTED string, application/json
#      (regression: strings used to be sent verbatim as text/plain, unparseable
#      by any JSON client, while every other type came back as JSON)
#   4. TTL expiry                       -> short TTL, poll GET until it is null
#   5. TTL written by another writer    -> a key SET straight into Redis with a
#      TTL (via kubectl exec, i.e. NOT through this pod's L1) must still expire
#      for the reader (regression: the Redis-hit backfill dropped the TTL and
#      pinned the value in L1 forever). Skipped when kubectl is unavailable.
#   6. POST /cache/batch                -> hits present, misses OMITTED
#   7. GET /cache?pattern=...           -> SCAN lists this run's keys
#   8. DELETE + GET                     -> {"ok":true} then null
#   9. Tenant scoping                   -> x-yoizen-tenant prefixes the key;
#      the same key without the header is a miss
#  10. CONSUMER (T11/E36b)              -> connector-runtime's HTTP-response
#      cache is backed by THIS service. Creates a throwaway connector with a
#      cached GET endpoint, invokes it through the api-gateway twice and
#      proves BOTH directions against cache-service's own API:
#        write: a new `httpcache:v1:*` key appears in SCAN after invoke #1
#               (cacheResult=miss) and reads back as a cached-response entry;
#        read:  that key is OVERWRITTEN through cache-service with a sentinel
#               body, and invoke #2 returns the SENTINEL (cacheResult=hit) —
#               only possible if connector-runtime read the entry from
#               cache-service rather than from Redis.
#      Needs api-gateway + connector-admin-api + connector-runtime-http
#      deployed; set E2E_CACHE_SKIP_CONSUMER=1 to run stages 1-9 alone.
#
# Every key this script writes is prefixed with a per-run nonce and deleted by
# an EXIT trap (best-effort, idempotent), success or failure — the dev cluster's
# Redis is shared with every other service.
#
# NOT part of scripts/e2e/run-all.sh's default sequence (same standing as
# long-agent-execution.sh): it validates one standalone service rather than a
# cross-service chain. Run it directly.
#
# Exit codes:
#   0  every stage passed
#   1  a stage failed
#   2  a prerequisite is missing (curl/jq) or the service is unreachable

NAMESPACE="${E2E_NAMESPACE:-platform-services-dev}"
CACHE_URL="${E2E_CACHE_URL:-http://cache-service.${NAMESPACE}.dev.local}"
HOST_HEADER="${E2E_CACHE_HOST_HEADER:-cache-service.${NAMESPACE}.dev.local}"
TENANT="${E2E_TENANT:-acme}"
TTL_SECONDS="${E2E_CACHE_TTL_SECONDS:-3}"
POLL_TIMEOUT_S="${E2E_CACHE_POLL_TIMEOUT_S:-60}"
REDIS_NAMESPACE="${E2E_REDIS_NAMESPACE:-support-services-dev}"
REDIS_POD="${E2E_REDIS_POD:-redis-0}"

# --- stage 10 (consumer) settings -------------------------------------------
# Same api-gateway defaults as connector-invoke.sh, which drives the same
# invoke contract; only used by the consumer stage.
API_URL="${E2E_API_URL:-http://api-gateway.platform-services-dev.dev.local}"
API_HOST_HEADER="${E2E_HOST_HEADER:-api-gateway.platform-services-dev.dev.local}"
EMAIL="${E2E_EMAIL:-yclawd@demo.io}"
PASSWORD="${E2E_PASSWORD:-admin123}"
CONSUMER_CONNECTOR_PREFIX="e2e-cache-consumer"
# connector-admin-api's own GET /health: always HTTP 200, same-namespace, and
# a hard dependency of the invoke path anyway (see connector-invoke.sh).
CONSUMER_ADAPTER_BASE_URL="http://connector-admin-api.${NAMESPACE}.svc.cluster.local"
# TTL for the connector's endpoint cache — long enough that invoke #2 always
# lands inside it, short enough that a leaked key expires on its own.
CONSUMER_CACHE_TTL_SECONDS="${E2E_CACHE_CONSUMER_TTL_SECONDS:-300}"
CONSUMER_KEY_TIMEOUT_S="${E2E_CACHE_CONSUMER_KEY_TIMEOUT_S:-20}"

E2E_RESOLVE_IP="${E2E_RESOLVE_IP-127.0.0.1}"
CACHE_SCHEME="${CACHE_URL%%://*}"
CACHE_HOST_PORT="${CACHE_URL#*://}"
CACHE_HOST_PORT="${CACHE_HOST_PORT%%/*}"
if [[ "$CACHE_HOST_PORT" == *:* ]]; then
  CACHE_PORT="${CACHE_HOST_PORT##*:}"
elif [[ "$CACHE_SCHEME" == "https" ]]; then
  CACHE_PORT=443
else
  CACHE_PORT=80
fi
RESOLVE_ARGS=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  RESOLVE_ARGS=(--resolve "${HOST_HEADER}:${CACHE_PORT}:${E2E_RESOLVE_IP}")
fi

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
API_RESOLVE_ARGS=()
if [[ -n "$E2E_RESOLVE_IP" ]]; then
  API_RESOLVE_ARGS=(--resolve "${API_HOST_HEADER}:${API_PORT}:${E2E_RESOLVE_IP}")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

NONCE="e2e-cache-$(date +%s)-$RANDOM"
KEY_PREFIX="e2e:${NONCE}"

# --- HTTP helpers -----------------------------------------------------------
# `Content-Type: application/json` is sent ONLY when there is a body: Fastify
# (and therefore every Nest+Fastify service here, not just this one) answers a
# bodyless DELETE that declares a JSON content type with
# `400 Body cannot be empty when content-type is set to 'application/json'`.
# Found by this script's DELETE stage — see services/cache-service/README.md.
#
# cache <method> <path> [body] [tenant]
#   Body-only response. `tenant` is the value of the x-yoizen-tenant header;
#   pass "" to send NO tenant header at all (the untenanted key namespace).
cache() {
  local method="$1" path="$2" body="${3:-}" tenant="${4:-}"
  local args=(-s --connect-timeout 10 --max-time 30 -X "$method" "${CACHE_URL}${path}"
    -H "Host: ${HOST_HEADER}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$tenant" ]] && args+=(-H "x-yoizen-tenant: ${tenant}")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}"
}

# cache_full <method> <path> [body] [tenant]
#   Response body, then a trailing line with "<http_code> <content_type>" so a
#   caller can assert the status and the content type without a second request.
cache_full() {
  local method="$1" path="$2" body="${3:-}" tenant="${4:-}"
  local args=(-s --connect-timeout 10 --max-time 30 -w '\n%{http_code} %{content_type}' -X "$method" "${CACHE_URL}${path}"
    -H "Host: ${HOST_HEADER}")
  [[ ${#RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${RESOLVE_ARGS[@]}")
  [[ -n "$tenant" ]] && args+=(-H "x-yoizen-tenant: ${tenant}")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}"
}

response_body() {
  printf '%s' "${1%$'\n'*}"
}

response_meta() {
  printf '%s' "${1##*$'\n'}"
}

response_code() {
  local meta
  meta="$(response_meta "$1")"
  printf '%s' "${meta%% *}"
}

response_content_type() {
  local meta
  meta="$(response_meta "$1")"
  printf '%s' "${meta#* }"
}

# --- api-gateway helpers (stage 10 only) ------------------------------------
# Same shape as connector-invoke.sh's `api`/`api_status`: bearer token when
# logged in, tenant header always, body only when provided.
CONSUMER_TOKEN=""

# api <method> <path> [body] — body-only response.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -X "$method" "${API_URL}${path}"
    -H "Host: ${API_HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#API_RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${API_RESOLVE_ARGS[@]}")
  [[ -n "$CONSUMER_TOKEN" ]] && args+=(-H "Authorization: Bearer ${CONSUMER_TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

# api_status <method> <path> [body] — body, then a trailing line with the code.
api_status() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s --connect-timeout 10 --max-time 45 -w '\n%{http_code}' -X "$method" "${API_URL}${path}"
    -H "Host: ${API_HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${TENANT}")
  [[ ${#API_RESOLVE_ARGS[@]} -gt 0 ]] && args+=("${API_RESOLVE_ARGS[@]}")
  [[ -n "$CONSUMER_TOKEN" ]] && args+=(-H "Authorization: Bearer ${CONSUMER_TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

api_body() {
  printf '%s' "${1%$'\n'*}"
}

api_code() {
  printf '%s' "${1##*$'\n'}"
}

# --- cleanup ----------------------------------------------------------------
CLEANUP_KEYS=""

track_key() {
  # <key> [tenant] — recorded as "tenant|key"; tenant "" means untenanted.
  CLEANUP_KEYS="${CLEANUP_KEYS}${2:-}|${1}
"
}

cleanup_keys() {
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    warn "Cleanup: E2E_KEEP=1 set — leaving this run's keys (${KEY_PREFIX}*) in Redis"
    return 0
  fi
  [[ -z "$CLEANUP_KEYS" ]] && return 0
  log "Cleanup: deleting this run's keys (best-effort)"
  local entry tenant key
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    tenant="${entry%%|*}"
    key="${entry#*|}"
    cache DELETE "/cache/${key}" "" "$tenant" >/dev/null 2>&1 || true
  done <<EOF
${CLEANUP_KEYS}
EOF
  log "Cleanup: done"
}

cleanup_consumer_connectors() {
  # Stage 10's throwaway connector(s). Best-effort and idempotent: also sweeps
  # leftovers from an earlier crashed run, same as connector-invoke.sh.
  [[ -z "$CONSUMER_TOKEN" ]] && return 0
  if [[ "${E2E_KEEP:-0}" == "1" ]]; then
    warn "Cleanup: E2E_KEEP=1 set — leaving this run's ${CONSUMER_CONNECTOR_PREFIX}-* connector(s)"
    return 0
  fi
  local ids id
  ids="$(api GET "/api/connectors?context=external" 2>/dev/null \
    | jq -r ".[]? | select(.name | startswith(\"${CONSUMER_CONNECTOR_PREFIX}\")) | .id" 2>/dev/null || true)"
  for id in $ids; do
    api DELETE "/api/connectors/${id}" '{}' >/dev/null 2>&1 || true
    log "Cleanup: deleted consumer connector ${id}"
  done
}

on_exit() {
  local exit_code=$?
  cleanup_consumer_connectors
  cleanup_keys
  exit "$exit_code"
}
trap on_exit EXIT

# --- stages -----------------------------------------------------------------
stage_health() {
  log "Stage 1: GET /health on ${CACHE_URL}"
  local combined status body health redis
  combined="$(cache_full GET /health)" || {
    err "cache-service unreachable at ${CACHE_URL} (curl failed)"
    exit 2
  }
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "GET /health expected HTTP 200, got ${status}: ${body}"
    exit 2
  fi
  health="$(echo "$body" | jq -r '.status // empty')"
  redis="$(echo "$body" | jq -r '.redis // empty')"
  if [[ "$health" != "ok" || "$redis" != "connected" ]]; then
    err "GET /health expected {status:ok, redis:connected}, got: ${body}"
    return 1
  fi
  log "Health OK (status=${health}, redis=${redis})"
}

stage_object_round_trip() {
  local key="${KEY_PREFIX}:object"
  log "Stage 2: PUT/GET object round trip (${key})"
  track_key "$key"

  local combined status body
  combined="$(cache_full PUT "/cache/${key}" "{\"value\":{\"nonce\":\"${NONCE}\",\"nested\":{\"n\":1}},\"ttl\":300}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" || "$(echo "$body" | jq -r '.ok // empty')" != "true" ]]; then
    err "PUT expected HTTP 200 {ok:true}, got ${status}: ${body}"
    return 1
  fi

  combined="$(cache_full GET "/cache/${key}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  local content_type
  content_type="$(response_content_type "$combined")"
  if [[ "$status" != "200" ]]; then
    err "GET expected HTTP 200, got ${status}: ${body}"
    return 1
  fi
  if [[ "$content_type" != application/json* ]]; then
    err "GET expected application/json, got '${content_type}': ${body}"
    return 1
  fi
  local got_nonce got_nested
  got_nonce="$(echo "$body" | jq -r '.nonce // empty')"
  got_nested="$(echo "$body" | jq -r '.nested.n // empty')"
  if [[ "$got_nonce" != "$NONCE" || "$got_nested" != "1" ]]; then
    err "GET returned an unexpected value: ${body}"
    return 1
  fi
  log "Object round trip OK (content-type=${content_type})"
}

stage_string_round_trip() {
  local key="${KEY_PREFIX}:string"
  log "Stage 3: PUT/GET string round trip (${key}) — must be JSON, not text/plain"
  track_key "$key"

  cache PUT "/cache/${key}" "{\"value\":\"plain-${NONCE}\"}" >/dev/null

  local combined status body content_type parsed
  combined="$(cache_full GET "/cache/${key}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  content_type="$(response_content_type "$combined")"
  if [[ "$status" != "200" ]]; then
    err "GET expected HTTP 200, got ${status}: ${body}"
    return 1
  fi
  if [[ "$content_type" != application/json* ]]; then
    err "GET of a STRING value returned '${content_type}' instead of application/json — the raw-string regression is back: ${body}"
    return 1
  fi
  if [[ "$body" != "\"plain-${NONCE}\"" ]]; then
    err "GET of a STRING value must be JSON-quoted, got: ${body}"
    return 1
  fi
  parsed="$(echo "$body" | jq -r '.')"
  if [[ "$parsed" != "plain-${NONCE}" ]]; then
    err "GET of a STRING value did not survive a JSON parse: ${body}"
    return 1
  fi
  log "String round trip OK (JSON-quoted, content-type=${content_type})"
}

# poll_until_null <key> <label> [tenant]
#   Polls GET /cache/<key> until the body is JSON null. Fails on timeout.
poll_until_null() {
  local key="$1" label="$2" tenant="${3:-}"
  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  local body
  while (( $(date +%s) < deadline )); do
    body="$(cache GET "/cache/${key}" "" "$tenant")"
    if [[ "$body" == "null" ]]; then
      log "${label}: key expired (GET -> null)"
      return 0
    fi
    sleep 1
  done
  err "${label}: key ${key} still readable after ${POLL_TIMEOUT_S}s — TTL was not honored (last body: ${body})"
  return 1
}

stage_ttl_expiry() {
  local key="${KEY_PREFIX}:ttl"
  log "Stage 4: TTL expiry via PUT ttl=${TTL_SECONDS}s (${key})"
  track_key "$key"

  cache PUT "/cache/${key}" "{\"value\":\"expires-${NONCE}\",\"ttl\":${TTL_SECONDS}}" >/dev/null

  local body
  body="$(cache GET "/cache/${key}")"
  if [[ "$body" != "\"expires-${NONCE}\"" ]]; then
    err "Key is not readable immediately after PUT with a TTL: ${body}"
    return 1
  fi
  log "Key readable before expiry; polling until it disappears"
  poll_until_null "$key" "TTL expiry"
}

stage_ttl_from_foreign_writer() {
  local key="${KEY_PREFIX}:foreign-ttl"
  log "Stage 5: TTL set by another writer straight in Redis (${key})"
  if ! command -v kubectl >/dev/null 2>&1; then
    warn "kubectl not available — skipping the foreign-writer TTL stage"
    return 0
  fi
  if ! kubectl get pod "$REDIS_POD" -n "$REDIS_NAMESPACE" >/dev/null 2>&1; then
    warn "Redis pod ${REDIS_POD} not found in ${REDIS_NAMESPACE} — skipping the foreign-writer TTL stage"
    return 0
  fi
  track_key "$key"

  # SET straight into Redis: the pod has never seen this key, so the first GET
  # takes the Redis-hit + L1-backfill path — the one that used to drop the TTL.
  if ! kubectl exec -n "$REDIS_NAMESPACE" "$REDIS_POD" -- \
      redis-cli SET "$key" "\"foreign-${NONCE}\"" EX "$TTL_SECONDS" >/dev/null 2>&1; then
    warn "redis-cli SET failed inside ${REDIS_POD} — skipping the foreign-writer TTL stage"
    return 0
  fi

  local body
  body="$(cache GET "/cache/${key}")"
  if [[ "$body" != "\"foreign-${NONCE}\"" ]]; then
    err "Key written directly in Redis is not readable through the service: ${body}"
    return 1
  fi
  log "Foreign-written key read through the service (L1 backfilled); polling until it expires"
  poll_until_null "$key" "Foreign-writer TTL"
}

stage_batch() {
  local k1="${KEY_PREFIX}:batch1"
  local k2="${KEY_PREFIX}:batch2"
  local missing="${KEY_PREFIX}:batch-missing"
  log "Stage 6: POST /cache/batch (2 hits + 1 miss)"
  track_key "$k1"
  track_key "$k2"

  cache PUT "/cache/${k1}" '{"value":{"i":1}}' >/dev/null
  cache PUT "/cache/${k2}" '{"value":"two"}' >/dev/null

  local combined status body
  combined="$(cache_full POST /cache/batch "{\"keys\":[\"${k1}\",\"${k2}\",\"${missing}\"]}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "POST /cache/batch expected HTTP 200 (not 201), got ${status}: ${body}"
    return 1
  fi
  local got1 got2 has_missing
  got1="$(echo "$body" | jq -r --arg k "$k1" '.[$k].i // empty')"
  got2="$(echo "$body" | jq -r --arg k "$k2" '.[$k] // empty')"
  has_missing="$(echo "$body" | jq -r --arg k "$missing" 'has($k)')"
  if [[ "$got1" != "1" || "$got2" != "two" ]]; then
    err "Batch GET returned unexpected values: ${body}"
    return 1
  fi
  if [[ "$has_missing" != "false" ]]; then
    err "Batch GET must OMIT missing keys, got: ${body}"
    return 1
  fi
  log "Batch GET OK (hits returned, miss omitted)"
}

stage_scan() {
  log "Stage 7: GET /cache?pattern=${KEY_PREFIX}:batch*"
  local combined status body count
  combined="$(cache_full GET "/cache?pattern=${KEY_PREFIX}:batch*&count=100")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" ]]; then
    err "SCAN expected HTTP 200, got ${status}: ${body}"
    return 1
  fi
  count="$(echo "$body" | jq -r --arg p "${KEY_PREFIX}:batch" '[.[] | select(startswith($p))] | length')"
  if [[ "$count" != "2" ]]; then
    err "SCAN expected exactly this run's 2 batch keys, got ${count}: ${body}"
    return 1
  fi
  log "SCAN OK (2 keys matched)"
}

stage_delete() {
  local key="${KEY_PREFIX}:delete"
  log "Stage 8: DELETE then GET (${key})"
  track_key "$key"

  cache PUT "/cache/${key}" '{"value":{"doomed":true}}' >/dev/null

  local combined status body
  combined="$(cache_full DELETE "/cache/${key}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" || "$(echo "$body" | jq -r '.ok // empty')" != "true" ]]; then
    err "DELETE expected HTTP 200 {ok:true}, got ${status}: ${body}"
    return 1
  fi

  combined="$(cache_full GET "/cache/${key}")"
  status="$(response_code "$combined")"
  body="$(response_body "$combined")"
  if [[ "$status" != "200" || "$body" != "null" ]]; then
    err "GET after DELETE expected HTTP 200 with body null, got ${status}: ${body}"
    return 1
  fi
  log "DELETE OK (subsequent GET is null)"
}

stage_tenant_scoping() {
  local key="${KEY_PREFIX}:tenant"
  log "Stage 9: tenant scoping via x-yoizen-tenant: ${TENANT} (${key})"
  track_key "$key" "$TENANT"

  cache PUT "/cache/${key}" "{\"value\":\"tenant-${NONCE}\"}" "$TENANT" >/dev/null

  local tenanted untenanted
  tenanted="$(cache GET "/cache/${key}" "" "$TENANT")"
  if [[ "$tenanted" != "\"tenant-${NONCE}\"" ]]; then
    err "GET with the tenant header did not return the tenant-scoped value: ${tenanted}"
    return 1
  fi
  untenanted="$(cache GET "/cache/${key}")"
  if [[ "$untenanted" != "null" ]]; then
    err "GET WITHOUT the tenant header must miss the tenant-scoped key, got: ${untenanted}"
    return 1
  fi
  log "Tenant scoping OK (${TENANT}:${key} invisible without the header)"
}

# --- stage 10: connector-runtime consumer (T11/E36b) -------------------------
# Set by the helpers below.
CONSUMER_CONNECTOR_ID=""
CONSUMER_ENDPOINT_ID=""
CONSUMER_CACHE_KEYS=""

# scan_httpcache_keys — newline-separated list of every `httpcache:v1:*` key
# currently visible through cache-service's SCAN endpoint (untenanted
# namespace: connector-runtime does NOT send x-yoizen-tenant, its key already
# hashes the tenant id — see cache-service-store.ts).
scan_httpcache_keys() {
  cache GET "/cache?pattern=httpcache:v1:*&count=10000" \
    | jq -r '.[]? // empty' 2>/dev/null || true
}

consumer_login() {
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"tenant_id\":\"${TENANT}\"}")"
  CONSUMER_TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  if [[ -z "$CONSUMER_TOKEN" ]]; then
    err "Stage 10: login as ${EMAIL} failed (api-gateway at ${API_URL}): ${resp}"
    return 1
  fi
  log "Stage 10: logged in as ${EMAIL} (tenant ${TENANT})"
}

consumer_create_connector() {
  local name="${CONSUMER_CONNECTOR_PREFIX}-${NONCE}"
  local resp
  resp="$(api POST /api/connectors "$(cat <<JSON
{
  "name": "${name}",
  "context": "external",
  "baseUrl": "${CONSUMER_ADAPTER_BASE_URL}",
  "endpoints": [
    {
      "label": "health",
      "method": "GET",
      "path": "/health",
      "cache": { "enabled": true, "ttlSeconds": ${CONSUMER_CACHE_TTL_SECONDS}, "methods": ["GET"] }
    }
  ]
}
JSON
)")"
  CONSUMER_CONNECTOR_ID="$(echo "$resp" | jq -r '.id // empty')"
  CONSUMER_ENDPOINT_ID="$(echo "$resp" | jq -r '.endpoints[0].id // empty')"
  if [[ -z "$CONSUMER_CONNECTOR_ID" || -z "$CONSUMER_ENDPOINT_ID" ]]; then
    err "Stage 10: connector creation failed: ${resp}"
    return 1
  fi
  log "Stage 10: connector ${CONSUMER_CONNECTOR_ID} created (endpoint ${CONSUMER_ENDPOINT_ID}, cache ttl ${CONSUMER_CACHE_TTL_SECONDS}s)"
}

# consumer_invoke — echoes ONLY the invoke response body (no log lines), so it
# is safe inside `$(...)`. `params.e2eNonce` makes the cache key unique per
# run: the key hashes the resolved URL, NOT the connector id, so without it a
# previous run's still-warm entry would make invoke #1 a HIT.
consumer_invoke() {
  local combined status body
  combined="$(api_status POST \
    "/api/v1/connectors/${CONSUMER_CONNECTOR_ID}/endpoints/${CONSUMER_ENDPOINT_ID}/invoke" \
    "{\"args\":{\"method\":\"GET\",\"params\":{\"e2eNonce\":\"${NONCE}\"}}}")"
  status="$(api_code "$combined")"
  body="$(api_body "$combined")"
  if [[ "$status" != "200" ]]; then
    printf '%s' "{\"__httpStatus\":${status},\"__body\":$(jq -Rs . <<<"$body")}"
    return 0
  fi
  printf '%s' "$body"
}

stage_consumer_http_response_cache() {
  log "Stage 10: connector-runtime HTTP-response cache is served by cache-service (T11/E36b)"
  if [[ "${E2E_CACHE_SKIP_CONSUMER:-0}" == "1" ]]; then
    warn "E2E_CACHE_SKIP_CONSUMER=1 — skipping the consumer stage"
    return 0
  fi

  consumer_login || return 1
  consumer_create_connector || return 1

  local before after
  before="$(scan_httpcache_keys)"

  # --- invoke #1: expect a MISS, i.e. a fresh upstream call that WRITES the
  # response into cache-service.
  local first cache_result
  first="$(consumer_invoke)"
  cache_result="$(echo "$first" | jq -r '.cacheResult // empty')"
  if [[ "$(echo "$first" | jq -r '.__httpStatus // empty')" != "" ]]; then
    err "Stage 10: invoke #1 did not return HTTP 200: ${first}"
    return 1
  fi
  if [[ "$cache_result" != "miss" ]]; then
    err "Stage 10: invoke #1 expected cacheResult=miss, got '${cache_result}': ${first}"
    return 1
  fi
  log "Stage 10: invoke #1 OK (cacheResult=miss)"

  # The store write is fire-and-forget (`void cache.setex(...)` in
  # cached-fetch.ts), so the key can land a beat after the HTTP response —
  # poll instead of asserting immediately.
  #
  # The diff is against the keys seen BEFORE invoke #1, so it is normally
  # exactly this run's key. If another connector call happens to write in the
  # same window its key is swept in too: it gets the sentinel and is deleted
  # by the EXIT trap — harmless for a cache (the next call re-fetches), but it
  # is why this stage is not safe to run against a production namespace.
  local deadline=$(( $(date +%s) + CONSUMER_KEY_TIMEOUT_S ))
  local new_keys=""
  while (( $(date +%s) < deadline )); do
    after="$(scan_httpcache_keys)"
    new_keys="$(comm -13 <(printf '%s\n' "$before" | sort) <(printf '%s\n' "$after" | sort) | sed '/^$/d')"
    [[ -n "$new_keys" ]] && break
    sleep 1
  done
  if [[ -z "$new_keys" ]]; then
    err "Stage 10: no new httpcache:v1:* key appeared in cache-service within ${CONSUMER_KEY_TIMEOUT_S}s — connector-runtime did NOT write its HTTP-response cache through cache-service"
    return 1
  fi
  log "Stage 10: WRITE proven — new key(s) visible through cache-service SCAN:"
  local key
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    CONSUMER_CACHE_KEYS="${CONSUMER_CACHE_KEYS}${key}
"
    track_key "$key"
    log "  ${key}"
  done <<EOF
${new_keys}
EOF

  # The stored value must be an HTTP-response cache entry, serialized as a
  # JSON *string* (the store hands `AdapterCache.setex` a JSON string).
  local first_key entry
  first_key="$(printf '%s' "$CONSUMER_CACHE_KEYS" | head -1)"
  entry="$(cache GET "/cache/${first_key}")"
  if ! echo "$entry" | jq -e 'fromjson? | (.status and .bodyBase64 and .headers)' >/dev/null 2>&1; then
    err "Stage 10: key ${first_key} does not hold an HTTP-response cache entry: ${entry}"
    return 1
  fi
  log "Stage 10: entry readable through cache-service (status/bodyBase64/headers present)"

  # --- invoke #2: overwrite every new key with a SENTINEL body through
  # cache-service, then invoke again. Getting the sentinel back is only
  # possible if connector-runtime READ the entry from cache-service.
  local sentinel_body sentinel_b64 sentinel_entry
  sentinel_body="{\"sentinel\":\"${NONCE}\"}"
  sentinel_b64="$(printf '%s' "$sentinel_body" | base64 | tr -d '\n')"
  sentinel_entry="$(jq -nc --arg b "$sentinel_b64" \
    '{status:200,bodyBase64:$b,headers:{"content-type":"application/json"},storedAtMs:0}')"
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    cache PUT "/cache/${key}" \
      "$(jq -nc --arg v "$sentinel_entry" --argjson t "$CONSUMER_CACHE_TTL_SECONDS" '{value:$v,ttl:$t}')" \
      >/dev/null
  done <<EOF
${CONSUMER_CACHE_KEYS}
EOF
  log "Stage 10: sentinel entry written through cache-service for this run's key(s)"

  local second sentinel_seen
  second="$(consumer_invoke)"
  cache_result="$(echo "$second" | jq -r '.cacheResult // empty')"
  sentinel_seen="$(echo "$second" | jq -r '.data.sentinel // empty')"
  if [[ "$cache_result" != "hit" ]]; then
    err "Stage 10: invoke #2 expected cacheResult=hit, got '${cache_result}': ${second}"
    return 1
  fi
  if [[ "$sentinel_seen" != "$NONCE" ]]; then
    err "Stage 10: invoke #2 was a hit but did NOT return the sentinel written through cache-service (got '${sentinel_seen}') — connector-runtime read the response from somewhere else: ${second}"
    return 1
  fi
  log "Stage 10: READ proven — invoke #2 returned the cache-service-written sentinel (cacheResult=hit)"
}

main() {
  command -v curl >/dev/null || { err "curl is required"; exit 2; }
  command -v jq >/dev/null || { err "jq is required"; exit 2; }

  log "Target: ${CACHE_URL} (Host: ${HOST_HEADER}, resolve ${E2E_RESOLVE_IP:-none}), key prefix ${KEY_PREFIX}"

  stage_health
  stage_object_round_trip
  stage_string_round_trip
  stage_ttl_expiry
  stage_ttl_from_foreign_writer
  stage_batch
  stage_scan
  stage_delete
  stage_tenant_scoping
  stage_consumer_http_response_cache

  log "cache-service e2e verified: CRUD, TTL expiry (own + foreign writer), batch, SCAN, tenant scoping, connector-runtime HTTP-response cache (write + read)"
}

main "$@"
