#!/usr/bin/env bash
# Idempotent provisioning for the stress test fixtures.
#
# Creates (or reuses, if already present) the following on the local minikube
# cluster, via the API gateway:
#   1. Tenant       : acme
#   2. Service      : echo-service        (registry-service)
#   3. Channel acct : tgbot (telegram)    (channel-service)
#   4. Workflow     : Stress Workflow     (workflow-service)
#
# Usage:
#   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... ./scripts/provision.sh
#
# Env overrides:
#   API_GATEWAY_URL     Skip auto-discovery and use this URL directly.
#   MINIKUBE_PROFILE    minikube profile name (default: yoizen-arch).
#   INGRESS_NS          Kourier namespace (default: kourier-system).
#   INGRESS_SVC         Kourier service name (default: kourier).
#   TENANT_NAME         Tenant slug (default: acme).
#
# Outputs (stdout, last 4 lines):
#   TENANT_ID=...
#   SERVICE_ID=...
#   CHANNEL_ID=...
#   WORKFLOW_ID=...

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants & logging
# ---------------------------------------------------------------------------

readonly TENANT_NAME="${TENANT_NAME:-acme}"
readonly SERVICE_NAME="echo-service"
readonly SERVICE_IMAGE="ealen/echo-server:latest"
readonly SERVICE_PORT=3000
readonly SERVICE_MIN_SCALE=1
readonly SERVICE_MAX_SCALE=5
readonly SERVICE_CONCURRENCY_TARGET=100

readonly CHANNEL_NAME="tgbot"
readonly CHANNEL_KIND="telegram"
readonly CHANNEL_PROVIDER="telegram"
readonly CHANNEL_EXTERNAL_ID="Luishi_bot"
# NOTE: these are test/fixture credentials hardcoded by explicit user request
# for the stress provisioning script. Do NOT copy this pattern to production
# code; production secrets must come from env vars / secret stores.
readonly CHANNEL_BOT_TOKEN="8734405824:AAHDEmimU1A7Ze2wlPLIG38CcBR0P8NCPN4"
readonly CHANNEL_ACCESS_TOKEN="8734405824:AAHDEmimU1A7Ze2wlPLIG38CcBR0P8NCPN4"
readonly CHANNEL_APP_SECRET="anothersecret"

readonly WORKFLOW_NAME="Stress Workflow"
readonly WORKFLOW_APPLICATION="default"

# stress-sink endpoint baked into the workflow's `endpointCall` step.
# Default = in-cluster Knative DNS. Override via env when the sink is
# exposed differently (e.g. through Kourier in CI).
readonly STRESS_SINK_URL_DEFAULT="http://stress-sink.platform-services-dev.svc.cluster.local/sink"
readonly STRESS_SINK_URL="${STRESS_SINK_URL:-$STRESS_SINK_URL_DEFAULT}"

readonly RED=$'\033[0;31m'
readonly GREEN=$'\033[0;32m'
readonly YELLOW=$'\033[1;33m'
readonly CYAN=$'\033[0;36m'
readonly NC=$'\033[0m'

log()  { printf "%s[INFO]%s  %s\n" "$GREEN"  "$NC" "$*"; }
warn() { printf "%s[WARN]%s  %s\n" "$YELLOW" "$NC" "$*"; }
err()  { printf "%s[ERR]%s   %s\n" "$RED"    "$NC" "$*" >&2; }
note() { printf "%s[..]%s    %s\n" "$CYAN"   "$NC" "$*"; }

# ---------------------------------------------------------------------------
# Temp file management
# ---------------------------------------------------------------------------

TMP_DIR="$(mktemp -d -t provision.XXXXXX)"
readonly TMP_DIR
trap 'rm -rf "$TMP_DIR"' EXIT

# Shared scratch files reused across requests (no per-call allocation).
readonly RESP_BODY="$TMP_DIR/body"
readonly RESP_HEADERS="$TMP_DIR/headers"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command '$cmd' is not installed or not in PATH."
    exit 1
  fi
}

