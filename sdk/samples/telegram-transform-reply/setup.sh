#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: telegram-transform-reply  (Telegram analog of the http-bridge sample)
# =============================================================================
#
# A Telegram message in -> a workflow transforms it (echo + a millisecond
# timestamp) -> the bot replies over Telegram to the SAME chat.
#
# This script creates ALL the artifacts through the platform API (idempotent —
# safe to re-run):
#
#   1. A Telegram CHANNEL ACCOUNT — wires the platform's built-in Telegram
#      adapter (channel-service TelegramProvider) for RECEIVE + SEND.
#   2. A WORKFLOW (message_received trigger on channel "telegram") with two
#      actions: transform (jsFunction) + reply (channelSend).
#   3. (optional) Registers the Telegram webhook at the right URL when you pass
#      a public HTTPS base via TG_PUBLIC_URL (e.g. a cloudflared tunnel).
#
# -----------------------------------------------------------------------------
# HARD-WON GOTCHAS baked into this script (see README "Troubleshooting"):
#
#  * The gateway has a global prefix `api`, so the real webhook path is
#    /api/webhooks/telegram/<tenant>. The platform's own auto-registration omits
#    `/api`; this script's setWebhook (stage 4) uses the correct path and wins.
#  * RECEIVE uses the account's appSecret (webhook secret); SEND uses the bot
#    token. Inbound working does NOT prove the stored token is valid. A
#    placeholder/wrong token => Telegram `404 Not Found` on every send.
#  * The (channel, external_id) unique key is global and a delete may not free it
#    in dev, so every (re)create uses a UNIQUE externalId to avoid a 500
#    duplicate-key. Reuse matches by the externalId PREFIX (TG_EXTERNAL_ID).
#  * RECREATE=1 recreates BOTH the account and the workflow, so a stale or
#    account-pinned workflow definition can't silently swallow messages.
#  * Repeated send failures trip the egress circuit breaker (telegram:telegram);
#    clear it with: kubectl rollout restart deploy/channel-service-worker -n <ns>
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - Channel account: services/channel-service/src/modules/accounts/accounts.dto.ts + accounts.service.ts
#   - Telegram adapter: services/channel-service/src/providers/telegram/telegram.provider.ts
#   - Inbound webhook : services/api-gateway/src/modules/channels/webhooks.controller.ts (global prefix `api`)
#   - Workflow + tmpl : services/workflow-service/src/temporal/workflows.ts + trigger-consumer.service.ts
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

# Telegram bot token (from @BotFather). REQUIRED for real delivery — it is the
# credential the SEND path uses. With a placeholder, artifacts still provision
# but every send returns 404.
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"

# Public HTTPS base reachable by Telegram (e.g. your cloudflared tunnel:
# https://api.devmachina.net). When set + a real token, stage 4 registers the
# webhook for you at <TG_PUBLIC_URL>/api/webhooks/telegram/<tenant>.
TG_PUBLIC_URL="${TG_PUBLIC_URL:-}"

# Stable identity PREFIX. Reuse matches any active telegram account whose
# externalId starts with this; each create appends a unique suffix.
EXTERNAL_PREFIX="${TG_EXTERNAL_ID:-telegram-sample-bot}"
ACCOUNT_NAME="${TG_ACCOUNT_NAME:-Telegram Sample Bot}"
WORKFLOW_NAME="${TG_WORKFLOW_NAME:-telegram-transform-reply}"
APPLICATION="${TG_APPLICATION:-samples}"

TG_PIN="${TG_PIN:-1}"

RECREATE="${RECREATE:-0}"

# Optional end-to-end drive of the chain with a synthetic inbound update.
SIMULATE_INBOUND="${SIMULATE_INBOUND:-0}"
TELEGRAM_TEST_CHAT_ID="${TELEGRAM_TEST_CHAT_ID:-}"
POLL_TIMEOUT_S="${TG_POLL_TIMEOUT_S:-60}"

# ----- Pretty logging (verbose; nothing fails silently) ----------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
ACCOUNT_ID=""
EXTERNAL_ID=""
APP_SECRET=""
WORKFLOW_ID=""

# Local cache of the webhook secret (appSecret is only returned at creation),
# so re-runs can still register/simulate after REUSING an existing account.
SECRET_FILE="${TG_SECRET_FILE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.telegram-sample-secret}"
save_secret() { [[ -n "${1:-}" ]] || return 0; umask 077; printf '%s\n' "$1" >"$SECRET_FILE"; }
load_secret() { [[ -f "$SECRET_FILE" ]] && head -1 "$SECRET_FILE" || true; }

