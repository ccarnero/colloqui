#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-system-variables  (System Variables as live configuration)
# =============================================================================
#
# One workflow, three verified resolution points for admin-console
# AI > System Variables — a brand-stamped escalation router where the BRAND
# and the ROUTING POLICY live in the tenant's variable store, not in the
# workflow or the agent:
#
#   * companyName        -> stamped into the Telegram notification text of a
#                           channelSend (action-arg templating)
#   * escalationPriority -> the TEMPLATED RIGHT-HAND SIDE of a conditional
#                           rule (condition.value:
#                           "{{variables.system.escalationPriority}}") — PATCH
#                           the variable and the workflow re-routes with no
#                           workflow edit (subject to a 5-min cache)
#   * brandVoice         -> referenced INSIDE the agent's system_prompt as
#                           {{variables.system.brandVoice}}, resolved by
#                           agent-ai-service's template renderer when the
#                           agent runs via the workflow agentCall
#
#   HTTP msg ─► trigger(message_received, channels:["http"], pinned to this
#               sample's own instance via accountIds)
#                 │
#                 ▼
#               triage  agentCall — message: {{request.text}}; the published
#                       'ai-sample-sysvars' agent (system_prompt embeds
#                       {{variables.system.brandVoice}} +
#                       {{variables.system.companyName}}) replies with strict
#                       JSON {"priority","summary"};
#                       result lands at results.triage.data.reply
#                 ▼
#               parse   jsFunction — JSON.parse with code-fence stripping and
#                       fail-safe fallback (unparseable -> priority "high");
#                       returns { priority, summary } ONLY. Parse-only: the
#                       routing decision belongs to the gateway below.
#                 ▼
#               notify  conditional — exclusive gateway whose RIGHT-HAND SIDE
#                       is a system variable:
#                         { variable: "results.parse.priority",
#                           comparator: "eq",
#                           value: "{{variables.system.escalationPriority}}" }
#                         match   ─► 🚨 channelSend telegram
#                                    "🚨 [{{variables.system.companyName}}] escalation — …"
#                         default ─► ✅ channelSend telegram
#                                    "✅ [{{variables.system.companyName}}] handled — …"
#
# Idempotent (safe to re-run): system variables are upserted by name
# (existing VALUES are preserved unless SYSVARS_RESET=1, so a live policy
# flip survives a re-run); connector + agent are upserted in place; the HTTP
# instance + workflow are rebuilt when RECREATE=1 (the default).
#
# -----------------------------------------------------------------------------
# Contract sources (verified in code, paths relative to repo root):
#   - SysVars API   : services/api-gateway/src/modules/admin/admin-system-variables.controller.ts
#                     (GET/POST /api/admin/system-variables, PATCH/DELETE /:id
#                      — thin proxy to agent-admin-service)
#   - SysVars DTO   : services/agent-admin-service/src/modules/system-variables/system-variables.dto.ts
#                     (CreateSystemVariableDto: name, type in
#                      [string,number,boolean,json,array,secret], value,
#                      label?, description?)
#   - SysVars shape : services/agent-admin-service/src/modules/system-variables/system-variables.service.ts
#                     (findAll -> { variables: [...], total }; create/update
#                      return the row { id, name, type, value, label,
#                      description, created_at, updated_at }; only
#                      is_active=true rows are listed/loaded)
#   - Runtime load  : services/workflow-service/src/modules/workflows/workflows.service.ts:322-337
#                     + system-variables.provider.ts:30-52 (per-tenant load,
#                      5-min TTL cache) -> context.variables.system
#                      (temporal/workflows.ts:370-390)
#   - Templating    : services/workflow-service/src/temporal/workflows.ts
#                     (resolveTemplates over all action args; conditional
#                      condition.value is ALSO template-resolved at
#                      workflows.ts:343-346; interface comment
#                      packages/shared/src/workflow.interfaces.ts:229)
#   - Agent prompt  : services/agent-ai-service/src/modules/template-renderer/template-renderer.service.ts
#                     ("variables" is a whitelisted prompt namespace; agentCall
#                      forwards context.variables, so
#                      {{variables.system.X}} resolves in system_prompt)
#   - Agent CRUD    : services/api-gateway/src/modules/admin/admin-agents.controller.ts
#   - HTTP webhook  : services/api-gateway/src/modules/channels/webhooks.controller.ts
#                     (POST /api/webhooks/http/<tenant>/<externalId>)
# -----------------------------------------------------------------------------
# PREREQS (provision these first — this script wires variables + connector +
# agent + HTTP instance + workflow):
#   * A Telegram channel account with a REAL bot token
#       -> sdk/samples/telegram-transform-reply/setup.sh
#   * You must have /start-ed that bot (TELEGRAM_CHAT_ID is auto-discovered
#     from the bot's recent messages ONLY when left unset).
#   * An LLM API key (e.g. OPENAI_API_KEY) in .env — the agent needs a real
#     online LLM. http-connectors is NOT needed here.
# =============================================================================

