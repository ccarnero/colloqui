#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: http-connectors  (declarative outbound HTTP connectors / adapters)
# =============================================================================
#
# Provisions a set of EXTERNAL HTTP connectors (platform "adapters") from the
# declarative JSON files in ./connectors, through the platform API. Each
# connector wraps a well-known public dev API so a workflow can call it with an
# `endpointCall` action (adapterId + endpointId | adapterId + url path).
#
# Connectors created (4 no-auth + 1 basic-auth):
#   jsonplaceholder      none   https://jsonplaceholder.typicode.com
#   httpbin              none   https://httpbin.org
#   pokeapi              none   https://pokeapi.co
#   catfacts             none   https://catfact.ninja
#   httpbin-basic-auth   basic  https://httpbin.org  (Authorization: Basic ...)
#
# The script is a true IDEMPOTENT UPSERT (safe to re-run):
#   1. Ensure the connector exists (create by name, or reuse the existing one).
#   2. Reconcile its endpoints — add any (method, path) declared in the config
#      that isn't registered yet, leaving already-present ones untouched.
# So enriching a config with new endpoints and re-running adds exactly the new
# ones. Duplicate creates / endpoints race to a 409 ("already exists"), which is
# also treated as success rather than an error.
#
# RECREATE=1: deletes all context=external connectors first, then re-provisions
# from the config files. Useful when connector state has drifted.
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - Gateway route : services/api-gateway/src/modules/connectors/connectors.controller.ts
#                     (global prefix `api` -> /api/connectors[, /:id, /:id/endpoints])
#   - Create/list   : services/connector-admin/src/modules/adapters/adapters.controller.ts
#                     + adapters.service.ts  (create/get return {id,...,endpoints[]};
#                     list returns an array; endpoint unique key is (method, path))
#   - Adapter shape : packages/shared/src/adapter.interfaces.ts (AdapterConfig)
#   - Basic auth    : packages/shared/src/adapter-auth-headers.ts
#                     (authType "basic" -> authConfig.basicUsername / basicPassword)
# -----------------------------------------------------------------------------
# HARD-WON GOTCHAS:
#  * The gateway has a global prefix `api`, so paths are /api/connectors (NOT
#    /connectors) and login is /api/auth/login.
#  * `context` MUST be "external" — these are third-party APIs, not the
#    internal-service mirror ("internal") that registry-service owns.
#  * Endpoint uniqueness is (method, path) PER connector, so GET /post and
#    POST /post are distinct rows. Reconcile matches on that exact pair.
#  * httpbin's /basic-auth/<user>/<passwd> echoes the EXPECTED creds in the URL
#    path, so the connector's basicUsername/basicPassword MUST match the path
#    segments. Overriding HTTPBIN_BASIC_USER / HTTPBIN_BASIC_PASS rewrites BOTH
#    the authConfig AND the basic-auth endpoint paths so they never drift.
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

# Connector context. These are third-party APIs => "external".
CONTEXT="external"

# Basic-auth credentials for the httpbin-basic-auth connector. The defaults
# (user/passwd) make https://httpbin.org/basic-auth/user/passwd return 200
# { "authenticated": true } out of the box. Override both to test a mismatch.
BASIC_USER="${HTTPBIN_BASIC_USER:-user}"
BASIC_PASS="${HTTPBIN_BASIC_PASS:-passwd}"

CONNECTORS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/connectors"

RECREATE="${RECREATE:-0}"

# ----- Pretty logging (verbose; nothing fails silently) ----------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
CREATED=0
REUSED=0
ENDPOINTS_ADDED=0
FAILED=0

# api <method> <path> [json-body] — authenticated, tenant-scoped JSON call.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -X "$method" "${YOIZEN_BASE_URL}${path}"
    -H "Host: ${YOIZEN_HOST_HEADER}"
    -H "Content-Type: application/json"
    -H "x-yoizen-tenant: ${YOIZEN_TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

