#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-call-center-supervisor  (the full mix — capstone tier)
# =============================================================================
#
# An AI supervisor loop that combines a HOSTED SERVICE (mock CRM), an AI AGENT
# (agentCall), CONDITIONAL routing, and TELEGRAM escalation in one workflow:
#
#   HTTP msg ─► trigger (message_received, channels:["http"], pinned to this
#               sample's own instance via accountIds)
#                 │
#                 ▼
#   lookupCustomer     serviceCall  → hosted service 'sample-crm' (echo server)
#                                     POST /crm/customers/lookup — the echoed
#                                     request body stands in for a CRM record
#                 ▼
#   buildTriageInput   jsFunction   → stringifies {customer_message, customer_id,
#                                     crm_record} — needed because {{...}}
#                                     templating String()-coerces objects to
#                                     "[object Object]"
#                 ▼
#   triage             agentCall    → agent 'ai-sample-supervisor' returns
#                                     compact JSON {"escalate":bool,"reason",
#                                     "suggested_reply","priority"}
#                 ▼
#   decide             jsFunction   → safely parses the agent JSON (fallback =
#                                     escalate:true) and builds alertText /
#                                     resolvedText
#                 ▼
#   route              conditional  → first-match exclusive gateway
#                        ├── escalate == "true" → notifyEscalation (channelSend 🚨)
#                        └── default            → notifyResolved   (channelSend ✅)
#
# Idempotent: reuses the service/connector/agent/instance/workflow by name.
# Set RECREATE=1 to delete and rebuild the sample resources.
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - Action shapes  : packages/shared/src/workflow.interfaces.ts
#                      (ServiceCallArgs needs serviceId = registered_services
#                       UUID, never the slug; ConditionalAction takes
#                       branches[{label, condition{variable,comparator,value},
#                       actions}] + default)
#   - Executor       : services/workflow-service/src/temporal/workflows.ts
#                      (case "conditional" — first matching branch wins,
#                       evaluateCondition "eq" does String(left)===String(right)
#                       so a boolean escalate matches value "true";
#                       {{...}} templating String()-coerces each leaf)
#   - Action schema  : services/workflow-service/src/modules/workflows/dto/workflow-action.validator.ts
#                      (isConditional: branches[] with label/condition/actions,
#                       optional default[]; channelSend needs accountId/channel/
#                       provider/to/type)
#   - agentCall      : services/workflow-service/src/temporal/activities/agent-call.activity.ts
#                      (result = { status, data: { reply, tool_calls }, headers }
#                       → the agent's text lives at results.triage.data.reply)
#   - serviceCall    : DOCS/workflows/patterns.md + connector-runtime
#                      (result = { status, data, headers })
#   - Registry API   : services/api-gateway/src/modules/registry/registry.controller.ts
#                      /api/registry/services (+ /:id detail returns knativeStatus)
#   - Readiness      : services/registry-service/src/modules/services/services.service.ts
#                      (get() returns knativeStatus.conditions[]; Ready/True)
#   - Agent CRUD     : services/api-gateway/src/modules/admin/admin-agents.controller.ts
#   - HTTP webhook   : services/api-gateway/src/modules/channels/webhooks.controller.ts
#                      (POST /api/webhooks/http/<tenant>/<externalId>)
# -----------------------------------------------------------------------------
# PREREQS:
#   * A Telegram channel account with a REAL bot token
#       -> sdk/samples/telegram-transform-reply/setup.sh
#     and the supervisor must have /start-ed that bot (chat_id discovery).
#   * An LLM provider key (OPENAI_API_KEY by default) in .env — the triage
#     agent needs a real online LLM.
#   * A cluster with registry-service + Knative (hosted services).
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
WORKFLOW_NAME="${SUPERVISOR_WORKFLOW_NAME:-ai-call-center-supervisor}"
APPLICATION="${SUPERVISOR_APPLICATION:-samples}"