preflight() {
  require_cmd curl
  require_cmd jq
  require_cmd kubectl

  if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
    err "ADMIN_EMAIL and ADMIN_PASSWORD must be set."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Gateway URL discovery
# ---------------------------------------------------------------------------

resolve_gateway_url() {
  if [[ -n "${API_GATEWAY_URL:-}" ]]; then
    log "Using API_GATEWAY_URL override: ${API_GATEWAY_URL}"
    return
  fi

  local profile="${MINIKUBE_PROFILE:-yoizen-arch}"
  local ns="${INGRESS_NS:-kourier-system}"
  local svc="${INGRESS_SVC:-kourier}"
  local ingress_ip=""

  ingress_ip="$(kubectl -n "$ns" get svc "$svc" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"

  if [[ -z "$ingress_ip" ]]; then
    warn "Kourier LB IP unavailable; falling back to 'minikube ip -p ${profile}'."
    require_cmd minikube
    ingress_ip="$(minikube ip -p "$profile" 2>/dev/null || true)"
  fi

  if [[ -z "$ingress_ip" ]]; then
    err "Could not discover an ingress IP. Set API_GATEWAY_URL or start minikube."
    exit 1
  fi

  API_GATEWAY_URL="http://api-gateway.platform-services-dev.${ingress_ip}.sslip.io"
  log "Discovered API gateway: ${API_GATEWAY_URL}"
}

# ---------------------------------------------------------------------------
# HTTP helpers
#
# request_json METHOD PATH [BODY]
#   - METHOD : HTTP verb
#   - PATH   : path relative to API_GATEWAY_URL (must start with /)
#   - BODY   : optional JSON body (string)
#
# Writes response body to $RESP_BODY and the HTTP status code to stdout.
# Authorization header is taken from $ACCESS_TOKEN (when non-empty).
# Tenant header is taken from $TENANT_HEADER_VALUE (when non-empty).
# ---------------------------------------------------------------------------

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${API_GATEWAY_URL}${path}"

  local -a curl_args=(
    --silent
    --show-error
    --max-time 30
    --request "$method"
    --output "$RESP_BODY"
    --write-out '%{http_code}'
    --header 'Accept: application/json'
  )

  if [[ -n "${ACCESS_TOKEN:-}" ]]; then
    curl_args+=(--header "Authorization: Bearer ${ACCESS_TOKEN}")
  fi
  if [[ -n "${TENANT_HEADER_VALUE:-}" ]]; then
    curl_args+=(--header "x-yoizen-tenant: ${TENANT_HEADER_VALUE}")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(--header 'Content-Type: application/json' --data "$body")
  fi

  : >"$RESP_BODY"
  curl "${curl_args[@]}" "$url"
}

resp_body() { cat "$RESP_BODY"; }

# Dumps the last response body to stderr for debugging.
dump_resp() {
  local code="$1"
  err "HTTP ${code} from last request. Body:"
  if [[ -s "$RESP_BODY" ]]; then
    cat "$RESP_BODY" >&2
    printf '\n' >&2
  else
    err "(empty response body)"
  fi
}

# Extracts .id from $RESP_BODY; fails loudly if absent or empty.
extract_id() {
  local id
  id="$(jq -er '.id // empty' <"$RESP_BODY" 2>/dev/null || true)"
  if [[ -z "$id" ]]; then
    err "Response did not contain a non-empty '.id' field:"
    cat "$RESP_BODY" >&2
    printf '\n' >&2
    exit 1
  fi
  printf '%s' "$id"
}

# ---------------------------------------------------------------------------
# Step 0 — admin login
# ---------------------------------------------------------------------------

login_admin() {
  note "Logging in as admin..."
  local body
  body="$(jq -nc \
    --arg email "$ADMIN_EMAIL" \
    --arg password "$ADMIN_PASSWORD" \
    '{email: $email, password: $password}')"

  local code
  code="$(request_json POST "/api/auth/login" "$body")"

  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    dump_resp "$code"
    err "Admin login failed."
    exit 1
  fi

  ACCESS_TOKEN="$(jq -er '.access_token // empty' <"$RESP_BODY" 2>/dev/null || true)"
  if [[ -z "$ACCESS_TOKEN" ]]; then
    err "Login response missing 'access_token'."
    cat "$RESP_BODY" >&2
    exit 1
  fi
  log "Admin token acquired."
}

# ---------------------------------------------------------------------------
# Step 1 — tenant
# ---------------------------------------------------------------------------