# api <method> <path> [json-body] — authenticated, tenant-scoped JSON call.
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

# ----- Stage 0: preflight ----------------------------------------------------
stage_preflight() {
  step "0/5 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    TELEGRAM_BOT_TOKEN="PLACEHOLDER:set-TELEGRAM_BOT_TOKEN-for-real-delivery"
    warn "TELEGRAM_BOT_TOKEN not set — using a placeholder."
    warn "Artifacts will provision, but the SEND path will 404 until you use a real token."
  fi
  if [[ "$SIMULATE_INBOUND" == "1" && -z "$TELEGRAM_TEST_CHAT_ID" ]]; then
    err "SIMULATE_INBOUND=1 requires TELEGRAM_TEST_CHAT_ID with your real numeric chat id."
    err "Using a fake chat id makes Telegram reject the reply with: Bad Request: chat not found."
    exit 1
  fi
  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE:-0}"
}

# ----- Stage 1: login --------------------------------------------------------
stage_login() {
  step "1/5 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

# ----- Stage 2: ensure the Telegram channel account (receive + send) ---------
stage_ensure_account() {
  step "2/5 ensure Telegram channel account (prefix=${EXTERNAL_PREFIX})"

  local accounts all_ids keep_id
  accounts="$(api GET "/api/channels/accounts?channel=telegram")"

  # Collect ALL prefix-matching active account ids, newest first (API returns
  # insertion order; last element is most recent).
  all_ids="$(echo "$accounts" | jq -r --arg p "$EXTERNAL_PREFIX" \
    '[.[] | select((.externalId // "") | startswith($p)) | select(.isActive)] | reverse | .[].id')"

  # Always keep at most one: the most recently created. Delete the rest whether
  # this is a normal run or a recreate — prevents stale account accumulation.
  keep_id="$(echo "$all_ids" | head -1)"
  for stale_id in $(echo "$all_ids" | tail -n +2); do
    log "removing stale prefix-matching account ${stale_id}"
    api DELETE "/api/channels/accounts/${stale_id}" >/dev/null 2>&1 || true
  done

  # Reuse the surviving account unless RECREATE=1.
  if [[ -n "$keep_id" && "${RECREATE:-0}" != "1" ]]; then
    ACCOUNT_ID="$keep_id"
    EXTERNAL_ID="$(echo "$accounts" | jq -r --arg id "$keep_id" \
      '.[] | select(.id == $id) | .externalId // empty')"
    APP_SECRET="$(load_secret)"
    log "reusing existing account ${ACCOUNT_ID} externalId=${EXTERNAL_ID} (set RECREATE=1 to rotate token/secret)"
    [[ -n "$APP_SECRET" ]] && log "loaded cached webhook secret" \
                           || warn "no cached webhook secret — run once with RECREATE=1 to mint+cache one"
    return 0
  fi

  # Recreate path: remove the surviving account too. A delete may not free the
  # global (channel, external_id) unique key in dev, so the create below uses a
  # UNIQUE externalId and never collides.
  if [[ -n "$keep_id" && "${RECREATE:-0}" == "1" ]]; then
    log "removing prefix-matching account ${keep_id}"
    api DELETE "/api/channels/accounts/${keep_id}" >/dev/null 2>&1 || true
  fi

  EXTERNAL_ID="${EXTERNAL_PREFIX}-$(date +%s)-${RANDOM}"
  local body resp
  body="$(jq -n \
    --arg name "$ACCOUNT_NAME" \
    --arg ext  "$EXTERNAL_ID" \
    --arg tok  "$TELEGRAM_BOT_TOKEN" \
    '{
      channel: "telegram",
      provider: "telegram",
      name: $name,
      externalId: $ext,
      telegramBotToken: $tok,
      accessToken: $tok,
      isActive: true
    }')"
  resp="$(api POST /api/channels/accounts "$body")"
  ACCOUNT_ID="$(echo "$resp" | jq -r '.id // empty')"
  APP_SECRET="$(echo "$resp" | jq -r '.appSecret // empty')"
  [[ -n "$ACCOUNT_ID" ]] || { err "Account creation failed: $resp"; exit 1; }
  save_secret "$APP_SECRET"
  log "created account id=${ACCOUNT_ID} externalId=${EXTERNAL_ID}"
  [[ -n "$APP_SECRET" ]] && log "webhook secret captured + cached" \
                         || warn "create response did not expose appSecret — webhook register/simulate will be skipped"
}

