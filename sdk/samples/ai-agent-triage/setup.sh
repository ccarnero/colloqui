#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-agent-triage  (HTTP channel in -> agentCall triage -> Telegram out)
# =============================================================================
#
# A customer message arriving on a DEDICATED HTTP channel instance triggers a
# workflow that:
#   1. CLASSIFIES the message with a published AI agent that replies ONLY with
#      a compact JSON object {intent, sentiment, priority, summary}
#                                                     (agentCall: triage)
#   2. PARSES/normalizes the agent's JSON reply (with a safe fallback if the
#      LLM strays from the contract) and derives an escalate verdict
#                                                     (jsFunction: route)
#   3. ROUTES on that verdict through an exclusive gateway and sends either a
#      🚨 escalation alert or a ✅ triage summary over Telegram
#                                                     (conditional: notify)
#
#   HTTP msg ─► trigger(message_received, channels:["http"], pinned to this
#               sample's own instance via accountIds)
#                 │
#                 ▼
#               triage  agentCall — message: {{request.text}}; the published
#                       'ai-sample-triage' agent replies with compact JSON;
#                       result lands at results.triage.data.reply
#                 ▼
#               route   jsFunction — JSON.parse with code-fence stripping and
#                       fail-safe fallback; returns { escalate, priority,
#                       sentiment, alertText, normalText }. Parse-only: the
#                       routing decision belongs to the gateway below.
#                 ▼
#               notify  conditional — exclusive gateway on
#                       results.route.escalate eq "true":
#                         Escalate ─► 🚨 channelSend telegram (alertText)
#                         default  ─► ✅ channelSend telegram (normalText)
#                       (each arm becomes a parallel branch with one
#                        channelSend per chat when a second chat id is
#                        pinned — channelSend.to only accepts a single string)
#
# This is the first sample demonstrating the `agentCall` workflow action.
# Idempotent (safe to re-run): connector + agent are upserted in place on
# every run; the HTTP instance + workflow are rebuilt when RECREATE=1
# (the default, so the freshly resolved agent id / chat ids are always wired).
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - AgentCallArgs : packages/shared/src/workflow.interfaces.ts
#                     ({ agentId, message, conversationId?, customerName?,
#                        userId?, channel?, context?, variables? })
#   - Action schema : services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts
#                     (agentCall requires non-empty agentId + message strings)
#   - Executor      : services/workflow-service/src/temporal/workflows.ts
#                     (agentCall resolves {{...}} templates, then OVERWRITES
#                      args.variables with the execution context's variables)
#   - agentCall     : services/workflow-service/src/temporal/activities/agent-call.activity.ts
#                     (returns { status, data: { reply, tool_calls }, headers }
#                      -> the agent's text is results.triage.data.reply)
#   - Agent CRUD    : services/api-gateway/src/modules/admin/admin-agents.controller.ts
#   - channelSend   : services/workflow-service/src/temporal/activities/channel-send.activity.ts
#   - HTTP webhook  : services/api-gateway/src/modules/channels/webhooks.controller.ts
#                     (POST /api/webhooks/http/<tenant>/<externalId>)
# -----------------------------------------------------------------------------
# PREREQS (provision these first — this script wires connector + agent + HTTP
# instance + workflow):
#   * A Telegram channel account with a REAL bot token
#       -> sdk/samples/telegram-transform-reply/setup.sh
#   * You must have /start-ed that bot (TELEGRAM_CHAT_ID is auto-discovered
#     from the bot's recent messages if left unset).
#   * An LLM API key (e.g. OPENAI_API_KEY) in .env — the triage agent needs a
#     real online LLM. http-connectors is NOT needed here.
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

WORKFLOW_NAME="${TRIAGE_WORKFLOW_NAME:-ai-agent-triage}"
APPLICATION="${TRIAGE_APPLICATION:-samples}"