ensure_tenant() {
  note "Ensuring tenant '${TENANT_NAME}' exists..."
  # Tenant routes use @SkipTenant(); do not attach tenant header here.
  local prev_tenant="${TENANT_HEADER_VALUE:-}"
  TENANT_HEADER_VALUE=""

  local code
  code="$(request_json GET "/api/tenants/${TENANT_NAME}")"

  if [[ "$code" == "200" ]]; then
    TENANT_ID="$(extract_id)"
    log "Tenant '${TENANT_NAME}' already exists (id=${TENANT_ID})."
  elif [[ "$code" == "404" ]]; then
    note "Tenant '${TENANT_NAME}' not found; creating..."
    local body
    body="$(jq -nc --arg name "$TENANT_NAME" '{name: $name}')"
    code="$(request_json POST "/api/tenants" "$body")"
    if [[ "$code" != "201" && "$code" != "202" && "$code" != "200" ]]; then
      dump_resp "$code"
      err "Failed to create tenant '${TENANT_NAME}'."
      exit 1
    fi
    TENANT_ID="$(extract_id)"
    log "Tenant '${TENANT_NAME}' created (id=${TENANT_ID})."
  else
    dump_resp "$code"
    err "Unexpected status ${code} when looking up tenant '${TENANT_NAME}'."
    exit 1
  fi

  wait_tenant_ready "$TENANT_NAME"

  TENANT_HEADER_VALUE="$prev_tenant"
}

# POST /api/tenants is 202 Accepted — provisioning is async (k8s namespace,
# per-tenant Mongo DB + user, ExternalName service, runtime overlay). All
# subsequent tenant-scoped calls (registry, channels, workflow) depend on
# that namespace existing, so we poll the status URL until the tenant flips
# to `ready`. Bail on `failed` and dump the provisioning_error so the user
# sees why instead of cascading into misleading 500s downstream.
wait_tenant_ready() {
  local tenant="$1"
  local max_attempts="${TENANT_READY_MAX_ATTEMPTS:-60}"   # ~120 s @ 2 s
  local sleep_secs="${TENANT_READY_SLEEP_SECS:-2}"

  note "Waiting for tenant '${tenant}' provisioning to complete..."
  local attempt=0
  while (( attempt < max_attempts )); do
    local code
    code="$(request_json GET "/api/tenants/${tenant}")"
    if [[ "$code" == "200" ]]; then
      local status
      status="$(jq -r '.provisioningStatus // .provisioning_status // empty' <"$RESP_BODY" 2>/dev/null || true)"
      case "$status" in
        ready)
          log "Tenant '${tenant}' is ready."
          return 0
          ;;
        failed)
          local error_msg
          error_msg="$(jq -r '.provisioningError // .provisioning_error // "unknown"' <"$RESP_BODY")"
          err "Tenant '${tenant}' provisioning failed: ${error_msg}"
          exit 1
          ;;
        pending|provisioning|"")
          ;;
        *)
          warn "Tenant '${tenant}' provisioning status='${status}' (unexpected, continuing to poll)"
          ;;
      esac
    fi
    sleep "$sleep_secs"
    attempt=$((attempt + 1))
  done

  err "Timed out waiting for tenant '${tenant}' to become ready after $((max_attempts * sleep_secs))s."
  exit 1
}

# ---------------------------------------------------------------------------
# Step 2 — registry service
# ---------------------------------------------------------------------------

ensure_service() {
  note "Ensuring registry service '${SERVICE_NAME}' exists..."

  local code
  code="$(request_json GET "/api/registry/services")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    dump_resp "$code"
    err "Failed to list registry services."
    exit 1
  fi

  local existing_id
  existing_id="$(jq -er --arg name "$SERVICE_NAME" \
    'if type == "array" then . else (.items // .data // []) end
     | map(select(.name == $name)) | .[0].id // empty' \
    <"$RESP_BODY" 2>/dev/null || true)"

  if [[ -n "$existing_id" ]]; then
    SERVICE_ID="$existing_id"
    log "Service '${SERVICE_NAME}' already exists (id=${SERVICE_ID})."
    return
  fi

  note "Service '${SERVICE_NAME}' not found; creating..."
  local body
  body="$(jq -nc \
    --arg name "$SERVICE_NAME" \
    --arg image "$SERVICE_IMAGE" \
    --argjson port "$SERVICE_PORT" \
    --argjson minScale "$SERVICE_MIN_SCALE" \
    --argjson maxScale "$SERVICE_MAX_SCALE" \
    --argjson concurrencyTarget "$SERVICE_CONCURRENCY_TARGET" \
    '{name: $name, image: $image, port: $port,
      minScale: $minScale, maxScale: $maxScale,
      concurrencyTarget: $concurrencyTarget}')"

  code="$(request_json POST "/api/registry/services" "$body")"
  if [[ "$code" != "201" && "$code" != "200" ]]; then
    dump_resp "$code"
    err "Failed to create service '${SERVICE_NAME}'."
    exit 1
  fi
  SERVICE_ID="$(extract_id)"
  log "Service '${SERVICE_NAME}' created (id=${SERVICE_ID})."
}

