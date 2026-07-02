#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: hosted-services-api
# =============================================================================
# Registers a tenant-scoped Knative-backed hosted service through the gateway
# registry API, creates a dynamic route for it, and prints the public invoke URL.
#
# API surface verified in code:
#   - services/api-gateway/src/modules/registry/registry.controller.ts
#       /api/registry/services, /api/registry/services/:id/routes
#   - services/registry-service/src/modules/services/services.service.ts
#       creates/updates Knative Service resources and stores service metadata
#   - services/registry-service/src/modules/routes/routes.service.ts
#       creates pathPrefix routes and route discovery rows
#   - services/api-gateway/src/hooks/proxy.hook.ts
#       proxies non-platform paths to <knativeName>.<namespace>.svc.cluster.local
#
# Idempotent: reuses/updates the service by name and reuses the matching route.
# Set RECREATE=1 to delete and rebuild the sample resources.
# =============================================================================

SERVICE_NAME="${HOSTED_SERVICE_NAME:-sample-echo}"
SERVICE_IMAGE="${HOSTED_SERVICE_IMAGE:-ealen/echo-server:latest}"
SERVICE_PORT="${HOSTED_SERVICE_PORT:-8080}"
MIN_SCALE="${HOSTED_MIN_SCALE:-0}"
MAX_SCALE="${HOSTED_MAX_SCALE:-2}"
CONCURRENCY_TARGET="${HOSTED_CONCURRENCY_TARGET:-25}"
ROUTE_PREFIX="${HOSTED_ROUTE_PREFIX:-/samples/hosted-echo}"
ROUTE_PUBLIC="${HOSTED_ROUTE_PUBLIC:-true}"
ROUTE_STRIP_PREFIX="${HOSTED_ROUTE_STRIP_PREFIX:-true}"
ROUTE_METHODS="${HOSTED_ROUTE_METHODS:-GET,POST}"
WORKFLOW_ENABLED="${HOSTED_WORKFLOW_ENABLED:-1}"
WORKFLOW_NAME="${HOSTED_WORKFLOW_NAME:-hosted-service-telegram}"
APPLICATION="${HOSTED_WORKFLOW_APPLICATION:-samples}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"
HTTP_EXTERNAL_ID="${HOSTED_HTTP_EXTERNAL_ID:-hosted-services-api}"
HTTP_ACCOUNT_NAME="${HOSTED_HTTP_ACCOUNT_NAME:-Hosted Services API}"
HOSTED_WORKFLOW_PIN="${HOSTED_WORKFLOW_PIN:-1}"
RECREATE="${RECREATE:-0}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
SERVICE_ID=""
ROUTE_ID=""
WORKFLOW_ID=""
HTTP_ACCOUNT_ID=""
HTTP_APP_SECRET=""

read -r -d '' SUMMARY_CODE <<'JS' || true
(ctx) => {
  var inbound = (ctx.request && ctx.request.text) || "";
  var call = ctx.results.invokeHosted || {};
  var data = call.data || {};
  var path = data.path || data.url || data.originalUrl || "/anything";
  var body = data.body || data.data || {};
  var workflowName = body.workflowName || "hosted-service-telegram";
  var serviceName = body.serviceName || "sample-echo";
  var marker = "HOSTED SERVICE SAMPLE";
  return {
    text:
      marker + "\n" +
      "Workflow: " + workflowName + "\n" +
      "Inbound: " + (inbound || "-") + "\n" +
      "Hosted service: " + serviceName + "\n" +
      "Status: " + (call.status || "-") + "\n" +
      "Echo path: " + path + "\n" +
      "Echo body: " + JSON.stringify(body)
  };
}
JS

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -X "$method" "${YOIZEN_BASE_URL}${path}"
    -H "Host: ${YOIZEN_HOST_HEADER}"
    -H "x-yoizen-tenant: ${YOIZEN_TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  # Content-Type is only set when there's a body: Fastify's JSON body parser
  # 400s on "Body cannot be empty when content-type is set to
  # 'application/json'" for bodyless DELETE/GET calls sent with that header.
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}"
}

parse_bool() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y) printf 'true' ;;
    0|false|no|n) printf 'false' ;;
    *) err "invalid boolean '$1'"; exit 1 ;;
  esac
}

methods_json() {
  printf '%s' "$ROUTE_METHODS" | jq -R 'split(",") | map(gsub("^\\s+|\\s+$"; "") | ascii_upcase) | map(select(length > 0))'
}