# --- AI agent + LLM connector (same knobs as ai-agent-playground) ------------
AGENT_NAME="${AI_AGENT_NAME:-ai-sample-triage}"
AGENT_DESCRIPTION="${AI_AGENT_DESCRIPTION:-Call-center triage classifier created by sdk/samples/ai-agent-triage}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"

# --- Telegram recipients ------------------------------------------------------
# Auto-discovered if left unset (setup fetches the bot's own token from the
# platform and calls Telegram's getUpdates). If a SECOND chat id is pinned or
# discovered, notify becomes a parallel branch with one channelSend arm per
# chat (channelSend.to is a single string). TG_ACCOUNT_ID pins a specific
# Telegram channel account; otherwise the first active one is used.
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TELEGRAM_CHAT_ID_2="${TELEGRAM_CHAT_ID_2:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"

# Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
# path segment of the per-instance ingress URL
# (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
# pinned to this account's id (accountIds) so ONLY messages to this instance
# fire it — no cross-firing with other http workflows.
HTTP_EXTERNAL_ID="${TRIAGE_HTTP_EXTERNAL_ID:-ai-agent-triage}"
HTTP_ACCOUNT_NAME="${TRIAGE_HTTP_ACCOUNT_NAME:-AI Agent Triage}"

# Pin the trigger to the dedicated http instance via accountIds. ON by
# default; set TRIAGE_PIN=0 to let ANY http message trigger the workflow.
TRIAGE_PIN="${TRIAGE_PIN:-1}"

# Defaults to always rebuild the HTTP instance + workflow: the workflow body
# embeds the agent id and chat id(s) resolved on THIS run, so reuse-by-name
# would mask changes. Connector + agent are upserted in place regardless.
# Set RECREATE=0 to reuse the existing instance/workflow by name.
RECREATE="${RECREATE:-1}"

# ----- Pretty logging (verbose; nothing fails silently) ----------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
CONNECTOR_ID=""
AGENT_ID=""
HTTP_ACCOUNT_ID=""; HTTP_APP_SECRET=""
WORKFLOW_ID=""

# System prompt for the triage agent: reply ONLY with compact JSON so the
# `route` jsFunction can parse it deterministically.
read -r -d '' TRIAGE_SYSTEM_PROMPT <<'PROMPT' || true
You are a call-center triage classifier. For every customer message you receive, reply ONLY with a compact single-line JSON object and nothing else — no prose, no markdown, no code fences. The object must have exactly these keys:
{"intent": "<short intent label, e.g. refund, shipping, complaint, question>", "sentiment": "positive|neutral|negative", "priority": "low|normal|high|urgent", "summary": "<one short sentence summarizing the customer's message>"}
Rules: sentiment and priority MUST be one of the listed values. Angry or threatening messages are negative and at least high priority. If the message is empty or meaningless, use intent "unknown", sentiment "neutral", priority "low".
PROMPT

# The route step. Safely parses the agent's JSON reply from
# results.triage.data.reply (agentCall returns { status, data: { reply,
# tool_calls } } — see agent-call.activity.ts), stripping markdown code
# fences if the LLM adds them, and falls back to a neutral classification if
# parsing fails. Parse-only: the actual routing decision is taken by the
# downstream `notify` conditional gateway, which compares
# results.route.escalate against "true" (the engine's condition resolver
# reads raw context paths and String()-compares, so a boolean matches "true"
# — see resolvePathRaw/compare in temporal/workflows.ts). A conditional
# CANNOT parse the JSON string itself: IConditionRule.variable is a dot-path
# walked over objects, which is why this jsFunction must exist at all.
read -r -d '' ROUTE_CODE <<'JS' || true
(ctx) => {
  var req = ctx.request || {};
  var triage = (ctx.results && ctx.results.triage) || {};
  var raw = (triage.data && typeof triage.data.reply === "string")
    ? triage.data.reply
    : "";

  var cleaned = raw.trim();
  var fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) cleaned = fence[1].trim();

  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = {
      intent: "unknown",
      sentiment: "neutral",
      priority: "high", // fail safe: an unparseable triage is escalated
      summary: raw ? ("unparseable agent reply: " + raw.slice(0, 160)) : "agent returned no reply"
    };
  }

  var priority = parsed.priority || "normal";
  var sentiment = parsed.sentiment || "neutral";
  var escalate = priority === "urgent" || priority === "high" || sentiment === "negative";

  var detail =
    "priority: " + priority +
    " | sentiment: " + sentiment +
    " | intent: " + (parsed.intent || "unknown") + "\n" +
    (parsed.summary || "(no summary)") + "\n" +
    "Original: " + (req.text || "(empty)");

  return {
    escalate: escalate,
    priority: priority,
    sentiment: sentiment,
    alertText: "🚨 ESCALATION — " + detail,
    normalText: "✅ Triage — " + detail
  };
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