# Hosted mock-CRM service (same knobs/style as ../hosted-services-api)
CRM_SERVICE_NAME="${CRM_SERVICE_NAME:-sample-crm}"
CRM_SERVICE_IMAGE="${CRM_SERVICE_IMAGE:-ealen/echo-server:latest}"
CRM_SERVICE_PORT="${CRM_SERVICE_PORT:-8080}"
CRM_MIN_SCALE="${CRM_MIN_SCALE:-0}"
CRM_MAX_SCALE="${CRM_MAX_SCALE:-2}"
CRM_CONCURRENCY_TARGET="${CRM_CONCURRENCY_TARGET:-25}"
CRM_READY_TIMEOUT_S="${CRM_READY_TIMEOUT_S:-120}"

# AI triage agent (same knobs/style as ../ai-agent-playground)
AGENT_NAME="${AI_AGENT_NAME:-ai-sample-supervisor}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"

# Telegram supervisor chat — auto-discovered from the bot's recent messages
# if left unset (same mechanism as ../http-bridge).
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"
SUPERVISOR_RESTORE_WEBHOOK="${SUPERVISOR_RESTORE_WEBHOOK:-1}"
SUPERVISOR_DISCOVER_WAIT_SECONDS="${SUPERVISOR_DISCOVER_WAIT_SECONDS:-60}"
SUPERVISOR_DISCOVER_POLL_INTERVAL="${SUPERVISOR_DISCOVER_POLL_INTERVAL:-2}"

# Dedicated HTTP channel INSTANCE for this sample (its externalId is the last
# path segment of /api/webhooks/http/<tenant>/<externalId>). The workflow
# trigger is pinned to this account id so ONLY messages posted to this
# instance fire it.
HTTP_EXTERNAL_ID="${SUPERVISOR_HTTP_EXTERNAL_ID:-ai-call-center-supervisor}"
HTTP_ACCOUNT_NAME="${SUPERVISOR_HTTP_ACCOUNT_NAME:-AI Call Center Supervisor}"
SUPERVISOR_PIN="${SUPERVISOR_PIN:-1}"

RECREATE="${RECREATE:-0}"

# ----- Pretty logging ---------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
SERVICE_ID=""
CONNECTOR_ID=""
AGENT_ID=""
HTTP_ACCOUNT_ID=""; HTTP_APP_SECRET=""
WORKFLOW_ID=""

# buildTriageInput: {{...}} templating String()-coerces each leaf, so passing
# {{results.lookupCustomer.data}} into the agent message would yield
# "[object Object]". This step stringifies the whole triage payload instead;
# the agent message then references {{results.buildTriageInput.text}}.
read -r -d '' TRIAGE_INPUT_CODE <<'JS' || true
(ctx) => {
  var req = ctx.request || {};
  var lookup = ctx.results.lookupCustomer || {};
  var payload = {
    customer_message: req.text || "",
    customer_id: req.from || "unknown",
    crm_record: lookup.data || {}
  };
  return { text: JSON.stringify(payload) };
}
JS

# decide: safely parses the agent's JSON verdict. Any parse failure falls back
# to escalate:true (fail-safe: a broken triage always reaches a human). Builds
# both notification texts; the conditional router picks which one is sent.
read -r -d '' DECIDE_CODE <<'JS' || true
(ctx) => {
  var req = ctx.request || {};
  var triage = ctx.results.triage || {};
  var raw = (triage.data && triage.data.reply) || "";
  var verdict = {
    escalate: true,
    reason: "agent reply was not parseable JSON",
    suggested_reply: "",
    priority: "high"
  };
  try {
    var text = String(raw).trim();
    var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) text = fenced[1].trim();
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    var parsed = JSON.parse(text);
    if (typeof parsed.escalate === "boolean") {
      verdict = {
        escalate: parsed.escalate,
        reason: String(parsed.reason || ""),
        suggested_reply: String(parsed.suggested_reply || ""),
        priority: String(parsed.priority || "normal")
      };
    }
  } catch (e) {
    /* keep fail-safe fallback: escalate */
  }
  var who = req.from || "unknown";
  var msg = req.text || "";
  var alertText =
    "🚨 SUPERVISOR ESCALATION\n" +
    "Customer: " + who + "\n" +
    "Message: " + msg + "\n" +
    "Priority: " + verdict.priority + "\n" +
    "Reason: " + verdict.reason + "\n" +
    "Suggested reply: " + (verdict.suggested_reply || "(none)");
  var resolvedText =
    "✅ AUTO-RESOLVED\n" +
    "Customer: " + who + "\n" +
    "Message: " + msg + "\n" +
    "Reason: " + verdict.reason + "\n" +
    "Suggested reply: " + (verdict.suggested_reply || "(none)");
  return {
    escalate: verdict.escalate,
    priority: verdict.priority,
    reason: verdict.reason,
    alertText: alertText,
    resolvedText: resolvedText
  };
}
JS

