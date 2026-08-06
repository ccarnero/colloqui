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

# End-to-end cluster check of cache-service (SPEC 01-bugs-group-b, T10/E36a).
#
# cache-service is a standalone HTTP service — no NATS, no gateway route, no
# platform consumer until connector-runtime is wired to it — so this script
# talks to its own Knative route directly (http://cache-service.<ns>.dev.local,
# resolved to E2E_RESOLVE_IP like every other script here) with plain curl. It
# is the only executable proof the deployed service works; the service's own
# `bun test` integration suite covers the same contract in-process against a
# port-forwarded Redis.
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

on_exit() {
  local exit_code=$?
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

  log "cache-service e2e verified: CRUD, TTL expiry (own + foreign writer), batch, SCAN, tenant scoping"
}

main "$@"