# ----- LLM provider helpers (same contract as ai-agent-playground) -----------
provider_api_key_var() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    anthropic) echo "ANTHROPIC_API_KEY" ;;
    cohere) echo "COHERE_API_KEY" ;;
    deepseek) echo "DEEPSEEK_API_KEY" ;;
    google) echo "GOOGLE_API_KEY" ;;
    groq) echo "GROQ_API_KEY" ;;
    mistral) echo "MISTRAL_API_KEY" ;;
    openai) echo "OPENAI_API_KEY" ;;
    openrouter) echo "OPENROUTER_API_KEY" ;;
    xai) echo "XAI_API_KEY" ;;
    ollama) echo "OLLAMA_API_KEY" ;;
    *) echo "" ;;
  esac
}

provider_base_url_var() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    anthropic) echo "ANTHROPIC_BASE_URL" ;;
    groq) echo "GROQ_BASE_URL" ;;
    mistral) echo "MISTRAL_BASE_URL" ;;
    openai) echo "OPENAI_BASE_URL" ;;
    ollama) echo "OLLAMA_BASE_URL" ;;
    openrouter) echo "OPENROUTER_BASE_URL" ;;
    xai) echo "XAI_BASE_URL" ;;
    *) echo "" ;;
  esac
}

provider_default_base_url() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    anthropic) echo "https://api.anthropic.com" ;;
    cohere) echo "https://api.cohere.com/v2" ;;
    deepseek) echo "https://api.deepseek.com" ;;
    google) echo "https://generativelanguage.googleapis.com/v1beta" ;;
    groq) echo "https://api.groq.com/openai/v1" ;;
    mistral) echo "https://api.mistral.ai/v1" ;;
    openai) echo "https://api.openai.com/v1" ;;
    openrouter) echo "https://openrouter.ai/api/v1" ;;
    xai) echo "https://api.x.ai/v1" ;;
    ollama) echo "http://localhost:11434/v1" ;;
    *) echo "" ;;
  esac
}

read_env_value() {
  local key="$1"
  [[ -n "$key" ]] || return 0
  printf '%s' "${!key:-}"
}

is_placeholder_secret() {
  local value="$1"
  [[ "$value" == "sk-..." || "$value" == *"your-"* || "$value" == *"replace-me"* || "$value" == *"example"* ]]
}

