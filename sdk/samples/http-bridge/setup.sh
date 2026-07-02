#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: http-bridge  (HTTP channel in -> echo + timestamp -> Telegram out)
# =============================================================================
#
# A message arriving on a DEDICATED HTTP channel instance triggers a workflow
# that:
#   1. ECHOES the received payload (text/from/metadata) and adds timestamp
#      data (ISO-8601 + epoch ms)                       (jsFunction: echo)
#   2. SENDS the echoed result over Telegram to TWO chat_ids in parallel
#      (channelSend, always fanned out via branch — channelSend.to only
#      accepts a single string, so multi-recipient needs a branch, not a
#      comma-separated `to`; the second arm gets a placeholder `to` if a
#      second chat_id wasn't pinned or discovered, fill it in via the UI)
#
#   HTTP msg ─► trigger(message_received, channels:["http"], pinned to this
#               sample's own instance via accountIds)
#                 │
#                 ▼
#               echo    jsFunction — honors ctx.request.{text,from,metadata},
#                       adds an ISO timestamp + epoch ms, returns { text }
#                 ▼
#               notify (branch, parallel, always two arms)
#                       ─► notifyPrimary   (channelSend) -> chat_id_1
#                          notifySecondary (channelSend) -> chat_id_2 (or placeholder)
#
# Idempotent (safe to re-run): reuses the workflow + HTTP instance by name;
# RECREATE=1 rebuilds both.
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - Executor      : services/workflow-service/src/temporal/workflows.ts
#                     (jsFunction gets full ctx; {{...}} templating
#                      String()-coerces each leaf)
#   - Action schema : services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts
#                     (channelSend needs accountId/channel/provider/to/type)
#   - channelSend   : services/workflow-service/src/temporal/activities/channel-send.activity.ts
#                     (to -> Telegram chat_id via TelegramProvider)
#   - HTTP webhook  : services/api-gateway/src/modules/channels/webhooks.controller.ts
#                     (POST /api/webhooks/http/<tenant>[/<externalId>])
# -----------------------------------------------------------------------------
# PREREQS (provision these first — this script only wires the HTTP instance +
# workflow):
#   * A Telegram channel account with a REAL bot token
#       -> sdk/samples/telegram-transform-reply/setup.sh
#   * You (and optionally a second recipient) must have /start-ed that bot —
#       a bot cannot cold-message a phone number, Telegram addresses by chat_id.
#       TELEGRAM_CHAT_ID / TELEGRAM_CHAT_ID_2 are auto-discovered from the
#       bot's recent messages if left unset (see discover_chat_ids below).
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

WORKFLOW_NAME="${BRIDGE_WORKFLOW_NAME:-http-bridge}"
APPLICATION="${BRIDGE_APPLICATION:-samples}"

# Telegram recipients — both are auto-discovered if left unset (see
# discover_chat_ids: it fetches the bot's own token from the platform, then
# calls Telegram's getUpdates to find who has /start-ed it). Set either one
# explicitly to skip discovery for it and pin an exact chat_id. The workflow
# always builds a two-arm notify branch; if TELEGRAM_CHAT_ID_2 is still empty
# after discovery, that arm gets a placeholder `to` to edit later in the UI
# (see stage_resolve). TG_ACCOUNT_ID can pin a specific Telegram channel
# account; otherwise the first active one is used.
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_2="${TELEGRAM_CHAT_ID_2:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"

# Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
# path segment of the per-instance ingress URL
# (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
# pinned to this account's id (accountIds) so ONLY messages to this instance
# fire it — no cross-firing with other http workflows.
HTTP_EXTERNAL_ID="${BRIDGE_HTTP_EXTERNAL_ID:-http-bridge}"
HTTP_ACCOUNT_NAME="${BRIDGE_HTTP_ACCOUNT_NAME:-HTTP Bridge}"

# Pin the trigger to the dedicated http instance via accountIds (Opción B).
# ON by default: the pin matches only messages resolved to this specific http
# account, preventing cross-firing with other http workflows. Set BRIDGE_PIN=0
# to disable and let ANY http message trigger the workflow.
BRIDGE_PIN="${BRIDGE_PIN:-1}"

