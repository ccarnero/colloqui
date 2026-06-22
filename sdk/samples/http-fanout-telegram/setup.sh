#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: http-fanout-telegram  (parallel connector fan-out -> join -> Telegram)
# =============================================================================
#
# A message arriving on the HTTP channel triggers a workflow that:
#   1. fans out THREE connector calls IN PARALLEL (branch / Promise.all):
#        - jsonplaceholder  GET /posts/1
#        - pokeapi          GET /api/v2/pokemon/ditto
#        - catfacts         GET /fact
#   2. JOINS the three responses into one (jsFunction reading ctx.results.*)
#   3. POSTs the joined payload to the httpbin connector (endpointCall POST /post)
#   4. SENDS a summary to your phone over Telegram (channelSend -> chat_id)
#
#   HTTP msg ─► trigger(message_received, channels:["http"])
#                 │
#                 ├─ branch (parallel) ─► getPost | getPokemon | getCatFact
#                 │                         (endpointCall, one per connector)
#                 ▼
#               join (jsFunction: combine results.* into summary + combinedJson)
#                 ▼
#               postToHttpbin (endpointCall POST httpbin /post, body = joined)
#                 ▼
#               notify (channelSend telegram -> your chat_id)
#
# Idempotent (safe to re-run): reuses the workflow by name; RECREATE=1 rebuilds.
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - Executor      : services/workflow-service/src/temporal/workflows.ts
#                     (branch -> Promise.all parallel; jsFunction gets full ctx;
#                      {{...}} templating String()-coerces each leaf)
#   - Action schema : services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts
#                     (endpointCall needs method+url; channelSend needs
#                      accountId/channel/provider/to/type; branch keys = action arrays)
#   - endpointCall  : packages/shared/src/workflow.interfaces.ts (EndpointCallArgs;
#                     adapterId + url-as-path joins the connector baseUrl)
#   - channelSend   : services/workflow-service/src/temporal/activities/channel-send.activity.ts
#                     (to -> Telegram chat_id via TelegramProvider)
# -----------------------------------------------------------------------------
# PREREQS (provision these first — this script only wires the workflow):
#   * Connectors jsonplaceholder / pokeapi / catfacts / httpbin
#       -> sdk/samples/http-connectors/setup.sh
#   * A Telegram channel account with a REAL bot token
#       -> sdk/samples/telegram-transform-reply/setup.sh
#   * An active HTTP channel account for the tenant (so inbound can ingest)
#       -> create via the admin console, or the http-bridge sample
#   * YOUR numeric Telegram chat_id, and you must have /start-ed the bot
#       (a bot cannot cold-message a phone number — Telegram addresses by chat_id)
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

WORKFLOW_NAME="${FANOUT_WORKFLOW_NAME:-http-fanout-telegram}"
APPLICATION="${FANOUT_APPLICATION:-samples}"

# Connector names to resolve to adapterIds (must already exist; context=external).
JP_NAME="${FANOUT_JSONPLACEHOLDER:-jsonplaceholder}"
POKE_NAME="${FANOUT_POKEAPI:-pokeapi}"
CAT_NAME="${FANOUT_CATFACTS:-catfacts}"
HTTPBIN_NAME="${FANOUT_HTTPBIN:-httpbin}"

# Telegram recipient. REQUIRED. Your numeric chat_id (DM the bot, then read it
# from getUpdates, or use @userinfobot). TG_ACCOUNT_ID can pin a specific
# Telegram channel account; otherwise the first active one is used.
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"

# Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
# path segment of the per-instance ingress URL
# (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
# pinned to this account's id (accountIds) so ONLY messages to this instance
# fire it — no cross-firing with other http workflows.
HTTP_EXTERNAL_ID="${FANOUT_HTTP_EXTERNAL_ID:-http-fanout-telegram}"
HTTP_ACCOUNT_NAME="${FANOUT_HTTP_ACCOUNT_NAME:-HTTP Fanout Telegram}"

# Pin the trigger to the dedicated http instance via accountIds (Opción B).
# ON by default: the pin matches only messages resolved to this specific http
# account, preventing cross-firing with other http workflows. Set FANOUT_PIN=0
# to disable and let ANY http message trigger the workflow.
FANOUT_PIN="${FANOUT_PIN:-1}"

RECREATE="${RECREATE:-0}"

# ----- Pretty logging (verbose; nothing fails silently) ----------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
JP_ID=""; POKE_ID=""; CAT_ID=""; HTTPBIN_ID=""
HTTP_ACCOUNT_ID=""; HTTP_APP_SECRET=""
WORKFLOW_ID=""

