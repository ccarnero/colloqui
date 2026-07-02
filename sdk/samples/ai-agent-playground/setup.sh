#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-agent-playground  (LLM connector -> agent -> publish -> execution)
# =============================================================================
#
# Provisions a minimal AI agent through the same API surface used by the
# admin-console AI pages, then submits one runtime execution and polls the result.
#
# The important part: this sample does NOT pretend AI can work without an LLM.
# It supports two credential modes:
#   - connector (default): creates/reuses an enabled HTTP connector tagged "llm"
#     and sets model_config.llm.connectorId on the agent.
#   - env: leaves connectorId empty; agent-ai-service must already have provider
#     env vars such as OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, etc.
#
# Contract sources (verified in code, paths relative to repo root):
#   - Admin UI shape : services/admin-console/src/app/core/models/agent.model.ts
#   - Agent CRUD     : services/api-gateway/src/modules/admin/admin-agents.controller.ts
#   - Runtime exec   : services/api-gateway/src/modules/runtime/runtime.controller.ts
#   - LLM providers  : services/agent-ai-service/src/modules/llm/provider-registry.service.ts
#   - Credentials    : services/agent-ai-service/src/modules/llm/credential-resolver.service.ts
# =============================================================================

AGENT_NAME="${AI_AGENT_NAME:-ai-sample-playground}"
AGENT_DESCRIPTION="${AI_AGENT_DESCRIPTION:-Sample agent created by sdk/samples/ai-agent-playground}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
AGENT_MESSAGE="${AI_AGENT_MESSAGE:-Reply with one short sentence confirming the Yoizen AI sample is working.}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"
RECREATE="${RECREATE:-0}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-90}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
CONNECTOR_ID=""
AGENT_ID=""
EXECUTION_ID=""

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

stage_preflight() {
  step "0/5 preflight"
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }

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

  log "YOIZEN_BASE_URL=${YOIZEN_BASE_URL}  tenant=${YOIZEN_TENANT}  agent=${AGENT_NAME}  recreate=${RECREATE}"
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

resolve_connector_id_by_name() {
  api GET "/api/connectors?context=external" \
    | jq -r --arg n "$1" 'if type=="array" then (.[] | select(.name==$n) | .id) else empty end' \
    | head -1
}

stage_ensure_llm_connector() {
  [[ "$CREDENTIAL_MODE" == "connector" ]] || return 0
  step "2/5 ensure LLM connector '${LLM_CONNECTOR_NAME}'"

  local key_var base_var api_key base_url body resp
  key_var="$(provider_api_key_var "$AGENT_PROVIDER")"
  base_var="$(provider_base_url_var "$AGENT_PROVIDER")"
  api_key="$(read_env_value "$key_var")"
  base_url="$(read_env_value "$base_var")"
  [[ -n "$base_url" ]] || base_url="$(provider_default_base_url "$AGENT_PROVIDER")"

  CONNECTOR_ID="$(resolve_connector_id_by_name "$LLM_CONNECTOR_NAME")"

  if [[ -n "$CONNECTOR_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting existing connector ${CONNECTOR_ID}"
    api DELETE "/api/connectors/${CONNECTOR_ID}" >/dev/null 2>&1 || true
    CONNECTOR_ID=""
  fi

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
    --arg description "$AGENT_DESCRIPTION" \
    --arg provider "$AGENT_PROVIDER" \
    --arg model "$AGENT_MODEL" \
    --argjson connectorId "$connector_json" \
    '{
      name: $name,
      description: $description,
      system_prompt: "You are a concise sample agent. Answer briefly and mention if the runtime execution reached the online LLM successfully.",
      model_config: {
        llm: {
          provider: $provider,
          model: $model,
          connectorId: $connectorId,
          temperature: 0.2,
          maxTokens: 256
        },
        rules: "Keep responses short. If asked for credentials or secrets, refuse.",
        soul: "Helpful, direct, calm.",
        subagents: []
      },
      tools: [],
      channels: []
    }'
}

stage_upsert_agent() {
  step "3/5 upsert agent '${AGENT_NAME}'"
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

stage_execute() {
  step "4/5 create runtime execution"
  local body resp
  body="$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg message "$AGENT_MESSAGE" \
    '{
      agentId: $agentId,
      message: $message,
      conversationId: "ai-sample-playground",
      channel: "sample",
      customerName: "SDK Sample",
      userId: "sdk-sample",
      context: []
    }')"

  resp="$(api POST /api/runtime/executions "$body")"
  EXECUTION_ID="$(echo "$resp" | jq -r '.executionId // empty')"
  [[ -n "$EXECUTION_ID" ]] || { err "Execution submit failed: ${resp}"; exit 1; }
  log "execution id=${EXECUTION_ID}"
}

stage_poll_result() {
  step "5/5 poll execution result"
  local deadline now resp state
  deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))

  while true; do
    resp="$(api GET "/api/runtime/executions/${EXECUTION_ID}")"
    state="$(echo "$resp" | jq -r '.state // .status // empty')"

    case "$state" in
      completed)
        log "completed"
        echo "$resp" | jq '{executionId, state, agentId, reply: (.result.reply // .result.response // .result.text // null), usage: .result.usage, provider: .result.provider, model: .result.model, costUsd: .result.costUsd, toolCalls: (.result.toolCalls // [])}'
        return 0
        ;;
      failed)
        err "execution failed"
        echo "$resp" | jq . >&2
        return 1
        ;;
      pending|running|accepted|queued|"")
        now="$(date +%s)"
        if [[ "$now" -ge "$deadline" ]]; then
          err "timed out waiting for execution ${EXECUTION_ID}; last state=${state:-unknown}"
          echo "$resp" | jq . >&2
          return 1
        fi
        sleep 2
        ;;
      *)
        warn "unknown state '${state}', continuing"
        sleep 2
        ;;
    esac
  done
}

stage_preflight
stage_login
stage_ensure_llm_connector
stage_upsert_agent
stage_execute
stage_poll_result