# ----- Stage 3: ensure the transform-and-reply workflow ----------------------
stage_ensure_workflow() {
  step "3/5 ensure workflow '${WORKFLOW_NAME}'"

  local all_wf_ids keep_wf_id
  all_wf_ids="$(api GET /api/workflows \
    | jq -r --arg n "$WORKFLOW_NAME" '[.[] | select(.name == $n)] | reverse | .[].id')"

  keep_wf_id="$(echo "$all_wf_ids" | head -1)"

  # Delete all duplicates on every run, not just on recreate.
  for stale_id in $(echo "$all_wf_ids" | tail -n +2); do
    log "removing duplicate workflow ${stale_id}"
    api DELETE "/api/workflows/${stale_id}" >/dev/null 2>&1 || true
  done

  if [[ -n "$keep_wf_id" && "${RECREATE:-0}" != "1" ]]; then
    WORKFLOW_ID="$keep_wf_id"
    log "reusing existing workflow ${WORKFLOW_ID}"
    return 0
  fi
  if [[ -n "$keep_wf_id" ]]; then
    log "RECREATE=1 — replacing workflow ${keep_wf_id}"
    api DELETE "/api/workflows/${keep_wf_id}" >/dev/null 2>&1 || true
  fi

  # transform: echo the text + an ISO-8601 timestamp (toISOString() carries .mmm
  # milliseconds) + epoch ms. Returns { text } -> read as {{results.transform.text}}.
  local js_code
  js_code='(context) => { var src = (context.request && context.request.text) || ""; var now = new Date(); return { text: "Echo: " + src + " — processed at " + now.toISOString() + " (epoch_ms=" + now.getTime() + ")" }; }'

  # accountId is account-agnostic: {{request.envelope.accountId}} is the inbound
  # message's own account, so the workflow never needs editing when the account
  # is recreated.
  local body resp
  body="$(jq -n \
    --arg name      "$WORKFLOW_NAME" \
    --arg app       "$APPLICATION" \
    --arg code      "$js_code" \
    --arg accountId "$ACCOUNT_ID" \
    --arg pin       "$TG_PIN" \
    '{
      name: $name,
      application: $app,
      actions: [
        { name: "transform", activity: "jsFunction", args: { code: $code } },
        {
          name: "reply",
          activity: "channelSend",
          args: {
            accountId: "{{request.envelope.accountId}}",
            channel: "{{request.channel}}",
            provider: "{{request.provider}}",
            to: "{{request.from}}",
            type: "text",
            text: "{{results.transform.text}}"
          }
        }
      ],
      trigger: {
        type: "message_received",
        mode: "shared",
        config: (
          { channels: ["telegram"], providers: ["telegram"] }
          + (if $pin == "1" then { accountIds: [$accountId] } else {} end)
        )
      }
    }')"
  resp="$(api POST /api/workflows "$body")"
  WORKFLOW_ID="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$WORKFLOW_ID" ]] || { err "Workflow creation failed: $resp"; exit 1; }
  log "created workflow id=${WORKFLOW_ID}"
}

# ----- Stage 4: register the Telegram webhook (needs a public HTTPS URL) ------
stage_register_webhook() {
  step "4/5 register Telegram webhook"
  local path="/api/webhooks/telegram/${YOIZEN_TENANT}/${EXTERNAL_ID}"   # NOTE the /api prefix

  if [[ -z "$TG_PUBLIC_URL" ]]; then
    log "TG_PUBLIC_URL not set — skipping setWebhook (Telegram needs a public HTTPS URL)."
    log "Once you have one (e.g. a cloudflared tunnel), run:"
    log "    curl -s \"https://api.telegram.org/bot<token>/setWebhook\" \\"
    log "      --data-urlencode \"url=<public>${path}\" \\"
    log "      --data-urlencode \"secret_token=\$(cat '${SECRET_FILE}')\""
    return 0
  fi
  if [[ "$TELEGRAM_BOT_TOKEN" == PLACEHOLDER:* ]]; then
    warn "TELEGRAM_BOT_TOKEN is a placeholder — cannot register webhook. Skipping."
    return 0
  fi
  if [[ -z "$APP_SECRET" ]]; then
    warn "no appSecret available (reused account without cached secret) — skipping. Re-run with RECREATE=1."
    return 0
  fi

  local public_url="${TG_PUBLIC_URL%/}"
  local url
  if [[ "$public_url" == *"/api/webhooks/telegram"* ]]; then
    if [[ "$public_url" == *"$path" ]]; then
      warn "TG_PUBLIC_URL includes the full webhook path; using it as-is."
      url="$public_url"
    else
      local origin="${public_url%%/api/webhooks/telegram*}"
      warn "TG_PUBLIC_URL includes a webhook path; treating '${origin}' as the public base URL."
      url="${origin}${path}"
    fi
  else
    url="${public_url}${path}"
  fi
  log "setWebhook -> ${url}"
  local resp
  resp="$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    --data-urlencode "url=${url}" \
    --data-urlencode "secret_token=${APP_SECRET}" \
    --data-urlencode 'allowed_updates=["message","channel_post"]')"
  if echo "$resp" | jq -e '.ok == true' >/dev/null 2>&1; then
    log "webhook registered with Telegram ✅"
  else
    warn "setWebhook response: $resp"
  fi
}