# The join step. English code/comments; user-facing summary text in Spanish.
# Reads each parallel call's body from ctx.results.<name>.data and returns:
#   - summary:      a human string for the Telegram message
#   - combinedJson: a JSON string for the httpbin POST body
# (values flow on via {{results.join.*}}, which is String()-coerced downstream,
#  so we hand off strings, not nested objects).
read -r -d '' JOIN_CODE <<'JS' || true
(ctx) => {
  var post = (ctx.results.getPost && ctx.results.getPost.data) || {};
  var poke = (ctx.results.getPokemon && ctx.results.getPokemon.data) || {};
  var cat  = (ctx.results.getCatFact && ctx.results.getCatFact.data) || {};
  var inbound = (ctx.request && ctx.request.text) || "";
  var combined = {
    inbound: inbound,
    post: { id: post.id, title: post.title },
    pokemon: { name: poke.name, baseExperience: poke.base_experience },
    catFact: cat.fact
  };
  var summary =
    "Mensaje recibido: " + inbound + "\n" +
    "Post: " + (post.title || "-") + "\n" +
    "Pokemon: " + (poke.name || "-") + "\n" +
    "Dato gatuno: " + (cat.fact || "-");
  return { summary: summary, combinedJson: JSON.stringify(combined) };
}
JS

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

# resolve_adapter_id <name> — echo the external connector's id, or "".
resolve_adapter_id() {
  api GET "/api/connectors?context=external" \
    | jq -r --arg n "$1" \
        'if type=="array" then (.[] | select(.name==$n) | .id) else empty end' \
    | head -1
}