service_body() {
  jq -n \
    --arg name "$SERVICE_NAME" \
    --arg image "$SERVICE_IMAGE" \
    --argjson port "$SERVICE_PORT" \
    --argjson minScale "$MIN_SCALE" \
    --argjson maxScale "$MAX_SCALE" \
    --argjson concurrencyTarget "$CONCURRENCY_TARGET" \
    '{ name: $name, image: $image, port: $port, minScale: $minScale,
       maxScale: $maxScale, concurrencyTarget: $concurrencyTarget,
       envVars: { YOIZEN_SAMPLE: "hosted-services-api" } }'
}

service_update_body() {
  service_body | jq 'del(.name)'
}

route_body() {
  jq -n \
    --arg pathPrefix "$ROUTE_PREFIX" \
    --argjson methods "$(methods_json)" \
    --argjson isPublic "$(parse_bool "$ROUTE_PUBLIC")" \
    --argjson stripPrefix "$(parse_bool "$ROUTE_STRIP_PREFIX")" \
    '{ pathPrefix: $pathPrefix, methods: $methods, isPublic: $isPublic, stripPrefix: $stripPrefix }'
}

workflow_enabled() {
  [[ "$(parse_bool "$WORKFLOW_ENABLED")" == "true" ]]
}

ensure_http_account() {
  local accounts all_ids keep_id
  accounts="$(api GET "/api/channels/accounts?channel=http")"

  all_ids="$(echo "$accounts" | jq -r --arg e "$HTTP_EXTERNAL_ID" \
    '[.[] | select(.externalId==$e) | select(.isActive)] | reverse | .[].id')"

  keep_id="$(echo "$all_ids" | head -1)"
  for stale_id in $(echo "$all_ids" | tail -n +2); do
    log "removing duplicate HTTP instance ${stale_id}"
    api DELETE "/api/channels/accounts/${stale_id}" >/dev/null 2>&1 || true
  done

  if [[ -n "$keep_id" && "$RECREATE" != "1" ]]; then
    HTTP_ACCOUNT_ID="$keep_id"
    HTTP_APP_SECRET="$(echo "$accounts" | jq -r --arg id "$keep_id" \
      '.[] | select(.id == $id) | .appSecret // empty')"
    log "reusing HTTP instance ${HTTP_ACCOUNT_ID} (externalId=${HTTP_EXTERNAL_ID})"
    return 0
  fi

  if [[ -n "$keep_id" ]]; then
    log "RECREATE=1 — removing HTTP instance ${keep_id}"
    api DELETE "/api/channels/accounts/${keep_id}" >/dev/null 2>&1 || true
  fi

  local body resp
  body="$(jq -n --arg name "$HTTP_ACCOUNT_NAME" --arg ext "$HTTP_EXTERNAL_ID" \
    '{ channel: "http", provider: "http", name: $name, externalId: $ext,
       accessToken: "http-ingest", isActive: true }')"
  resp="$(api POST /api/channels/accounts "$body")"
  HTTP_ACCOUNT_ID="$(echo "$resp" | jq -r '.id // empty')"
  HTTP_APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  [[ -n "$HTTP_ACCOUNT_ID" ]] || { err "HTTP instance creation failed: ${resp}"; exit 1; }
  log "created HTTP instance ${HTTP_ACCOUNT_ID} (externalId=${HTTP_EXTERNAL_ID})"
}