# api <method> <path> [json-body] — authenticated, tenant-scoped JSON call.
# Content-Type is only set when there's a body: Fastify's JSON body parser
# 400s on "Body cannot be empty when content-type is set to
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

# ----- Stage 0: preflight ------------------------------------------------------
stage_preflight() {
  step "0/7 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -n "$TRIAGE_INPUT_CODE" ]] || { err "TRIAGE_INPUT_CODE failed to load"; exit 1; }
  [[ -n "$DECIDE_CODE" ]] || { err "DECIDE_CODE failed to load"; exit 1; }
  [[ "$CRM_SERVICE_NAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || {
    err "CRM_SERVICE_NAME must be lowercase alphanumeric with optional hyphens"; exit 1; }

  case "${CREDENTIAL_MODE}" in
    connector|env) ;;
    *) err "AI_CREDENTIAL_MODE must be 'connector' or 'env'"; exit 1 ;;
  esac
  if [[ "$CREDENTIAL_MODE" == "connector" ]]; then
    local key_var key_value
    key_var="$(provider_api_key_var "$AGENT_PROVIDER")"
    key_value="$(read_env_value "$key_var")"
    [[ -n "$key_var" ]] || { err "Unsupported provider '${AGENT_PROVIDER}'"; exit 1; }
    if [[ -z "$key_value" && "$AGENT_PROVIDER" != "ollama" ]]; then
      err "${key_var} is required for AI_CREDENTIAL_MODE=connector. Put it in .env next to setup.sh."
      exit 1
    fi
    if [[ -n "$key_value" ]] && is_placeholder_secret "$key_value"; then
      err "${key_var} looks like a placeholder. Replace it with a real provider key."
      exit 1
    fi
  else
    warn "credential mode=env: agent-ai-service must already have the provider key in its deployment env."
  fi

  log "crm=${CRM_SERVICE_NAME} (${CRM_SERVICE_IMAGE}:${CRM_SERVICE_PORT})  agent=${AGENT_NAME} (${AGENT_PROVIDER}/${AGENT_MODEL})  workflow=${WORKFLOW_NAME}  recreate=${RECREATE}"
}

# ----- Stage 1: login -----------------------------------------------------------
stage_login() {
  step "1/7 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

# ----- Stage 2: ensure hosted mock-CRM service ----------------------------------
find_service_id() {
  api GET /api/registry/services \
    | jq -r --arg n "$CRM_SERVICE_NAME" 'if type=="array" then ([.[] | select(.name==$n)] | .[0].id // empty) else empty end'
}

crm_service_body() {
  jq -n \
    --arg name "$CRM_SERVICE_NAME" \
    --arg image "$CRM_SERVICE_IMAGE" \
    --argjson port "$CRM_SERVICE_PORT" \
    --argjson minScale "$CRM_MIN_SCALE" \
    --argjson maxScale "$CRM_MAX_SCALE" \
    --argjson concurrencyTarget "$CRM_CONCURRENCY_TARGET" \
    '{ name: $name, image: $image, port: $port, minScale: $minScale,
       maxScale: $maxScale, concurrencyTarget: $concurrencyTarget,
       envVars: { YOIZEN_SAMPLE: "ai-call-center-supervisor" } }'
}