# ----- Stage 0: preflight ----------------------------------------------------
stage_preflight() {
  step "0/5 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -n "$TRIAGE_SYSTEM_PROMPT" ]] || { err "TRIAGE_SYSTEM_PROMPT failed to load"; exit 1; }
  [[ -n "$ROUTE_CODE" ]] || { err "ROUTE_CODE failed to load"; exit 1; }

  case "${CREDENTIAL_MODE}" in
    connector|env) ;;
    *) err "AI_CREDENTIAL_MODE must be 'connector' or 'env'"; exit 1 ;;
  esac

  local key_var key_value
  key_var="$(provider_api_key_var "$AGENT_PROVIDER")"
  key_value="$(read_env_value "$key_var")"

  if [[ "$CREDENTIAL_MODE" == "connector" ]]; then
    if [[ -z "$key_var" ]]; then
      err "Unsupported provider '${AGENT_PROVIDER}'. Choose openai, anthropic, google, groq, mistral, cohere, openrouter, xai, ollama, or deepseek."
      exit 1
    fi
    if [[ -z "$key_value" && "${AGENT_PROVIDER}" != "ollama" ]]; then
      err "${key_var} is required for AI_CREDENTIAL_MODE=connector. Put it in .env next to setup.sh."
      exit 1
    fi
    if [[ -n "$key_value" ]] && is_placeholder_secret "$key_value"; then
      err "${key_var} looks like a placeholder. Replace it with a real provider key."
      exit 1
    fi
    log "credential mode=connector provider=${AGENT_PROVIDER} model=${AGENT_MODEL} connector=${LLM_CONNECTOR_NAME}"
  else
    warn "credential mode=env: this script cannot inject ${key_var:-provider API key} into the running agent-ai-service."
    warn "Make sure the service deployment already has the provider env var before executing."
    log "provider=${AGENT_PROVIDER} model=${AGENT_MODEL}"
  fi

  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  workflow=${WORKFLOW_NAME}  agent=${AGENT_NAME}  recreate=${RECREATE}"
  if [[ -n "$TELEGRAM_CHAT_ID" ]]; then
    log "telegram chat_id(s) preset: ${TELEGRAM_CHAT_ID}${TELEGRAM_CHAT_ID_2:+, $TELEGRAM_CHAT_ID_2}"
  else
    log "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
  fi
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

# ----- Stage 2: ensure LLM connector -----------------------------------------
resolve_connector_id_by_name() {
  api GET "/api/connectors?context=external" \
    | jq -r --arg n "$1" 'if type=="array" then (.[] | select(.name==$n) | .id) else empty end' \
    | head -1
}

stage_ensure_llm_connector() {
  [[ "$CREDENTIAL_MODE" == "connector" ]] || { step "2/5 skip LLM connector (credential mode=env)"; return 0; }
  step "2/5 ensure LLM connector '${LLM_CONNECTOR_NAME}'"

  local key_var base_var api_key base_url body resp
  key_var="$(provider_api_key_var "$AGENT_PROVIDER")"
  base_var="$(provider_base_url_var "$AGENT_PROVIDER")"
  api_key="$(read_env_value "$key_var")"
  base_url="$(read_env_value "$base_var")"
  [[ -n "$base_url" ]] || base_url="$(provider_default_base_url "$AGENT_PROVIDER")"

  CONNECTOR_ID="$(resolve_connector_id_by_name "$LLM_CONNECTOR_NAME")"

  body="$(jq -n \
    --arg name "$LLM_CONNECTOR_NAME" \
    --arg baseUrl "$base_url" \
    --arg token "$api_key" \
    '{
      name: $name,
      context: "external",
      baseUrl: $baseUrl,
      authType: "bearer",
      authConfig: { bearerToken: $token },
      timeoutMs: 60000,
      maxRetries: 1,
      retryBackoffMs: 500,
      tags: ["llm"],
      endpoints: []
    }')"

  if [[ -z "$CONNECTOR_ID" ]]; then
    resp="$(api POST /api/connectors "$body")"
    CONNECTOR_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$CONNECTOR_ID" ]] || { err "LLM connector creation failed: ${resp}"; exit 1; }
    log "created connector id=${CONNECTOR_ID} baseUrl=${base_url}"
  else
    log "reusing connector id=${CONNECTOR_ID}"
    resp="$(api PATCH "/api/connectors/${CONNECTOR_ID}" "$(echo "$body" | jq '{baseUrl, authType, authConfig, timeoutMs, maxRetries, retryBackoffMs, tags}')")"
    if ! echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1; then
      warn "connector update returned: ${resp}"
    fi
  fi
}