# render_connector <file> — emit the connector body, applying basic-auth env
# overrides. For authType "basic": sets basicUsername/basicPassword and rewrites
# any /basic-auth or /hidden-basic-auth endpoint path to embed the same creds,
# so the sent Authorization header always matches httpbin's URL expectation.
render_connector() {
  local file="$1"
  jq \
    --arg user "$BASIC_USER" \
    --arg pass "$BASIC_PASS" \
    '
    if .authType == "basic" then
      .authConfig.basicUsername = $user
      | .authConfig.basicPassword = $pass
      | .endpoints |= map(
          if (.path // "") | test("^/(hidden-)?basic-auth/") then
            .path = ((.path | capture("^(?<p>/(hidden-)?basic-auth)/").p)
                     + "/" + $user + "/" + $pass)
          else . end)
    else . end
    ' "$file"
}

# resolve_id_by_name <name> — echo the id of the connector with this name, or "".
# Auto-heals duplicates: if more than one connector shares the name, deletes the
# extras (all but the first) and logs a warning. Returns the surviving id.
resolve_id_by_name() {
  local ids count
  ids="$(api GET "/api/connectors?context=${CONTEXT}" \
    | jq -r --arg n "$1" \
        'if type=="array" then [.[] | select(.name==$n) | .id] else [] end')"
  count="$(echo "$ids" | jq 'length')"
  if [[ "$count" -gt 1 ]]; then
    warn "duplicate connectors named '$1' (${count} found) — auto-healing, keeping first"
    local stale_id
    for stale_id in $(echo "$ids" | jq -r '.[1:] | .[]'); do
      log "  deleting duplicate connector ${stale_id}"
      api DELETE "/api/connectors/${stale_id}" >/dev/null 2>&1 || true
    done
  fi
  echo "$ids" | jq -r '.[0] // empty'
}

# reconcile_endpoints <id> <name> <body> — add any config endpoint whose
# (method, path) isn't already registered on the connector.
reconcile_endpoints() {
  local id="$1" name="$2" body="$3"
  local current added=0 n i

  current="$(api GET "/api/connectors/${id}" \
    | jq -c 'if type=="object" then (.endpoints // []) else [] end')"
  [[ -n "$current" ]] || current="[]"

  n="$(echo "$body" | jq -r '.endpoints | length')"
  for ((i = 0; i < n; i++)); do
    local ep method path label exists resp
    ep="$(echo "$body" | jq -c ".endpoints[$i]")"
    method="$(echo "$ep" | jq -r '.method')"
    path="$(echo "$ep" | jq -r '.path')"
    label="$(echo "$ep" | jq -r '.label')"

    exists="$(echo "$current" | jq -r --arg m "$method" --arg p "$path" \
      'map(select(.method == $m and .path == $p)) | length')"
    if [[ "${exists:-0}" -gt 0 ]]; then
      continue
    fi

    resp="$(api POST "/api/connectors/${id}/endpoints" "$ep")"
    if echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1; then
      log "    + ${method} ${path}  (${label})"
      added=$((added + 1)); ENDPOINTS_ADDED=$((ENDPOINTS_ADDED + 1))
    elif echo "$resp" | jq -e '((.message // "") | test("already exists"; "i"))' >/dev/null 2>&1; then
      : # raced with a concurrent run — already present, fine
    else
      warn "    ! ${method} ${path} failed: ${resp}"
      FAILED=$((FAILED + 1))
    fi
  done

  if [[ "$added" -eq 0 ]]; then
    log "    endpoints already up to date"
  fi
}

# upsert_connector <file> — ensure the connector exists, then reconcile its
# endpoints. Idempotent end to end.
upsert_connector() {
  local file="$1" body name id resp
  body="$(render_connector "$file")"
  name="$(echo "$body" | jq -r '.name // empty')"
  if [[ -z "$name" ]]; then
    err "config has no .name: $file"; FAILED=$((FAILED + 1)); return 0
  fi

  id="$(resolve_id_by_name "$name")"

  if [[ -n "$id" ]]; then
    log "reuse  '${name}' — exists (id=${id})"
    REUSED=$((REUSED + 1))
  else
    # Create the connector with NO inline endpoints, then let reconcile add them
    # all — so every endpoint addition is logged + counted uniformly, whether
    # the connector is brand new or pre-existing.
    resp="$(api POST /api/connectors "$(echo "$body" | jq '.endpoints = []')")"
    id="$(echo "$resp" | jq -r '.id // empty')"
    if [[ -n "$id" ]]; then
      log "create '${name}' (auth=$(echo "$body" | jq -r '.authType')) -> id=${id}"
      CREATED=$((CREATED + 1))
    elif echo "$resp" | jq -e \
        '(.statusCode == 409) or ((.message // "") | test("already exists"; "i"))' \
        >/dev/null 2>&1; then
      # Lost a race — re-resolve and continue to endpoint reconcile.
      id="$(resolve_id_by_name "$name")"
      warn "reuse  '${name}' — create returned 'already exists' (idempotent)"
      REUSED=$((REUSED + 1))
    else
      err "create FAILED for '${name}': ${resp}"
      FAILED=$((FAILED + 1)); return 0
    fi
  fi

  if [[ -z "$id" ]]; then
    err "could not resolve id for '${name}' — skipping endpoint reconcile"
    FAILED=$((FAILED + 1)); return 0
  fi
  reconcile_endpoints "$id" "$name" "$body"
}

# ----- Stage 0: preflight ----------------------------------------------------
stage_preflight() {
  step "0/3 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -d "$CONNECTORS_DIR" ]] || { err "connectors dir not found: $CONNECTORS_DIR"; exit 1; }

  local count
  count="$(find "$CONNECTORS_DIR" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')"
  [[ "$count" -gt 0 ]] || { err "no connector configs (*.json) in $CONNECTORS_DIR"; exit 1; }

  # Fail fast on a malformed config rather than half-provisioning.
  local f
  for f in "$CONNECTORS_DIR"/*.json; do
    jq empty "$f" >/dev/null 2>&1 || { err "invalid JSON: $f"; exit 1; }
  done

  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  context=${CONTEXT}  configs=${count}  recreate=${RECREATE}"
  log "basic-auth creds: ${BASIC_USER}/${BASIC_PASS} (override via HTTPBIN_BASIC_USER / HTTPBIN_BASIC_PASS)"
}

# ----- Stage 1: login --------------------------------------------------------
stage_login() {
  step "1/3 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

# ----- Stage recreate (optional): wipe all context=external connectors -------
stage_recreate() {
  [[ "${RECREATE}" == "1" ]] || return 0
  step "recreate — deleting all context=${CONTEXT} connectors"
  local ids id
  ids="$(api GET "/api/connectors?context=${CONTEXT}" | jq -r 'if type=="array" then .[].id else empty end')"
  for id in $ids; do
    log "  deleting connector ${id}"
    api DELETE "/api/connectors/${id}" >/dev/null 2>&1 || true
  done
  log "recreate done — provision will recreate from config files"
}

# ----- Stage 2: upsert every connector + reconcile its endpoints -------------
stage_provision() {
  step "2/3 upsert connectors from ${CONNECTORS_DIR}"
  local file
  for file in "$CONNECTORS_DIR"/*.json; do
    upsert_connector "$file"
  done
}

# ----- Stage 3: summary ------------------------------------------------------
stage_summary() {
  step "3/3 summary"
  log "connectors: created=${CREATED}  reused=${REUSED}   endpoints added=${ENDPOINTS_ADDED}   failed=${FAILED}"
  echo
  log "List them:  curl -s \"${YOIZEN_BASE_URL}/api/connectors?context=${CONTEXT}\" \\"
  log "              -H 'Host: ${YOIZEN_HOST_HEADER}' -H 'x-yoizen-tenant: ${YOIZEN_TENANT}' \\"
  log "              -H \"Authorization: Bearer \$TOKEN\" | jq '.[] | {name, authType, endpoints: (.endpoints|length)}'"
  log "Call one from a workflow via an 'endpointCall' action — see README.md."
  if [[ "$FAILED" -gt 0 ]]; then
    err "${FAILED} operation(s) failed — see [ERR]/[WARN] lines above."
    exit 1
  fi
}

main() {
  stage_preflight
  stage_login
  stage_recreate
  stage_provision
  stage_summary
}

main "$@"