wait_for_crm_ready() {
  # GET /api/registry/services/:id returns knativeStatus.conditions[] — wait
  # for Ready/True (services/registry-service/.../services.service.ts get()).
  # Non-fatal on timeout: with minScale=0 the first serviceCall cold-starts
  # the pod anyway; a warning is enough.
  local deadline ready
  deadline=$(( $(date +%s) + CRM_READY_TIMEOUT_S ))
  log "waiting up to ${CRM_READY_TIMEOUT_S}s for Knative readiness of '${CRM_SERVICE_NAME}'..."
  while true; do
    ready="$(api GET "/api/registry/services/${SERVICE_ID}" \
      | jq -r '[.knativeStatus.conditions[]? | select(.type=="Ready") | .status] | .[0] // empty')"
    if [[ "$ready" == "True" ]]; then
      log "hosted service is Ready"
      return 0
    fi
    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      warn "service not Ready after ${CRM_READY_TIMEOUT_S}s (last Ready=${ready:-unknown}) — continuing; the first serviceCall may cold-start it"
      return 0
    fi
    sleep 3
  done
}

stage_ensure_crm() {
  step "2/7 ensure hosted mock-CRM service '${CRM_SERVICE_NAME}'"
  SERVICE_ID="$(find_service_id)"

  if [[ -n "$SERVICE_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting service ${SERVICE_ID}"
    api DELETE "/api/registry/services/${SERVICE_ID}" >/dev/null || true
    SERVICE_ID=""
  fi

  local body resp
  body="$(crm_service_body)"
  echo "$body" | jq empty >/dev/null

  if [[ -n "$SERVICE_ID" ]]; then
    resp="$(api PATCH "/api/registry/services/${SERVICE_ID}" "$(echo "$body" | jq 'del(.name)')")"
    [[ "$(echo "$resp" | jq -r '.id // empty')" == "$SERVICE_ID" ]] || {
      err "CRM service update failed: ${resp}"; exit 1; }
    log "updated existing service ${SERVICE_ID}"
  else
    resp="$(api POST /api/registry/services "$body")"
    SERVICE_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$SERVICE_ID" ]] || { err "CRM service creation failed: ${resp}"; exit 1; }
    log "created service ${SERVICE_ID}"
  fi

  wait_for_crm_ready
}

# ----- Stage 3: ensure LLM connector --------------------------------------------
resolve_connector_id_by_name() {
  api GET "/api/connectors?context=external" \
    | jq -r --arg n "$1" 'if type=="array" then (.[] | select(.name==$n) | .id) else empty end' \
    | head -1
}

stage_ensure_llm_connector() {
  if [[ "$CREDENTIAL_MODE" != "connector" ]]; then
    step "3/7 skip LLM connector (AI_CREDENTIAL_MODE=env)"
    return 0
  fi
  step "3/7 ensure LLM connector '${LLM_CONNECTOR_NAME}'"

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

# ----- Stage 4: ensure + publish the triage agent -------------------------------
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

  jq -n \
    --arg name "$AGENT_NAME" \
    --arg provider "$AGENT_PROVIDER" \
    --arg model "$AGENT_MODEL" \
    --argjson connectorId "$connector_json" \
    '{
      name: $name,
      description: "AI call-center supervisor triage agent created by sdk/samples/ai-call-center-supervisor",
      system_prompt: "You are an AI call-center supervisor triage assistant. Each user message is a JSON payload with fields customer_message, customer_id, and crm_record. Analyze it and respond with ONLY a compact single-line JSON object — no markdown, no code fences, no commentary: {\"escalate\": true|false, \"reason\": \"short explanation\", \"suggested_reply\": \"reply the agent could send the customer\", \"priority\": \"low|normal|high|urgent\"}. Set escalate to true when ANY of these hold: the sentiment is very negative or abusive; a refund greater than $100 is mentioned or demanded; legal action is threatened; or the customer threatens to cancel or shows clear churn risk. Otherwise set escalate to false and provide a helpful suggested_reply.",
      model_config: {
        llm: {
          provider: $provider,
          model: $model,
          connectorId: $connectorId,
          temperature: 0.1,
          maxTokens: 300
        },
        rules: "Output strictly the JSON object described in the system prompt. Never add any text before or after it.",
        soul: "Calm, precise, risk-aware.",
        subagents: []
      },
      tools: [],
      channels: []
    }'
}

stage_ensure_agent() {
  step "4/7 ensure + publish agent '${AGENT_NAME}'"
  local existing_id resp body
  existing_id="$(resolve_agent_id_by_name "$AGENT_NAME")"

  if [[ -n "$existing_id" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting existing agent ${existing_id}"
    api DELETE "/api/admin/agents/${existing_id}" >/dev/null 2>&1 || true
    existing_id=""
  fi

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

# ----- Stage 5: resolve telegram account + supervisor chat ----------------------
# fetch_telegram_chats <bot_token> — one getUpdates call, one row per distinct
# chat as "<chat_id>\t<label>", most recent first (same as ../http-bridge).
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

# discover_chat_id <bot_token> — auto-fill TELEGRAM_CHAT_ID from whoever
# /start-ed the bot most recently. getUpdates and an active webhook are
# mutually exclusive on the same bot token (Telegram 409s), so the current
# webhook is captured, cleared, and restored afterward — and updates already
# consumed by the webhook do NOT replay, hence the interactive prompt.
# See ../http-bridge/setup.sh for the full rationale.
discover_chat_id() {
  local bot_token="$1"
  [[ -z "$TELEGRAM_CHAT_ID" ]] || return 0
  if [[ -z "$bot_token" || "$bot_token" == PLACEHOLDER:* ]]; then
    warn "telegram account has no real bot token — cannot auto-discover chat_id"
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
    warn "the webhook was already delivering — any /start sent BEFORE this point is gone and will NOT be found"
    log "send /start (or any message) to the bot NOW, after this line printed"
    if [[ -t 0 ]]; then
      read -r -t "$SUPERVISOR_DISCOVER_WAIT_SECONDS" \
        -p "  press Enter once you have sent it (auto-continues after ${SUPERVISOR_DISCOVER_WAIT_SECONDS}s)... " _ || true
    else
      log "non-interactive shell — waiting ${SUPERVISOR_DISCOVER_WAIT_SECONDS}s instead of prompting"
      sleep "$SUPERVISOR_DISCOVER_WAIT_SECONDS"
    fi
    local attempt
    for attempt in 1 2 3 4 5; do
      chats="$(fetch_telegram_chats "$bot_token")"
      [[ -n "$chats" ]] && break
      sleep "$SUPERVISOR_DISCOVER_POLL_INTERVAL"
    done
  else
    chats="$(fetch_telegram_chats "$bot_token")"
  fi

  if [[ -z "$chats" ]]; then
    warn "no Telegram chats found — send /start to the bot, then re-run (or set TELEGRAM_CHAT_ID)"
  else
    log "discovered telegram chats (most recent first):"
    while IFS=$'\t' read -r cid label; do log "  chat_id=${cid}  (${label})"; done <<<"$chats"
    TELEGRAM_CHAT_ID="$(head -1 <<<"$chats" | cut -f1)"
    log "auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)"
  fi

  if [[ -n "$webhook_url" ]]; then
    if [[ "$SUPERVISOR_RESTORE_WEBHOOK" == "1" ]]; then
      log "restoring webhook -> ${webhook_url}"
      curl -s "https://api.telegram.org/bot${bot_token}/setWebhook" \
        --data-urlencode "url=${webhook_url}" >/dev/null
    else
      warn "SUPERVISOR_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh to restore it"
    fi
  fi
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

stage_resolve() {
  step "5/7 resolve telegram account + supervisor chat + http instance"

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
  discover_chat_id "$tg_bot_token"

  if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    err "TELEGRAM_CHAT_ID is required and could not be auto-discovered."
    err "DM your bot first, then re-run — or set TELEGRAM_CHAT_ID manually."
    exit 1
  fi
  log "supervisor chat_id=${TELEGRAM_CHAT_ID}"

  ensure_http_account
}

# ----- Stage 6: ensure the workflow ---------------------------------------------
build_workflow_body() {
  jq -n \
    --arg name "$WORKFLOW_NAME" \
    --arg app "$APPLICATION" \
    --arg serviceId "$SERVICE_ID" \
    --arg serviceSlug "$CRM_SERVICE_NAME" \
    --arg agentId "$AGENT_ID" \
    --arg tgAccount "$TG_ACCOUNT_ID" \
    --arg httpAccount "$HTTP_ACCOUNT_ID" \
    --arg pin "$SUPERVISOR_PIN" \
    --arg chatId "$TELEGRAM_CHAT_ID" \
    --arg triageInputCode "$TRIAGE_INPUT_CODE" \
    --arg decideCode "$DECIDE_CODE" \
    '
    {
      accountId: $tgAccount,
      channel: "telegram",
      provider: "telegram",
      to: $chatId,
      type: "text"
    } as $sendBase |
    {
      name: $name,
      application: $app,
      actions: [
        {
          name: "lookupCustomer",
          activity: "serviceCall",
          args: {
            serviceId: $serviceId,
            serviceSlug: $serviceSlug,
            method: "POST",
            path: "/crm/customers/lookup",
            data: {
              customerId: "{{request.from}}",
              message: "{{request.text}}",
              source: "ai-call-center-supervisor"
            }
          }
        },
        {
          name: "buildTriageInput",
          activity: "jsFunction",
          args: { code: $triageInputCode }
        },
        {
          name: "triage",
          activity: "agentCall",
          args: {
            agentId: $agentId,
            message: "{{results.buildTriageInput.text}}",
            conversationId: "ai-call-center-supervisor",
            channel: "http",
            userId: "{{request.from}}"
          }
        },
        {
          name: "decide",
          activity: "jsFunction",
          args: { code: $decideCode }
        },
        {
          name: "route",
          activity: "conditional",
          branches: [
            {
              label: "Escalate to supervisor",
              condition: {
                variable: "results.decide.escalate",
                comparator: "eq",
                value: "true"
              },
              actions: [
                {
                  name: "notifyEscalation",
                  activity: "channelSend",
                  args: ($sendBase + { text: "{{results.decide.alertText}}" })
                }
              ]
            }
          ],
          default: [
            {
              name: "notifyResolved",
              activity: "channelSend",
              args: ($sendBase + { text: "{{results.decide.resolvedText}}" })
            }
          ]
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
  step "6/7 ensure workflow '${WORKFLOW_NAME}'"

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
    resp="$(api PUT "/api/workflows/${WORKFLOW_ID}" "$body")"
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

# ----- Stage 7: summary ----------------------------------------------------------
stage_summary() {
  step "7/7 summary"
  local ingest_url="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"
  log "crm service : ${SERVICE_ID} (${CRM_SERVICE_NAME})"
  log "agent       : ${AGENT_ID} (${AGENT_NAME}, ${AGENT_PROVIDER}/${AGENT_MODEL})"
  log "workflow    : ${WORKFLOW_ID} (${WORKFLOW_NAME})"
  log "http input  : ${ingest_url}"
  log "telegram    : supervisor chat ${TELEGRAM_CHAT_ID}"
  echo
  log "Drive it (or just run ./run.sh, which posts both test messages for you):"
  log "  curl -X POST '${ingest_url}' \\"
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "    -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
  else
    log "    -H 'x-http-channel-token: <app-secret>' \\   # re-run with RECREATE=1 to mint one"
  fi
  log "    -H 'content-type: application/json' \\"
  log "    -d '{\"from\":\"cust-1001\",\"text\":\"third time my bill is wrong, I want a \$200 refund or I cancel\"}'"
  log "Then check Telegram: angry messages arrive as a 🚨 SUPERVISOR ESCALATION,"
  log "calm ones as a ✅ AUTO-RESOLVED summary."
}

main() {
  stage_preflight
  stage_login
  stage_ensure_crm
  stage_ensure_llm_connector
  stage_ensure_agent
  stage_resolve
  stage_ensure_workflow
  stage_summary
}

main "$@"