# ----- Stage 3: upsert + publish the triage agent ----------------------------
resolve_agent_id_by_name() {
  api GET "/api/admin/agents?limit=100" \
    | jq -r --arg n "$1" '(.agents // []) | map(select(.name==$n and (.is_active // true))) | .[0].id // empty'
}

agent_payload() {
  local connector_json
  if [[ "$CREDENTIAL_MODE" == "connector" ]]; then
    connector_json="$(jq -n --arg id "$CONNECTOR_ID" '$id')"
  else
    connector_json="null"
  fi

  # Low temperature + small maxTokens: the agent's only job is a compact,
  # deterministic JSON classification — no creativity, no long outputs.
  jq -n \
    --arg name "$AGENT_NAME" \
    --arg description "$AGENT_DESCRIPTION" \
    --arg provider "$AGENT_PROVIDER" \
    --arg model "$AGENT_MODEL" \
    --arg prompt "$TRIAGE_SYSTEM_PROMPT" \
    --argjson connectorId "$connector_json" \
    '{
      name: $name,
      description: $description,
      system_prompt: $prompt,
      model_config: {
        llm: {
          provider: $provider,
          model: $model,
          connectorId: $connectorId,
          temperature: 0.1,
          maxTokens: 200
        },
        rules: "Reply ONLY with the compact JSON object. Never add prose, markdown, or code fences.",
        soul: "Precise, terse, deterministic.",
        subagents: []
      },
      tools: [],
      channels: []
    }'
}

stage_upsert_agent() {
  step "3/5 upsert + publish agent '${AGENT_NAME}'"
  local existing_id resp body
  existing_id="$(resolve_agent_id_by_name "$AGENT_NAME")"

  body="$(agent_payload)"

  if [[ -n "$existing_id" ]]; then
    resp="$(api PUT "/api/admin/agents/${existing_id}" "$body")"
    AGENT_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$AGENT_ID" ]] || { err "Agent update failed: ${resp}"; exit 1; }
    log "updated agent id=${AGENT_ID}"
  else
    resp="$(api POST /api/admin/agents "$body")"
    AGENT_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$AGENT_ID" ]] || { err "Agent creation failed: ${resp}"; exit 1; }
    log "created agent id=${AGENT_ID}"
  fi

  resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
  if echo "$resp" | jq -e '.id // empty' >/dev/null 2>&1; then
    log "published agent id=${AGENT_ID}"
  else
    err "Agent publish failed: ${resp}"
    exit 1
  fi
}

# ----- Telegram chat discovery (same contract as http-bridge) -----------------
# fetch_telegram_chats <bot_token> — one getUpdates call, returns one row per
# distinct chat as "<chat_id>\t<label>", most recent message first.
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

# discover_chat_ids <bot_token> — polls Telegram's getUpdates with the bot's
# OWN token (fetched from the platform) to auto-fill TELEGRAM_CHAT_ID /
# TELEGRAM_CHAT_ID_2 when unset. getUpdates and an active webhook are mutually
# exclusive on the same token, so the current webhook (registered by
# telegram-transform-reply) is captured, cleared, and restored afterward
# (TRIAGE_RESTORE_WEBHOOK=0 skips the restore). Updates already pushed through
# the webhook are consumed and never replay — send /start only AFTER the
# prompt below prints.
discover_chat_ids() {
  local bot_token="$1"
  # Only poll when the primary chat id is unset: discovery clears/restores the
  # bot's webhook, which briefly interrupts live delivery. A preset
  # TELEGRAM_CHAT_ID means the second recipient stays opt-in (TELEGRAM_CHAT_ID_2).
  if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
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
      local wait_seconds="${TRIAGE_DISCOVER_WAIT_SECONDS:-60}" \
            poll_interval="${TRIAGE_DISCOVER_POLL_INTERVAL:-2}"
      warn "the webhook was already delivering — any /start sent BEFORE this point is gone and will NOT be found"
      log "send /start (or any message) to the bot NOW, after this line printed"
      if [[ -t 0 ]]; then
        read -r -t "$wait_seconds" -p "  press Enter once you have sent it (auto-continues after ${wait_seconds}s)... " _ || true
      else
        log "non-interactive shell — waiting ${wait_seconds}s instead of prompting"
        sleep "$wait_seconds"
      fi
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
      warn "no Telegram chats found — send /start to the bot, then re-run"
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
      if [[ "${TRIAGE_RESTORE_WEBHOOK:-1}" == "1" ]]; then
        log "restoring webhook -> ${webhook_url}"
        curl -s "https://api.telegram.org/bot${bot_token}/setWebhook" \
          --data-urlencode "url=${webhook_url}" >/dev/null
      else
        warn "TRIAGE_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh or set it again manually when done polling"
      fi
    fi
  fi
}