# ----- Stage 5 (optional): drive the chain with a synthetic inbound update ----
stage_simulate_inbound() {
  step "5/5 simulate inbound Telegram update"
  if [[ "$SIMULATE_INBOUND" != "1" ]]; then
    log "SIMULATE_INBOUND!=1 — skipping. To drive the chain end-to-end:"
    log "    SIMULATE_INBOUND=1 TELEGRAM_TEST_CHAT_ID=<your-chat-id> ./setup.sh"
    return 0
  fi
  if [[ -z "$APP_SECRET" ]]; then
    warn "no appSecret available — cannot sign the webhook; skipping simulation"
    return 0
  fi

  local chat_id="$TELEGRAM_TEST_CHAT_ID"
  local nonce="tg-$(date +%s)-$RANDOM"

  local update
  update="$(jq -n \
    --argjson mid "$RANDOM" \
    --argjson date "$(date +%s)" \
    --arg chat "$chat_id" \
    --arg text "hello $nonce" \
    '{
      update_id: 1,
      message: {
        message_id: $mid,
        date: $date,
        from: { id: ($chat|tonumber), is_bot: false, first_name: "Sample" },
        chat: { id: ($chat|tonumber), type: "private" },
        text: $text
      }
    }')"

  log "POST /api/webhooks/telegram/${YOIZEN_TENANT}/${EXTERNAL_ID}  (chat_id=${chat_id}, text='hello ${nonce}')"
  local resp status
  resp="$(curl -s -X POST "${YOIZEN_BASE_URL}/api/webhooks/telegram/${YOIZEN_TENANT}/${EXTERNAL_ID}" \
    -H "Host: ${YOIZEN_HOST_HEADER}" \
    -H "Content-Type: application/json" \
    -H "x-telegram-bot-api-secret-token: ${APP_SECRET}" \
    -d "$update")"
  status="$(echo "$resp" | jq -r '.status // empty' 2>/dev/null || true)"
  if [[ "$status" != "accepted" ]]; then
    err "Webhook not accepted: $resp"
    exit 1
  fi
  log "inbound accepted; waiting for a workflow execution (timeout ${POLL_TIMEOUT_S}s)"

  local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while (( $(date +%s) < deadline )); do
    local execs count
    execs="$(api GET "/api/workflows/${WORKFLOW_ID}/executions" 2>/dev/null || echo '[]')"
    count="$(echo "$execs" | jq -r '
      if type=="array" then length
      elif type=="object" and (.items | type)=="array" then (.items | length)
      else 0 end
    ' 2>/dev/null || echo 0)"
    if [[ "${count:-0}" -gt 0 ]]; then
      log "workflow execution observed:"
      echo "$execs" | jq -r '
        (if type=="array" then .[0] else .items[0] end)
        | {id, status, startedAt, completedAt}
      ' 2>/dev/null || echo "$execs"
      return 0
    fi
    sleep 3
  done
  warn "no execution observed within ${POLL_TIMEOUT_S}s — check workflow-service / trigger-consumer logs."
  exit 1
}

main() {
  stage_preflight
  stage_login
  stage_ensure_account
  stage_ensure_workflow
  stage_register_webhook
  stage_simulate_inbound
  echo
  log "Done. Artifacts:"
  log "  - Telegram account ${ACCOUNT_ID} (prefix ${EXTERNAL_PREFIX})"
  log "  - Workflow ${WORKFLOW_ID} (${WORKFLOW_NAME}): transform + reply over Telegram"
  echo
  if [[ "$TELEGRAM_BOT_TOKEN" == PLACEHOLDER:* ]]; then
    warn "You used a placeholder token — sends will 404. Re-run with a real TELEGRAM_BOT_TOKEN and RECREATE=1."
  fi
  log "If earlier sends failed (404/circuit_open), reset the egress breaker once:"
  log "    kubectl rollout restart deploy/channel-service-worker -n <namespace>"
  log "Then message the bot — reply: 'Echo: <your text> — processed at <ISO ms> (epoch_ms=...)'."
}

main "$@"