# ---------------------------------------------------------------------------
# Step 3 — channel account
# ---------------------------------------------------------------------------

ensure_channel() {
  note "Ensuring channel account '${CHANNEL_NAME}' (${CHANNEL_KIND}) exists..."

  local code
  code="$(request_json GET "/api/channels/accounts?channel=${CHANNEL_KIND}")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    dump_resp "$code"
    err "Failed to list channel accounts."
    exit 1
  fi

  local existing_id
  existing_id="$(jq -er \
    --arg name "$CHANNEL_NAME" \
    --arg externalId "$CHANNEL_EXTERNAL_ID" \
    'if type == "array" then . else (.items // .data // []) end
     | map(select(.name == $name or .externalId == $externalId))
     | .[0].id // empty' \
    <"$RESP_BODY" 2>/dev/null || true)"

  if [[ -n "$existing_id" ]]; then
    CHANNEL_ID="$existing_id"
    log "Channel account '${CHANNEL_NAME}' already exists (id=${CHANNEL_ID})."
    return
  fi

  note "Channel account '${CHANNEL_NAME}' not found; creating..."
  local body
  body="$(jq -nc \
    --arg channel "$CHANNEL_KIND" \
    --arg provider "$CHANNEL_PROVIDER" \
    --arg name "$CHANNEL_NAME" \
    --arg externalId "$CHANNEL_EXTERNAL_ID" \
    --arg telegramBotToken "$CHANNEL_BOT_TOKEN" \
    --arg accessToken "$CHANNEL_ACCESS_TOKEN" \
    --arg appSecret "$CHANNEL_APP_SECRET" \
    '{channel: $channel, provider: $provider, name: $name,
      externalId: $externalId, telegramBotToken: $telegramBotToken,
      accessToken: $accessToken, appSecret: $appSecret}')"

  code="$(request_json POST "/api/channels/accounts" "$body")"
  if [[ "$code" != "201" && "$code" != "200" ]]; then
    dump_resp "$code"
    err "Failed to create channel account '${CHANNEL_NAME}'."
    exit 1
  fi
  CHANNEL_ID="$(extract_id)"
  log "Channel account '${CHANNEL_NAME}' created (id=${CHANNEL_ID})."
}

# ---------------------------------------------------------------------------
# Step 4 — workflow
# ---------------------------------------------------------------------------

# Inline JS that parses the `STRESS|<cid>|<sentAt>|<stage>` prefix that
# the k6 webhook scenario embeds in `message.text`. Returns three
# fields the next `endpointCall` step references via templates. Falls
# back to safe defaults so non-stress traffic doesn't crash the
# workflow (it just produces a sink delivery with empty correlation,
# which the reconciler dedupes/ignores).
readonly STRESS_PARSE_JS='async (ctx) => { const t = (ctx && ctx.request && ctx.request.text) || ""; if (!t.startsWith("STRESS|")) return { correlation_id: "", sent_at: "0", stage: "" }; const p = t.split("|"); return { correlation_id: p[1] || "", sent_at: p[2] || "0", stage: p[3] || "" }; }'