# ensure_http_account — resolve (or create) the sample's dedicated HTTP channel
# instance, identified by externalId. Captures HTTP_ACCOUNT_ID + HTTP_APP_SECRET
# (the gateway returns appSecret in the list, plaintext). Deduplicates on every run.
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

  if [[ -n "$keep_id" && "${RECREATE}" != "1" ]]; then
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

# ----- Stage 4: resolve dependency ids (telegram account + http instance) ----
stage_resolve() {
  step "4/5 resolve telegram account + http instance"

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
  log "telegram chat_id(s)=${TELEGRAM_CHAT_ID}${TELEGRAM_CHAT_ID_2:+, $TELEGRAM_CHAT_ID_2}"

  ensure_http_account
}

# build_workflow_body — assemble the workflow definition with resolved ids.
#
# agentCall args (AgentCallArgs, packages/shared/src/workflow.interfaces.ts):
# agentId + message are required; conversationId/userId/channel are optional
# metadata forwarded to the agent runtime. NOTE: args.variables would be
# OVERWRITTEN by the workflow's own execution-context variables at run time
# (see executeAction case "agentCall" in temporal/workflows.ts), so it is not
# set here — everything the agent needs travels in `message`.
# notify_actions_for <name-prefix> <text-template> — emit the JSON array of
# actions that delivers one text to the configured recipient(s). channelSend.to
# only accepts a single string, so two recipients need a branch with one
# channelSend arm per chat_id (http-bridge pattern). Used for both arms of the
# `notify` conditional gateway below.
notify_actions_for() {
  local prefix="$1" text_tpl="$2"
  if [[ -n "$TELEGRAM_CHAT_ID_2" && "$TELEGRAM_CHAT_ID_2" != "$TELEGRAM_CHAT_ID" ]]; then
    jq -n \
      --arg tgAccount "$TG_ACCOUNT_ID" \
      --arg chatId "$TELEGRAM_CHAT_ID" \
      --arg chatId2 "$TELEGRAM_CHAT_ID_2" \
      --arg prefix "$prefix" \
      --arg text "$text_tpl" \
      '{
        accountId: $tgAccount,
        channel: "telegram",
        provider: "telegram",
        type: "text",
        text: $text
      } as $notifyArgs |
      [{
        name: ($prefix + "Fanout"),
        activity: "branch",
        recipientA: [ { name: ($prefix + "Primary"),   activity: "channelSend", args: ($notifyArgs + { to: $chatId }) } ],
        recipientB: [ { name: ($prefix + "Secondary"), activity: "channelSend", args: ($notifyArgs + { to: $chatId2 }) } ]
      }]'
  else
    jq -n \
      --arg tgAccount "$TG_ACCOUNT_ID" \
      --arg chatId "$TELEGRAM_CHAT_ID" \
      --arg prefix "$prefix" \
      --arg text "$text_tpl" \
      '[{
        name: ($prefix + "Send"),
        activity: "channelSend",
        args: {
          accountId: $tgAccount,
          channel: "telegram",
          provider: "telegram",
          to: $chatId,
          type: "text",
          text: $text
        }
      }]'
  fi
}