# Defaults to always rebuild: this sample is meant to be re-run while you
# iterate on chat_ids (e.g. edit the second recipient later via the UI), so
# reuse-by-name would just mask that. Set RECREATE=0 to go back to reusing.
RECREATE="${RECREATE:-1}"

# ----- Pretty logging (verbose; nothing fails silently) ----------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
HTTP_ACCOUNT_ID=""; HTTP_APP_SECRET=""
WORKFLOW_ID=""

# The echo step. English code/comments. Honors the inbound payload
# (ctx.request.text / ctx.request.from / ctx.request.metadata) and adds echo
# data: an ISO-8601 timestamp (toISOString() carries .mmm milliseconds) plus
# the epoch ms. Returns { text } -> read as {{results.echo.text}}.
read -r -d '' ECHO_CODE <<'JS' || true
(ctx) => {
  var req = (ctx.request) || {};
  var text = req.text || "";
  var from = req.from || "unknown";
  var metadata = req.metadata ? JSON.stringify(req.metadata) : "{}";
  var now = new Date();
  var out =
    "Echo: " + text +
    " (from=" + from + ", metadata=" + metadata + ")" +
    " — processed at " + now.toISOString() +
    " (epoch_ms=" + now.getTime() + ")";
  return { text: out };
}
JS

# api <method> <path> [json-body] — authenticated, tenant-scoped JSON call.
# Content-Type is only set when there's an actual body: Fastify's JSON body
# parser 400s on "Body cannot be empty when content-type is set to
# 'application/json'" for bodyless DELETE/GET calls sent with that header.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -X "$method" "${YOIZEN_BASE_URL}${path}"
    -H "Host: ${YOIZEN_HOST_HEADER}"
    -H "x-yoizen-tenant: ${YOIZEN_TENANT}")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer ${TOKEN}")
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}"
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
  [[ -n "$ECHO_CODE" ]] || { err "ECHO_CODE failed to load"; exit 1; }
  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}"
  if [[ -n "$TELEGRAM_CHAT_ID" ]]; then
    log "telegram chat_id(s) preset: ${TELEGRAM_CHAT_ID}${TELEGRAM_CHAT_ID_2:+, $TELEGRAM_CHAT_ID_2}"
  else
    log "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
  fi
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