# ----- Configuration (override via env) --------------------------------------
# YOIZEN_BASE_URL, YOIZEN_HOST_HEADER, YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD
# are all exported by resolve-env.sh above. Only script-specific vars live here.

WORKFLOW_NAME="${SYSVARS_WORKFLOW_NAME:-ai-system-variables}"
APPLICATION="${SYSVARS_APPLICATION:-samples}"

# --- The three system variables this sample demonstrates ----------------------
# Values used only when the variable does not exist yet (or SYSVARS_RESET=1):
# an existing variable's value is preserved so a live PATCH survives re-runs.
SYSVARS_COMPANY_NAME="${SYSVARS_COMPANY_NAME:-Acme Telco}"
SYSVARS_ESCALATION_PRIORITY="${SYSVARS_ESCALATION_PRIORITY:-high}"
SYSVARS_BRAND_VOICE="${SYSVARS_BRAND_VOICE:-warm and upbeat, always thanking the customer}"
SYSVARS_RESET="${SYSVARS_RESET:-0}"

# --- AI agent + LLM connector (same knobs as ai-agent-triage) -----------------
AGENT_NAME="${AI_AGENT_NAME:-ai-sample-sysvars}"
AGENT_DESCRIPTION="${AI_AGENT_DESCRIPTION:-Brand-voiced priority classifier created by sdk/samples/ai-system-variables}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"

# --- Telegram recipient --------------------------------------------------------
# Single chat. Auto-discovered ONLY when TELEGRAM_CHAT_ID is unset (setup
# fetches the bot's own token from the platform and calls Telegram's
# getUpdates). TG_ACCOUNT_ID pins a specific Telegram channel account;
# otherwise the first active one is used.
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TG_ACCOUNT_ID="${TG_ACCOUNT_ID:-}"

# Dedicated HTTP channel INSTANCE for this sample. The externalId is the last
# path segment of the per-instance ingress URL
# (/api/webhooks/http/<tenant>/<externalId>), and the workflow trigger is
# pinned to this account's id (accountIds) so ONLY messages to this instance
# fire it — no cross-firing with other http workflows.
HTTP_EXTERNAL_ID="${SYSVARS_HTTP_EXTERNAL_ID:-ai-system-variables}"
HTTP_ACCOUNT_NAME="${SYSVARS_HTTP_ACCOUNT_NAME:-AI System Variables}"

# Pin the trigger to the dedicated http instance via accountIds. ON by
# default; set SYSVARS_PIN=0 to let ANY http message trigger the workflow.
SYSVARS_PIN="${SYSVARS_PIN:-1}"

# Defaults to always rebuild the HTTP instance + workflow: the workflow body
# embeds the agent id and chat id resolved on THIS run, so reuse-by-name
# would mask changes. Variables + connector + agent are upserted in place
# regardless. Set RECREATE=0 to reuse the existing instance/workflow by name.
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
ESCALATION_VAR_ID=""

# System prompt for the classifier agent. THIS IS THE POINT: the prompt
# itself references {{variables.system.brandVoice}} and
# {{variables.system.companyName}} — agent-ai-service's template renderer
# ("variables" is a whitelisted prompt namespace) resolves them when the
# agent is invoked via the workflow agentCall, because the agentCall
# activity forwards the execution context's variables (which include the
# tenant's system variables loaded at workflow start).
read -r -d '' SYSVARS_SYSTEM_PROMPT <<'PROMPT' || true
You are a customer-message priority classifier for {{variables.system.companyName}}. Your writing style is: {{variables.system.brandVoice}}.
For every customer message you receive, reply ONLY with a compact single-line JSON object and nothing else — no prose, no markdown, no code fences. The object must have exactly these keys:
{"priority": "low|normal|high|urgent", "summary": "<one short sentence, written in the brand voice above, summarizing the customer's message>"}
Rules: priority MUST be one of the listed values. Angry, threatening, or repeated-failure messages are at least high priority. Calm questions and thanks are low or normal. If the message is empty or meaningless, use priority "low".
PROMPT