build_workflow_payload() {
  jq -nc \
    --arg name "$WORKFLOW_NAME" \
    --arg application "$WORKFLOW_APPLICATION" \
    --arg tenantId "$TENANT_NAME" \
    --arg serviceId "$SERVICE_ID" \
    --arg channelId "$CHANNEL_ID" \
    --arg sinkUrl "$STRESS_SINK_URL" \
    --arg parseJs "$STRESS_PARSE_JS" \
    '{
      name: $name,
      application: $application,
      actions: [
        {
          name: "Parallel Branch",
          activity: "branch",
          pathA: [
            {
              name: "JS Function",
              activity: "jsFunction",
              args: { code: "(ctx)=>console.log(`Executed_${Date.now()}`);" }
            }
          ],
          pathB: [
            {
              name: "Service Call",
              activity: "serviceCall",
              args: { path: "/echo-1", method: "GET", serviceId: $serviceId }
            }
          ]
        },
        {
          name: "extractStressMeta",
          activity: "jsFunction",
          args: { code: $parseJs }
        },
        {
          name: "notifyStressSink",
          activity: "endpointCall",
          args: {
            method: "POST",
            url: $sinkUrl,
            data: {
              correlation_id: "{{results.extractStressMeta.correlation_id}}",
              sent_at: "{{results.extractStressMeta.sent_at}}",
              stage: "{{results.extractStressMeta.stage}}"
            }
          }
        }
      ],
      trigger: {
        mode: "shared",
        type: "message_received",
        config: {
          channels: [],
          patterns: [],
          providers: [],
          accountIds: [$channelId]
        }
      }
    }'
}

# True when the existing workflow JSON exposes the sink-notify step.
# Lets us auto-detect old-shape workflows and re-PUT them in place.
workflow_has_sink_notify() {
  local existing_json="$1"
  jq -e '
    .actions
    | map(select(.name == "notifyStressSink"))
    | length > 0
  ' >/dev/null 2>&1 <<<"$existing_json"
}

ensure_workflow() {
  note "Ensuring workflow '${WORKFLOW_NAME}' exists..."

  local code
  code="$(request_json GET "/api/workflows")"
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    dump_resp "$code"
    err "Failed to list workflows."
    exit 1
  fi

  local existing_json
  existing_json="$(jq -e --arg name "$WORKFLOW_NAME" \
    'if type == "array" then . else (.items // .data // []) end
     | map(select(.name == $name)) | .[0] // empty' \
    <"$RESP_BODY" 2>/dev/null || true)"

  local body
  body="$(build_workflow_payload)"

  if [[ -z "$existing_json" || "$existing_json" == "null" ]]; then
    note "Workflow '${WORKFLOW_NAME}' not found; creating..."
    code="$(request_json POST "/api/workflows" "$body")"
    if [[ "$code" != "201" && "$code" != "200" ]]; then
      dump_resp "$code"
      err "Failed to create workflow '${WORKFLOW_NAME}'."
      exit 1
    fi
    WORKFLOW_ID="$(extract_id)"
    log "Workflow '${WORKFLOW_NAME}' created (id=${WORKFLOW_ID})."
    return
  fi

  WORKFLOW_ID="$(printf '%s' "$existing_json" | jq -er '.id')"

  local force_reprovision="${WORKFLOW_FORCE_REPROVISION:-false}"
  if [[ "$force_reprovision" == "true" ]] \
     || ! workflow_has_sink_notify "$existing_json"; then
    if [[ "$force_reprovision" == "true" ]]; then
      note "WORKFLOW_FORCE_REPROVISION=true; updating workflow in place."
    else
      note "Existing workflow lacks 'notifyStressSink'; updating in place."
    fi
    code="$(request_json PUT "/api/workflows/${WORKFLOW_ID}" "$body")"
    if [[ "$code" != "200" && "$code" != "204" ]]; then
      dump_resp "$code"
      err "Failed to update workflow '${WORKFLOW_NAME}' (id=${WORKFLOW_ID})."
      exit 1
    fi
    log "Workflow '${WORKFLOW_NAME}' updated (id=${WORKFLOW_ID})."
    return
  fi

  log "Workflow '${WORKFLOW_NAME}' already up to date (id=${WORKFLOW_ID})."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  preflight
  resolve_gateway_url

  ACCESS_TOKEN=""
  TENANT_HEADER_VALUE=""

  login_admin

  ensure_tenant

  # All subsequent tenant-scoped calls carry x-yoizen-tenant: <TENANT_NAME>.
  TENANT_HEADER_VALUE="$TENANT_NAME"

  ensure_service
  ensure_channel
  ensure_workflow

  printf '\n'
  log "Provisioning complete."
  printf 'TENANT_ID=%s\n'   "$TENANT_ID"
  printf 'SERVICE_ID=%s\n'  "$SERVICE_ID"
  printf 'CHANNEL_ID=%s\n'  "$CHANNEL_ID"
  printf 'WORKFLOW_ID=%s\n' "$WORKFLOW_ID"
}

main "$@"