# fetch_telegram_chats <bot_token> — one getUpdates call, returns one row per
# distinct chat as "<chat_id>\t<label>", most recent message first. Empty
# output means "no updates available right now" (caller decides whether to
# retry); prints a warning only on a hard Telegram API error.
fetch_telegram_chats() {
  local bot_token="$1" updates
  updates="$(curl -s "https://api.telegram.org/bot${bot_token}/getUpdates")"
  if [[ "$(echo "$updates" | jq -r '.ok // false')" != "true" ]]; then
    warn "Telegram getUpdates failed: $(echo "$updates" | jq -rc '.description // .' 2>/dev/null)"
    return 0
  fi
  echo "$updates" | jq -r '
    [.result[].message? // empty | select(.chat.id != null)
      | {id: .chat.id, label: (.chat.username // .chat.first_name // "unknown"), date}]
    | group_by(.id) | map(max_by(.date)) | sort_by(-.date)
    | .[] | "\(.id)\t\(.label)"
  '
}

# discover_chat_ids <bot_token> — calls Telegram's getUpdates with the bot's
# OWN token (fetched from the platform, see below) to find everyone who has
# /start-ed it, then auto-fills any of TELEGRAM_CHAT_ID / TELEGRAM_CHAT_ID_2
# that were left unset. Explicit env vars always win — discovery only fills
# gaps. Safe to skip: on any failure (placeholder token, no updates yet) it
# just warns and leaves the vars as they were.
#
# getUpdates and an active webhook are mutually exclusive on the SAME bot
# token (Telegram returns 409 "Conflict"), and telegram-transform-reply
# registers one. So: capture the current webhook (getWebhookInfo), clear it
# (deleteWebhook) to unblock polling, then restore the exact same URL
# afterward — BRIDGE_RESTORE_WEBHOOK=0 skips the restore if you'd rather
# leave the bot in polling mode.
#
# IMPORTANT: updates already pushed through an active webhook are consumed —
# Telegram does NOT replay them via getUpdates once the webhook is cleared,
# not even ones sent BEFORE this run started. So if a webhook was active, any
# /start sent earlier is unrecoverable; only messages sent AFTER the webhook
# drops will show up. A fixed timer is a bad fit for "go coordinate with
# another human right now" — too short and it's a race, too long and a
# solo/CI run just stalls. So: interactive shells get a blocking prompt (press
# Enter once everyone has messaged the bot, capped by
# BRIDGE_DISCOVER_WAIT_SECONDS so it can't hang forever); non-interactive
# shells fall back to sleeping that same duration, then poll a few times to
# absorb Telegram's own delivery lag.
discover_chat_ids() {
  local bot_token="$1"
  if [[ -z "$TELEGRAM_CHAT_ID" || -z "$TELEGRAM_CHAT_ID_2" ]]; then
    if [[ -z "$bot_token" || "$bot_token" == PLACEHOLDER:* ]]; then
      warn "telegram account has no real bot token — cannot auto-discover chat_ids"
      return 0
    fi

    local webhook_url
    webhook_url="$(curl -s "https://api.telegram.org/bot${bot_token}/getWebhookInfo" \
      | jq -r '.result.url // empty')"
    if [[ -n "$webhook_url" ]]; then
      log "clearing active webhook (${webhook_url}) so getUpdates can poll"
      curl -s "https://api.telegram.org/bot${bot_token}/deleteWebhook" >/dev/null
    fi

    local chats=""
    if [[ -n "$webhook_url" ]]; then
      local wait_seconds="${BRIDGE_DISCOVER_WAIT_SECONDS:-60}" \
            poll_interval="${BRIDGE_DISCOVER_POLL_INTERVAL:-2}"
      warn "the webhook was already delivering — any /start sent BEFORE this point is gone and will NOT be found"
      log "ask everyone to send /start (or any message) to the bot NOW, after this line printed"
      if [[ -t 0 ]]; then
        read -r -t "$wait_seconds" -p "  press Enter once everyone has sent it (auto-continues after ${wait_seconds}s)... " _ || true
      else
        log "non-interactive shell — waiting ${wait_seconds}s instead of prompting"
        sleep "$wait_seconds"
      fi
      # Telegram can lag a moment before a just-sent message shows up in
      # getUpdates; retry a handful of times rather than a single shot.
      local attempt
      for attempt in 1 2 3 4 5; do
        chats="$(fetch_telegram_chats "$bot_token")"
        [[ -n "$chats" ]] && break
        sleep "$poll_interval"
      done
    else
      chats="$(fetch_telegram_chats "$bot_token")"
    fi

    if [[ -z "$chats" ]]; then
      warn "no Telegram chats found — have the recipient(s) send /start to the bot, then re-run"
    else
      log "discovered telegram chats (most recent first):"
      while IFS=$'\t' read -r cid label; do log "  chat_id=${cid}  (${label})"; done <<<"$chats"

      if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
        TELEGRAM_CHAT_ID="$(head -1 <<<"$chats" | cut -f1)"
        log "auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)"
      fi
      if [[ -z "$TELEGRAM_CHAT_ID_2" ]]; then
        TELEGRAM_CHAT_ID_2="$(awk -F'\t' -v skip="$TELEGRAM_CHAT_ID" '$1 != skip {print $1; exit}' <<<"$chats")"
        [[ -n "$TELEGRAM_CHAT_ID_2" ]] && log "auto-selected TELEGRAM_CHAT_ID_2=${TELEGRAM_CHAT_ID_2} (next most recent distinct chat)"
      fi
    fi

    if [[ -n "$webhook_url" ]]; then
      if [[ "${BRIDGE_RESTORE_WEBHOOK:-1}" == "1" ]]; then
        log "restoring webhook -> ${webhook_url}"
        curl -s "https://api.telegram.org/bot${bot_token}/setWebhook" \
          --data-urlencode "url=${webhook_url}" >/dev/null
      else
        warn "BRIDGE_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh or set it again manually when done polling"
      fi
    fi
  fi
}

# ----- Stage 2: resolve dependency ids (telegram account + http instance) ----
stage_resolve() {
  step "2/3 resolve telegram account + http instance"

  local tg_accounts tg_bot_token
  tg_accounts="$(api GET "/api/channels/accounts?channel=telegram")"
  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    TG_ACCOUNT_ID="$(echo "$tg_accounts" \
      | jq -r 'if type=="array" then ([.[] | select(.isActive)] | .[0].id // empty) else empty end')"
  fi
  if [[ -z "$TG_ACCOUNT_ID" ]]; then
    err "no active Telegram channel account found."
    err "Provision one first:  (cd ../telegram-transform-reply && TELEGRAM_BOT_TOKEN=... ./setup.sh)"
    err "or pin one with TG_ACCOUNT_ID=<id>."
    exit 1
  fi
  log "telegram account=${TG_ACCOUNT_ID}"

  tg_bot_token="$(echo "$tg_accounts" | jq -r --arg id "$TG_ACCOUNT_ID" \
    '.[] | select(.id == $id) | .accessToken // empty')"
  discover_chat_ids "$tg_bot_token"

  if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    err "TELEGRAM_CHAT_ID is required and could not be auto-discovered."
    err "DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually."
    exit 1
  fi

  # The workflow always builds the notify branch (two parallel recipients),
  # even if a second chat_id was never found — notifySecondary just gets the
  # same chat_id as notifyPrimary (both arms send, both land in the same
  # chat) until you swap in the real second id via the UI.
  if [[ -z "$TELEGRAM_CHAT_ID_2" ]]; then
    TELEGRAM_CHAT_ID_2="$TELEGRAM_CHAT_ID"
    warn "no second chat_id found — wiring the branch with ${TELEGRAM_CHAT_ID} on BOTH arms; edit notifySecondary in the UI once you have a real second id"
  fi
  log "telegram chat_ids=${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}"

  ensure_http_account
}

# build_workflow_body — assemble the workflow definition with resolved ids.
build_workflow_body() {
  jq -n \
    --arg name "$WORKFLOW_NAME" \
    --arg app "$APPLICATION" \
    --arg tgAccount "$TG_ACCOUNT_ID" \
    --arg httpAccount "$HTTP_ACCOUNT_ID" \
    --arg pin "$BRIDGE_PIN" \
    --arg chatId "$TELEGRAM_CHAT_ID" \
    --arg chatId2 "$TELEGRAM_CHAT_ID_2" \
    --arg echoCode "$ECHO_CODE" \
    '{
      name: $name,
      application: $app,
      actions: [
        {
          name: "echo",
          activity: "jsFunction",
          args: { code: $echoCode }
        },
        (
          # channelSend.to only accepts a single string, so two recipients
          # need a branch with one channelSend arm per chat_id, not a
          # comma-separated `to`. Always built (even with a placeholder
          # chatId2) so the canvas shape is right from the start.
          {
            accountId: $tgAccount,
            channel: "telegram",
            provider: "telegram",
            type: "text",
            text: "{{results.echo.text}}"
          } as $notifyArgs |
          {
            name: "notify",
            activity: "branch",
            recipientA: [ { name: "notifyPrimary",   activity: "channelSend", args: ($notifyArgs + { to: $chatId }) } ],
            recipientB: [ { name: "notifySecondary", activity: "channelSend", args: ($notifyArgs + { to: $chatId2 }) } ]
          }
        )
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
  log "  echo    : jsFunction honors ctx.request.{text,from,metadata} + adds ISO timestamp/epoch ms"
  log "  notify  : branch (parallel) channelSend telegram -> chats ${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}"
  if [[ "$TELEGRAM_CHAT_ID_2" == "$TELEGRAM_CHAT_ID" ]]; then
    log "            ^ no second chat_id found — both arms point at the same chat; edit notifySecondary in the UI"
  fi
  log "  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)"
  echo
  log "Drive it — POST to THIS instance's own URL (no other http workflow fires):"
  log "    curl -X POST '${ingest_url}' \\"
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "      -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
  else
    log "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
  fi
  log "      -H 'content-type: application/json' \\"
  log "      -d '{\"from\":\"me\",\"text\":\"hola\"}'"
  log "Or just run ./run.sh, which resolves the token and posts a test payload for you."
  log "Then check Telegram — the bot DMs you the echoed payload."
}

main "$@"