# The parse step. Safely parses the agent's JSON reply from
# results.triage.data.reply (agentCall returns { status, data: { reply,
# tool_calls } }), stripping markdown code fences if the LLM adds them, and
# falling back to priority "high" (fail-safe) when parsing fails.
# Parse-only: it returns { priority, summary } and NOTHING else — the actual
# routing decision is taken by the downstream `notify` conditional gateway,
# whose right-hand side is {{variables.system.escalationPriority}}. Putting
# the comparison here would bake the policy into code; keeping it in the
# gateway keeps the policy in the variable store.
read -r -d '' PARSE_CODE <<'JS' || true
(ctx) => {
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
      priority: "high", // fail safe: an unparseable classification escalates
      summary: raw ? ("unparseable agent reply: " + raw.slice(0, 160)) : "agent returned no reply"
    };
  }

  return {
    priority: parsed.priority || "normal",
    summary: parsed.summary || "(no summary)"
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

# ----- LLM provider helpers (same contract as ai-agent-triage) ----------------
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
  step "0/6 preflight"
  command -v jq   >/dev/null || { err "jq is required";   exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -n "$SYSVARS_SYSTEM_PROMPT" ]] || { err "SYSVARS_SYSTEM_PROMPT failed to load"; exit 1; }
  [[ -n "$PARSE_CODE" ]] || { err "PARSE_CODE failed to load"; exit 1; }

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
  log "system variables: companyName='${SYSVARS_COMPANY_NAME}'  escalationPriority='${SYSVARS_ESCALATION_PRIORITY}'  brandVoice='${SYSVARS_BRAND_VOICE}'  reset=${SYSVARS_RESET}"
  if [[ -n "$TELEGRAM_CHAT_ID" ]]; then
    log "telegram chat_id preset: ${TELEGRAM_CHAT_ID} (discovery skipped)"
  else
    log "TELEGRAM_CHAT_ID not set — will auto-discover from the bot's recent /start messages"
  fi
}

# ----- Stage 1: login --------------------------------------------------------
stage_login() {
  step "1/6 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

# ----- Stage 2: ensure the three system variables -----------------------------
# API contract (verified in code):
#   GET  /api/admin/system-variables         -> { variables: [ {id, name, type,
#        value, label, description, created_at, updated_at} ], total }
#        (only is_active=true rows — the runtime loads exactly the same set)
#   POST /api/admin/system-variables         -> created row (same shape)
#        body: { name, type, value, label?, description? }
#   PATCH /api/admin/system-variables/:id    -> updated row (same shape)
# `value` is stored as jsonb: a string variable round-trips as a JSON string.
# Names are unique per tenant, so upsert-by-name is safe.
#
# Existing variables keep their CURRENT value (so a live policy flip via
# PATCH survives a setup re-run) unless SYSVARS_RESET=1.
ensure_system_variable() {
  local name="$1" value="$2" label="$3" description="$4"
  local existing existing_id existing_value body resp

  existing="$(api GET "/api/admin/system-variables?limit=100" \
    | jq -c --arg n "$name" '(.variables // []) | map(select(.name==$n)) | .[0] // empty')"

  if [[ -n "$existing" ]]; then
    existing_id="$(echo "$existing" | jq -r '.id')"
    existing_value="$(echo "$existing" | jq -r '.value | tostring')"
    if [[ "$SYSVARS_RESET" == "1" && "$existing_value" != "$value" ]]; then
      body="$(jq -n --arg v "$value" '{value: $v}')"
      resp="$(api PATCH "/api/admin/system-variables/${existing_id}" "$body")"
      [[ "$(echo "$resp" | jq -r '.id // empty')" == "$existing_id" ]] \
        || { err "system variable '${name}' PATCH failed: ${resp}"; exit 1; }
      log "reset variable ${name} (id=${existing_id}) '${existing_value}' -> '${value}'"
    else
      log "keeping variable ${name} (id=${existing_id}) value='${existing_value}' (SYSVARS_RESET=1 to overwrite)"
    fi
    if [[ "$name" == "escalationPriority" ]]; then ESCALATION_VAR_ID="$existing_id"; fi
    return 0
  fi

  body="$(jq -n --arg n "$name" --arg v "$value" --arg l "$label" --arg d "$description" \
    '{name: $n, type: "string", value: $v, label: $l, description: $d}')"
  resp="$(api POST /api/admin/system-variables "$body")"
  existing_id="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$existing_id" ]] || { err "system variable '${name}' creation failed: ${resp}"; exit 1; }
  log "created variable ${name} (id=${existing_id}) value='${value}'"
  # if-form, not `[[ ]] &&`: a false guard as the function's last command
  # would return non-zero and kill the script under `set -e`
  if [[ "$name" == "escalationPriority" ]]; then ESCALATION_VAR_ID="$existing_id"; fi
}