# ensure_http_account — resolve (or create) the sample's dedicated HTTP channel
# instance, identified by externalId. Captures HTTP_ACCOUNT_ID + HTTP_APP_SECRET
# (the gateway returns appSecret in the list, plaintext). Deduplicates on every run.
ensure_http_account() {
  local accounts all_ids keep_id
  accounts="$(api GET "/api/channels/accounts?channel=http")"

  # Collect ALL exact-externalId-matching active account ids, newest first.
  all_ids="$(echo "$accounts" | jq -r --arg e "$HTTP_EXTERNAL_ID" \
    '[.[] | select(.externalId==$e) | select(.isActive)] | reverse | .[].id')"

  # Always dedup: keep newest, delete the rest on every run.
  keep_id="$(echo "$all_ids" | head -1)"
  for stale_id in $(echo "$all_ids" | tail -n +2); do
    log "removing duplicate HTTP instance ${stale_id}"
    api DELETE "/api/channels/accounts/${stale_id}" >/dev/null 2>&1 || true
  done

  # Reuse the survivor unless RECREATE=1.
  if [[ -n "$keep_id" && "${RECREATE}" != "1" ]]; then
    HTTP_ACCOUNT_ID="$keep_id"
    HTTP_APP_SECRET="$(echo "$accounts" | jq -r --arg id "$keep_id" \
      '.[] | select(.id == $id) | .appSecret // empty')"
    log "reusing HTTP instance ${HTTP_ACCOUNT_ID} (externalId=${HTTP_EXTERNAL_ID})"
    return 0
  fi

  # RECREATE=1 or no existing account: delete survivor if any, then create fresh.
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

# ----- Stage 0: preflight ----------------------------------------------------
stage_preflight() {
  step "0/3 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    err "TELEGRAM_CHAT_ID is required — your numeric Telegram chat id."
    err "DM your bot first, then: curl -s \"https://api.telegram.org/bot<token>/getUpdates\" | jq '.result[].message.chat.id'"
    exit 1
  fi
  [[ -n "$JOIN_CODE" ]] || { err "JOIN_CODE failed to load"; exit 1; }
  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}"
  log "telegram chat_id=${TELEGRAM_CHAT_ID}"
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

# ----- Stage 2: resolve dependency ids (connectors + telegram + http instance) -
stage_resolve() {
  step "2/3 resolve connectors + telegram account + http instance"

  JP_ID="$(resolve_adapter_id "$JP_NAME")"
  POKE_ID="$(resolve_adapter_id "$POKE_NAME")"
  CAT_ID="$(resolve_adapter_id "$CAT_NAME")"
  HTTPBIN_ID="$(resolve_adapter_id "$HTTPBIN_NAME")"

  local missing=""
  [[ -z "$JP_ID" ]]      && missing="$missing ${JP_NAME}"
  [[ -z "$POKE_ID" ]]    && missing="$missing ${POKE_NAME}"
  [[ -z "$CAT_ID" ]]     && missing="$missing ${CAT_NAME}"
  [[ -z "$HTTPBIN_ID" ]] && missing="$missing ${HTTPBIN_NAME}"
  if [[ -n "$missing" ]]; then
    err "connector(s) not found:${missing}"
    err "Provision them first:  (cd ../http-connectors && ./setup.sh)"
    exit 1
  fi
  log "connectors  jsonplaceholder=${JP_ID}  pokeapi=${POKE_ID}  catfacts=${CAT_ID}  httpbin=${HTTPBIN_ID}"

  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    TG_ACCOUNT_ID="$(api GET "/api/channels/accounts?channel=telegram" \
      | jq -r 'if type=="array" then ([.[] | select(.isActive)] | .[0].id // empty) else empty end')"
  fi
  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    err "no active Telegram channel account found."
    err "Provision one first:  (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)"
    err "or pin one with TG_ACCOUNT_ID=<id>."
    exit 1
  fi
  log "telegram account=${TG_ACCOUNT_ID}"

  ensure_http_account
}

# build_workflow_body — assemble the workflow definition with resolved ids.
build_workflow_body() {
  jq -n \
    --arg name "$WORKFLOW_NAME" \
    --arg app "$APPLICATION" \
    --arg jp "$JP_ID" \
    --arg poke "$POKE_ID" \
    --arg cat "$CAT_ID" \
    --arg httpbin "$HTTPBIN_ID" \
    --arg tgAccount "$TG_ACCOUNT_ID" \
    --arg httpAccount "$HTTP_ACCOUNT_ID" \
    --arg pin "$FANOUT_PIN" \
    --arg chatId "$TELEGRAM_CHAT_ID" \
    --arg joinCode "$JOIN_CODE" \
    '{
      name: $name,
      application: $app,
      actions: [
        {
          name: "fanout",
          activity: "branch",
          jsonplaceholder: [
            { name: "getPost", activity: "endpointCall",
              args: { adapterId: $jp, method: "GET", url: "/posts/1" } }
          ],
          pokeapi: [
            { name: "getPokemon", activity: "endpointCall",
              args: { adapterId: $poke, method: "GET", url: "/api/v2/pokemon/ditto" } }
          ],
          catfacts: [
            { name: "getCatFact", activity: "endpointCall",
              args: { adapterId: $cat, method: "GET", url: "/fact" } }
          ]
        },
        {
          name: "join",
          activity: "jsFunction",
          args: { code: $joinCode }
        },
        {
          name: "postToHttpbin",
          activity: "endpointCall",
          args: {
            adapterId: $httpbin,
            method: "POST",
            url: "/post",
            data: {
              source: "http-fanout-telegram",
              summary: "{{results.join.summary}}",
              payload: "{{results.join.combinedJson}}"
            }
          }
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
            text: "{{results.join.summary}}\n(httpbin status: {{results.postToHttpbin.status}})"
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

# ----- Stage 3: ensure the workflow ------------------------------------------
stage_ensure_workflow() {
  step "3/3 ensure workflow '${WORKFLOW_NAME}'"

  local all_wf_ids keep_wf_id
  all_wf_ids="$(api GET /api/workflows \
    | jq -r --arg n "$WORKFLOW_NAME" \
        'if type=="array" then [.[] | select(.name==$n)] | reverse | .[].id else empty end')"

  keep_wf_id="$(printf '%s\n' "$all_wf_ids" | head -1)"

  # Always dedup: delete extras on every run, not just on recreate.
  for stale_id in $(printf '%s\n' "$all_wf_ids" | tail -n +2); do
    log "removing duplicate workflow ${stale_id}"
    api DELETE "/api/workflows/${stale_id}" >/dev/null 2>&1 || true
  done

  if [[ -n "$keep_wf_id" && "${RECREATE}" != "1" ]]; then
    WORKFLOW_ID="$keep_wf_id"
    log "reusing existing workflow ${WORKFLOW_ID} (set RECREATE=1 to rebuild)"
    return 0
  fi
  if [[ -n "$keep_wf_id" ]]; then
    log "RECREATE=1 — deleting workflow ${keep_wf_id}"
    api DELETE "/api/workflows/${keep_wf_id}" >/dev/null 2>&1 || true
  fi

  local body resp
  body="$(build_workflow_body)"
  echo "$body" | jq empty 2>/dev/null || { err "assembled workflow body is invalid JSON"; exit 1; }

  resp="$(api POST /api/workflows "$body")"
  WORKFLOW_ID="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$WORKFLOW_ID" ]] || { err "Workflow creation failed: ${resp}"; exit 1; }
  log "created workflow id=${WORKFLOW_ID}"
}

main() {
  stage_preflight
  stage_login
  stage_resolve
  stage_ensure_workflow

  local ingest_url="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"

  echo
  log "Done. Workflow '${WORKFLOW_NAME}' (${WORKFLOW_ID}):"
  log "  trigger : message_received on channels=[http], pinned to accountIds=[${HTTP_ACCOUNT_ID}]"
  log "  fanout  : parallel endpointCall -> jsonplaceholder + pokeapi + catfacts"
  log "  join    : jsFunction merges the three responses"
  log "  post    : endpointCall POST -> httpbin /post"
  log "  notify  : channelSend telegram -> chat ${TELEGRAM_CHAT_ID}"
  log "  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)"
  echo
  log "Drive it — POST to THIS instance's own URL (no other http workflow fires):"
  log "    curl -X POST '${ingest_url}' \\"
  log "      -H 'content-type: application/json' \\"
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "      -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
  else
    log "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
  fi
  log "      -d '{\"text\":\"hola\"}'"
  log "Or via the http-bridge SDK, targeting this instance:"
  log "    (cd ../http-bridge && YOIZEN_HTTP_CHANNEL_INSTANCE=${HTTP_EXTERNAL_ID} … pnpm start)"
  log "Then check Telegram — the bot DMs you the joined summary."
}

main "$@"