build_workflow_body() {
  local notify_action

  # Exclusive gateway (ConditionalAction, workflow.interfaces.ts): branches are
  # evaluated top-to-bottom, first match wins, `default` runs when none match.
  # The condition reads results.route.escalate (a boolean) — the engine
  # resolves the path raw and compares String(left) === String(right), so
  # value "true" matches. The result exposes { matchedBranch }.
  notify_action="$(jq -n \
    --argjson alertActions "$(notify_actions_for alert '{{results.route.alertText}}')" \
    --argjson normalActions "$(notify_actions_for resolve '{{results.route.normalText}}')" \
    '{
      name: "notify",
      activity: "conditional",
      branches: [
        {
          label: "Escalate",
          condition: { variable: "results.route.escalate", comparator: "eq", value: "true" },
          actions: $alertActions
        }
      ],
      default: $normalActions
    }')"

  jq -n \
    --arg name "$WORKFLOW_NAME" \
    --arg app "$APPLICATION" \
    --arg agentId "$AGENT_ID" \
    --arg httpAccount "$HTTP_ACCOUNT_ID" \
    --arg pin "$TRIAGE_PIN" \
    --arg routeCode "$ROUTE_CODE" \
    --argjson notify "$notify_action" \
    '{
      name: $name,
      application: $app,
      actions: [
        {
          name: "triage",
          activity: "agentCall",
          args: {
            agentId: $agentId,
            message: "{{request.text}}",
            conversationId: "ai-agent-triage",
            userId: "{{request.from}}",
            channel: "http"
          }
        },
        {
          name: "route",
          activity: "jsFunction",
          args: { code: $routeCode }
        },
        $notify
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

# ----- Stage 5: ensure the workflow ------------------------------------------
stage_ensure_workflow() {
  step "5/5 ensure workflow '${WORKFLOW_NAME}'"

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
  stage_ensure_llm_connector
  stage_upsert_agent
  stage_resolve
  stage_ensure_workflow

  local ingest_url="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"

  echo
  log "Done. Workflow '${WORKFLOW_NAME}' (${WORKFLOW_ID}):"
  log "  trigger : message_received on channels=[http], pinned to accountIds=[${HTTP_ACCOUNT_ID}]"
  log "  triage  : agentCall -> agent '${AGENT_NAME}' (${AGENT_ID}), replies compact JSON classification"
  log "  route   : jsFunction parses results.triage.data.reply (fail-safe fallback), derives escalate verdict"
  if [[ -n "$TELEGRAM_CHAT_ID_2" && "$TELEGRAM_CHAT_ID_2" != "$TELEGRAM_CHAT_ID" ]]; then
    log "  notify  : conditional gateway on results.route.escalate — 🚨 alert / ✅ summary -> chats ${TELEGRAM_CHAT_ID}, ${TELEGRAM_CHAT_ID_2}"
  else
    log "  notify  : conditional gateway on results.route.escalate — 🚨 alert / ✅ summary -> chat ${TELEGRAM_CHAT_ID}"
  fi
  log "  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)"
  echo
  log "Drive it — POST a customer message to THIS instance's own URL:"
  log "    curl -X POST '${ingest_url}' \\"
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "      -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
  else
    log "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
  fi
  log "      -H 'content-type: application/json' \\"
  log "      -d '{\"from\":\"customer-42\",\"text\":\"I want my money back RIGHT NOW, this is the third time my order is broken\"}'"
  log "Or just run ./run.sh, which resolves the token and posts sample customer messages for you."
  log "Then check Telegram — the bot DMs you the triage summary (intent/sentiment/priority + summary)."
}

main "$@"