stage_ensure_system_variables() {
  step "2/6 ensure system variables (companyName, escalationPriority, brandVoice)"
  ensure_system_variable "companyName" "$SYSVARS_COMPANY_NAME" \
    "Company name" "Brand name stamped into workflow notifications (sdk/samples/ai-system-variables)"
  ensure_system_variable "escalationPriority" "$SYSVARS_ESCALATION_PRIORITY" \
    "Escalation priority" "Priority level that routes to the escalation arm — PATCH this to re-route the workflow live (sdk/samples/ai-system-variables)"
  ensure_system_variable "brandVoice" "$SYSVARS_BRAND_VOICE" \
    "Brand voice" "Writing style injected into the classifier agent's system prompt (sdk/samples/ai-system-variables)"
}

# ----- Stage 3: ensure LLM connector -------------------------------------------
resolve_connector_id_by_name() {
  api GET "/api/connectors?context=external" \
    | jq -r --arg n "$1" 'if type=="array" then (.[] | select(.name==$n) | .id) else empty end' \
    | head -1
}

stage_ensure_llm_connector() {
  [[ "$CREDENTIAL_MODE" == "connector" ]] || { step "3/6 skip LLM connector (credential mode=env)"; return 0; }
  step "3/6 ensure LLM connector '${LLM_CONNECTOR_NAME}'"

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

# ----- Stage 4: upsert + publish the classifier agent --------------------------
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
  # deterministic JSON classification. The system_prompt keeps its raw
  # {{variables.system.*}} placeholders — they are stored verbatim and only
  # resolved at execution time by agent-ai-service's template renderer.
  jq -n \
    --arg name "$AGENT_NAME" \
    --arg description "$AGENT_DESCRIPTION" \
    --arg provider "$AGENT_PROVIDER" \
    --arg model "$AGENT_MODEL" \
    --arg prompt "$SYSVARS_SYSTEM_PROMPT" \
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
  step "4/6 upsert + publish agent '${AGENT_NAME}'"
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

# ----- Telegram chat discovery (same contract as ai-agent-triage) --------------
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

# discover_chat_id <bot_token> — polls Telegram's getUpdates with the bot's
# OWN token (fetched from the platform) to auto-fill TELEGRAM_CHAT_ID ONLY
# when it is unset. getUpdates and an active webhook are mutually exclusive
# on the same token, so the current webhook (registered by
# telegram-transform-reply) is captured, cleared, and restored afterward
# (SYSVARS_RESTORE_WEBHOOK=0 skips the restore). Updates already pushed
# through the webhook are consumed and never replay — send /start only AFTER
# the prompt below prints.
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
    local wait_seconds="${SYSVARS_DISCOVER_WAIT_SECONDS:-60}" \
          poll_interval="${SYSVARS_DISCOVER_POLL_INTERVAL:-2}"
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
    TELEGRAM_CHAT_ID="$(head -1 <<<"$chats" | cut -f1)"
    log "auto-selected TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID} (most recent chat)"
  fi

  if [[ -n "$webhook_url" ]]; then
    if [[ "${SYSVARS_RESTORE_WEBHOOK:-1}" == "1" ]]; then
      log "restoring webhook -> ${webhook_url}"
      curl -s "https://api.telegram.org/bot${bot_token}/setWebhook" \
        --data-urlencode "url=${webhook_url}" >/dev/null
    else
      warn "SYSVARS_RESTORE_WEBHOOK=0 — webhook left cleared; re-run telegram-transform-reply's setup.sh or set it again manually when done polling"
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

# ----- Stage 5: resolve dependency ids (telegram account + http instance) ------
stage_resolve() {
  step "5/6 resolve telegram account + http instance"

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
  log "telegram chat_id=${TELEGRAM_CHAT_ID}"

  ensure_http_account
}

# build_workflow_body — assemble the workflow definition with resolved ids.
#
# Note where {{variables.system.*}} appears and where it does NOT:
#   * channelSend.args.text embeds {{variables.system.companyName}} — resolved
#     by workflow-service's resolveTemplates at execution time.
#   * notify's condition.value IS "{{variables.system.escalationPriority}}" —
#     the conditional's right-hand side is template-resolved too
#     (temporal/workflows.ts:343-346), so the routing policy lives in the
#     variable store.
#   * The agent prompt's {{variables.system.brandVoice}} does NOT appear here
#     at all — it lives inside the published agent's system_prompt and is
#     resolved by agent-ai-service. agentCall forwards context.variables
#     (overwriting any args.variables in the definition), which is exactly
#     how the system variables reach the agent's renderer.
notify_send_for() {
  local prefix="$1" text_tpl="$2"
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
}

build_workflow_body() {
  local notify_action alert_text normal_text

  alert_text='🚨 [{{variables.system.companyName}}] escalation — priority: {{results.parse.priority}}
{{results.parse.summary}}
Original: {{request.text}}'
  normal_text='✅ [{{variables.system.companyName}}] handled — priority: {{results.parse.priority}}
{{results.parse.summary}}
Original: {{request.text}}'

  # Exclusive gateway (ConditionalAction, workflow.interfaces.ts): branches
  # are evaluated top-to-bottom, first match wins, `default` runs when none
  # match. The LEFT side (condition.variable) is a raw dot-path into the
  # context; the RIGHT side (condition.value) is template-resolved before the
  # comparison — here it resolves to the CURRENT value of the
  # escalationPriority system variable (String()-compared, comparator eq).
  notify_action="$(jq -n \
    --argjson alertActions "$(notify_send_for alert "$alert_text")" \
    --argjson normalActions "$(notify_send_for resolve "$normal_text")" \
    '{
      name: "notify",
      activity: "conditional",
      branches: [
        {
          label: "Escalate",
          condition: {
            variable: "results.parse.priority",
            comparator: "eq",
            value: "{{variables.system.escalationPriority}}"
          },
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
    --arg pin "$SYSVARS_PIN" \
    --arg parseCode "$PARSE_CODE" \
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
            conversationId: "ai-system-variables",
            userId: "{{request.from}}",
            channel: "http"
          }
        },
        {
          name: "parse",
          activity: "jsFunction",
          args: { code: $parseCode }
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

# ----- Stage 6: ensure the workflow --------------------------------------------
stage_ensure_workflow() {
  step "6/6 ensure workflow '${WORKFLOW_NAME}'"

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
  stage_ensure_system_variables
  stage_ensure_llm_connector
  stage_upsert_agent
  stage_resolve
  stage_ensure_workflow

  local ingest_url="${YOIZEN_BASE_URL}/api/webhooks/http/${YOIZEN_TENANT}/${HTTP_EXTERNAL_ID}"

  echo
  log "Done. Workflow '${WORKFLOW_NAME}' (${WORKFLOW_ID}):"
  log "  trigger : message_received on channels=[http], pinned to accountIds=[${HTTP_ACCOUNT_ID}]"
  log "  triage  : agentCall -> agent '${AGENT_NAME}' (${AGENT_ID}) — its system_prompt resolves {{variables.system.brandVoice}} + {{variables.system.companyName}} at run time"
  log "  parse   : jsFunction parses results.triage.data.reply (fail-safe -> high), returns { priority, summary }"
  log "  notify  : conditional — results.parse.priority eq {{variables.system.escalationPriority}} — 🚨 escalation / ✅ handled -> chat ${TELEGRAM_CHAT_ID}"
  log "  inbound : dedicated HTTP instance '${HTTP_EXTERNAL_ID}' (only its messages fire this workflow)"
  echo
  log "The routing policy is DATA, not workflow: flip it live with"
  if [[ -n "$ESCALATION_VAR_ID" ]]; then
    log "    curl -X PATCH '${YOIZEN_BASE_URL}/api/admin/system-variables/${ESCALATION_VAR_ID}' \\"
  else
    log "    curl -X PATCH '${YOIZEN_BASE_URL}/api/admin/system-variables/<id>' \\"
  fi
  log "      -H 'Host: ${YOIZEN_HOST_HEADER}' -H 'x-yoizen-tenant: ${YOIZEN_TENANT}' \\"
  log "      -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \\"
  log "      -d '{\"value\":\"urgent\"}'"
  log "  (workflow-service caches system variables per tenant for 5 minutes —"
  log "   allow up to 5 min before new executions pick up the change)"
  echo
  log "Drive it — POST a customer message to THIS instance's own URL:"
  log "    curl -X POST '${ingest_url}' \\"
  if [[ -n "$HTTP_APP_SECRET" ]]; then
    log "      -H 'x-http-channel-token: ${HTTP_APP_SECRET}' \\"
  else
    log "      -H 'x-http-channel-token: <app-secret>' \\   # run with RECREATE/admin to mint one"
  fi
  log "      -H 'content-type: application/json' \\"
  log "      -d '{\"from\":\"customer-42\",\"text\":\"This is the THIRD broken device you send me. Fix it NOW.\"}'"
  log "Or just run ./run.sh, which resolves the token and posts sample customer messages for you."
  log "Then check Telegram — every notification is stamped with the companyName variable."
}

main "$@"