stage_preflight() {
  step "0/5 preflight"
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ "$ROUTE_PREFIX" == /* ]] || { err "HOSTED_ROUTE_PREFIX must start with /"; exit 1; }
  [[ "$SERVICE_NAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
    err "HOSTED_SERVICE_NAME must be lowercase alphanumeric with optional hyphens"; exit 1; }
  if workflow_enabled && [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    warn "TELEGRAM_CHAT_ID is not set — hosted workflow/Telegram notification will be skipped."
    WORKFLOW_ENABLED=0
  fi
  [[ -n "$SUMMARY_CODE" ]] || { err "SUMMARY_CODE failed to load"; exit 1; }
  log "service=${SERVICE_NAME} image=${SERVICE_IMAGE}:${SERVICE_PORT} route=${ROUTE_PREFIX} workflow=${WORKFLOW_ENABLED} recreate=${RECREATE}"
}

stage_login() {
  step "1/5 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

find_service_id() {
  api GET /api/registry/services \
    | jq -r --arg n "$SERVICE_NAME" 'if type=="array" then ([.[] | select(.name==$n)] | .[0].id // empty) else empty end'
}

stage_ensure_service() {
  step "2/5 ensure hosted service '${SERVICE_NAME}'"
  SERVICE_ID="$(find_service_id)"

  if [[ -n "$SERVICE_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting service ${SERVICE_ID}"
    api DELETE "/api/registry/services/${SERVICE_ID}" >/dev/null || true
    SERVICE_ID=""
  fi

  local body resp
  body="$(service_body)"
  echo "$body" | jq empty >/dev/null

  if [[ -n "$SERVICE_ID" ]]; then
    resp="$(api PATCH "/api/registry/services/${SERVICE_ID}" "$(service_update_body)")"
    [[ "$(echo "$resp" | jq -r '.id // empty')" == "$SERVICE_ID" ]] || {
      err "Service update failed: ${resp}"; exit 1; }
    log "updated existing service ${SERVICE_ID}"
  else
    resp="$(api POST /api/registry/services "$body")"
    SERVICE_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$SERVICE_ID" ]] || { err "Service creation failed: ${resp}"; exit 1; }
    log "created service ${SERVICE_ID}"
  fi
}

stage_ensure_route() {
  step "3/5 ensure route '${ROUTE_PREFIX}'"
  local routes desired_methods matching_id stale_ids
  routes="$(api GET "/api/registry/services/${SERVICE_ID}/routes")"
  echo "$routes" | jq -e 'type == "array"' >/dev/null || { err "Route list failed: ${routes}"; exit 1; }
  desired_methods="$(methods_json | jq -c 'sort')"

  matching_id="$(echo "$routes" | jq -r \
    --arg p "$ROUTE_PREFIX" \
    --argjson public "$(parse_bool "$ROUTE_PUBLIC")" \
    --argjson strip "$(parse_bool "$ROUTE_STRIP_PREFIX")" \
    --argjson methods "$desired_methods" \
    '[.[] | select(.pathPrefix==$p and .isPublic==$public and .stripPrefix==$strip and ((.methods | sort) == $methods))] | .[0].id // empty')"

  stale_ids="$(echo "$routes" | jq -r --arg p "$ROUTE_PREFIX" --arg keep "$matching_id" '.[] | select(.pathPrefix==$p and .id!=$keep) | .id')"
  for stale in $stale_ids; do
    log "removing stale route ${stale}"
    api DELETE "/api/registry/services/${SERVICE_ID}/routes/${stale}" >/dev/null || true
  done

  if [[ -n "$matching_id" ]]; then
    ROUTE_ID="$matching_id"
    log "reusing route ${ROUTE_ID}"
    return 0
  fi

  local body resp
  body="$(route_body)"
  resp="$(api POST "/api/registry/services/${SERVICE_ID}/routes" "$body")"
  ROUTE_ID="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$ROUTE_ID" ]] || { err "Route creation failed: ${resp}"; exit 1; }
  log "created route ${ROUTE_ID}"
}

build_workflow_body() {
  jq -n \
    --arg name "$WORKFLOW_NAME" \
    --arg app "$APPLICATION" \
    --arg serviceId "$SERVICE_ID" \
    --arg serviceSlug "$SERVICE_NAME" \
    --arg tgAccount "$TG_ACCOUNT_ID" \
    --arg httpAccount "$HTTP_ACCOUNT_ID" \
    --arg pin "$HOSTED_WORKFLOW_PIN" \
    --arg chatId "$TELEGRAM_CHAT_ID" \
    --arg summaryCode "$SUMMARY_CODE" \
    '{
      name: $name,
      application: $app,
      actions: [
        {
          name: "invokeHosted",
          activity: "serviceCall",
          args: {
            serviceId: $serviceId,
            serviceSlug: $serviceSlug,
            method: "POST",
            path: "/anything",
            data: {
              source: "hosted-services-api",
              marker: "HOSTED SERVICE SAMPLE",
              workflowName: $name,
              serviceName: $serviceSlug,
              inbound: "{{request.text}}"
            }
          }
        },
        {
          name: "summarize",
          activity: "jsFunction",
          args: { code: $summaryCode }
        },
        {
          name: "notify",
          activity: "channelSend",
          args: {
            accountId: $tgAccount,
            channel: "telegram",
            provider: "telegram",
            to: $chatId,
            type: "text",
            text: "{{results.summarize.text}}"
          }
        }
      ],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: (
          { channels: ["http"], providers: ["http"] }
          + (if $pin == "1" then { accountIds: [$httpAccount] } else {} end)
        )
      }
    }'
}

stage_ensure_workflow() {
  if ! workflow_enabled; then
    step "4/5 skip workflow (HOSTED_WORKFLOW_ENABLED=0)"
    return 0
  fi

  step "4/5 ensure workflow '${WORKFLOW_NAME}'"

  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    TG_ACCOUNT_ID="$(api GET "/api/channels/accounts?channel=telegram" \
      | jq -r 'if type=="array" then ([.[] | select(.isActive)] | .[0].id // empty) else empty end')"
  fi
  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    err "no active Telegram channel account found."
    err "Provision one first: (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)"
    err "or pin one with TG_ACCOUNT_ID=<id>."
    exit 1
  fi
  log "telegram account=${TG_ACCOUNT_ID}"

  ensure_http_account

  local all_wf_ids keep_wf_id
  all_wf_ids="$(api GET /api/workflows \
    | jq -r --arg n "$WORKFLOW_NAME" \
        'if type=="array" then [.[] | select(.name==$n)] | reverse | .[].id else empty end')"

  keep_wf_id="$(printf '%s\n' "$all_wf_ids" | head -1)"
  for stale_id in $(printf '%s\n' "$all_wf_ids" | tail -n +2); do
    log "removing duplicate workflow ${stale_id}"
    api DELETE "/api/workflows/${stale_id}" >/dev/null 2>&1 || true
  done

  local body resp
  body="$(build_workflow_body)"
  echo "$body" | jq empty 2>/dev/null || { err "assembled workflow body is invalid JSON"; exit 1; }

  if [[ -n "$keep_wf_id" && "$RECREATE" != "1" ]]; then
    WORKFLOW_ID="$keep_wf_id"
    resp="$(api PATCH "/api/workflows/${WORKFLOW_ID}" "$body")"
    [[ "$(echo "$resp" | jq -r '.id // empty')" == "$WORKFLOW_ID" ]] || {
      err "Workflow update failed: ${resp}"; exit 1; }
    log "updated existing workflow ${WORKFLOW_ID}"
    return 0
  fi

  if [[ -n "$keep_wf_id" ]]; then
    log "RECREATE=1 — deleting workflow ${keep_wf_id}"
    api DELETE "/api/workflows/${keep_wf_id}" >/dev/null 2>&1 || true
  fi

  resp="$(api POST /api/workflows "$body")"
  WORKFLOW_ID="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$WORKFLOW_ID" ]] || { err "Workflow creation failed: ${resp}"; exit 1; }
  log "created workflow id=${WORKFLOW_ID}"
}

stage_summary() {
  step "5/5 summary"
  local invoke_url="${YOIZEN_BASE_URL}${ROUTE_PREFIX}"
  log "service id : ${SERVICE_ID}"
  log "route id   : ${ROUTE_ID}"
  log "invoke URL : ${invoke_url}"
  if [[ -n "$WORKFLOW_ID" ]]; then
    local ingest_url="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"
    log "workflow id: ${WORKFLOW_ID}"
    log "http input : ${ingest_url}"
    log "telegram  : chat ${TELEGRAM_CHAT_ID} (message prefix: HOSTED SERVICE SAMPLE)"
  fi
  warn "Gateway dynamic route cache refreshes every ~15s; wait briefly before first invoke."
  echo
  log "Try it:"
  log "  curl -s '${invoke_url}/health' -H 'Host: ${YOIZEN_HOST_HEADER}' -H 'x-yoizen-tenant: ${YOIZEN_TENANT}' | jq ."
  log "  curl -s '${invoke_url}/anything?source=sample' -H 'Host: ${YOIZEN_HOST_HEADER}' -H 'x-yoizen-tenant: ${YOIZEN_TENANT}' | jq ."
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "  curl -s -X POST '${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}' \\"
    log "    -H 'content-type: application/json' -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
    log "    -d '{\"text\":\"hello hosted service\"}' | jq ."
  fi
}

main() {
  stage_preflight
  stage_login
  stage_ensure_service
  stage_ensure_route
  stage_ensure_workflow
  stage_summary
}

main "$@"
