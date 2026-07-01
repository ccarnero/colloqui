#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-knowledge-base-agent  (KB -> document embeddings -> agent RAG)
# =============================================================================
#
# Creates a knowledge base, uploads a small Markdown FAQ, attaches the KB to a
# published agent, then asks the agent a question whose answer exists only in
# the uploaded document.
#
# Important architecture fact: knowledge bases are standalone admin resources,
# but runtime RAG consumption is currently through agents via knowledge_base_ids.
# Document ingestion can use provider_connector_id; query-time KB search in
# agent-ai-service currently uses OpenAI embeddings, so that service still needs
# OPENAI_API_KEY in its own runtime environment.
# =============================================================================

KB_NAME="${KB_NAME:-ai-sample-support-kb}"
KB_DESCRIPTION="${KB_DESCRIPTION:-Sample support FAQ knowledge base for SDK AI samples}"
KB_DOC_FILE="${KB_DOC_FILE:-$(pwd)/docs/support-faq.md}"
KB_DOC_NAME="${KB_DOC_NAME:-support-faq.md}"
KB_EMBEDDING_MODEL="${KB_EMBEDDING_MODEL:-text-embedding-3-small}"

AGENT_NAME="${AI_AGENT_NAME:-ai-sample-kb-agent}"
AGENT_DESCRIPTION="${AI_AGENT_DESCRIPTION:-Sample agent that answers from an attached knowledge base}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
AGENT_MESSAGE="${AI_AGENT_MESSAGE:-According to the support FAQ, what is the refund policy? Include the verification phrase if you see one.}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"

RECREATE="${RECREATE:-0}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-120}"
DOC_TIMEOUT_S="${DOC_TIMEOUT_S:-120}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
CONNECTOR_ID=""
KB_ID=""
DOC_ID=""
AGENT_ID=""
EXECUTION_ID=""

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
  step "0/7 preflight"
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -f "$KB_DOC_FILE" ]] || { err "KB doc not found: ${KB_DOC_FILE}"; exit 1; }

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
      err "${key_var} is required for connector mode. Put it in .env next to setup.sh."
      exit 1
    fi
    if [[ -n "$key_value" ]] && is_placeholder_secret "$key_value"; then
      err "${key_var} looks like a placeholder. Replace it with a real provider key."
      exit 1
    fi
  else
    warn "AI_CREDENTIAL_MODE=env requires agent-ai-service to already have the provider key."
  fi

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    warn "OPENAI_API_KEY is not set in this shell. Upload may still work through provider_connector_id,"
    warn "but runtime KB search in agent-ai-service also needs OPENAI_API_KEY in the service environment."
  fi

  log "gateway=${YOIZEN_BASE_URL} tenant=${YOIZEN_TENANT} kb=${KB_NAME} agent=${AGENT_NAME} recreate=${RECREATE}"
}

stage_login() {
  step "1/7 login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
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
  step "2/7 ensure LLM/embedding connector '${LLM_CONNECTOR_NAME}'"

  local key_var base_var api_key base_url body resp
  key_var="$(provider_api_key_var "$AGENT_PROVIDER")"
  base_var="$(provider_base_url_var "$AGENT_PROVIDER")"
  api_key="$(read_env_value "$key_var")"
  base_url="$(read_env_value "$base_var")"
  [[ -n "$base_url" ]] || base_url="$(provider_default_base_url "$AGENT_PROVIDER")"

  CONNECTOR_ID="$(resolve_connector_id_by_name "$LLM_CONNECTOR_NAME")"
  if [[ -n "$CONNECTOR_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting connector ${CONNECTOR_ID}"
    api DELETE "/api/connectors/${CONNECTOR_ID}" >/dev/null 2>&1 || true
    CONNECTOR_ID=""
  fi

  body="$(jq -n \
    --arg name "$LLM_CONNECTOR_NAME" \
    --arg baseUrl "$base_url" \
    --arg token "$api_key" \
    '{ name: $name, context: "external", baseUrl: $baseUrl,
       authType: "bearer", authConfig: { bearerToken: $token },
       timeoutMs: 60000, maxRetries: 1, retryBackoffMs: 500,
       tags: ["llm"], endpoints: [] }')"

  if [[ -z "$CONNECTOR_ID" ]]; then
    resp="$(api POST /api/connectors "$body")"
    CONNECTOR_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$CONNECTOR_ID" ]] || { err "Connector creation failed: ${resp}"; exit 1; }
    log "created connector id=${CONNECTOR_ID} baseUrl=${base_url}"
  else
    log "reusing connector id=${CONNECTOR_ID}"
    api PATCH "/api/connectors/${CONNECTOR_ID}" "$(echo "$body" | jq '{baseUrl, authType, authConfig, timeoutMs, maxRetries, retryBackoffMs, tags}')" >/dev/null
  fi
}

resolve_kb_id_by_name() {
  api GET /api/admin/knowledge-bases \
    | jq -r --arg n "$1" '(.knowledge_bases // []) | map(select(.name==$n and (.is_active // true))) | .[0].id // empty'
}

stage_ensure_kb() {
  step "3/7 ensure knowledge base '${KB_NAME}'"
  KB_ID="$(resolve_kb_id_by_name "$KB_NAME")"

  if [[ -n "$KB_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting knowledge base ${KB_ID}"
    api DELETE "/api/admin/knowledge-bases/${KB_ID}" >/dev/null 2>&1 || true
    KB_ID=""
  fi

  local ingestion body resp
  ingestion="$(jq -n \
    --arg model "$KB_EMBEDDING_MODEL" \
    --arg connectorId "$CONNECTOR_ID" \
    '{ chunk_size: 800, chunk_overlap: 120, embedding_model: $model,
       chunking_strategy: "recursive" }
     | if $connectorId != "" then .provider_connector_id = $connectorId else . end')"

  body="$(jq -n \
    --arg name "$KB_NAME" \
    --arg description "$KB_DESCRIPTION" \
    --argjson ingestion "$ingestion" \
    '{ name: $name, description: $description, project: "sdk-samples",
       category: "support", icon: "library_books", ingestion_config: $ingestion }')"

  if [[ -z "$KB_ID" ]]; then
    resp="$(api POST /api/admin/knowledge-bases "$body")"
    KB_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$KB_ID" ]] || { err "Knowledge base creation failed: ${resp}"; exit 1; }
    log "created knowledge base id=${KB_ID}"
  else
    resp="$(api PATCH "/api/admin/knowledge-bases/${KB_ID}" "$body")"
    echo "$resp" | jq -e '.id // empty' >/dev/null || { err "Knowledge base update failed: ${resp}"; exit 1; }
    log "updated knowledge base id=${KB_ID}"
  fi
}

find_doc_id() {
  api GET "/api/admin/knowledge-bases/${KB_ID}/documents" \
    | jq -r --arg n "$KB_DOC_NAME" '(.documents // []) | map(select(.original_filename==$n)) | .[0].id // empty'
}

stage_upload_document() {
  step "4/7 upload/reingest document '${KB_DOC_NAME}'"
  DOC_ID="$(find_doc_id)"

  if [[ -n "$DOC_ID" && "$RECREATE" == "1" ]]; then
    api DELETE "/api/admin/knowledge-bases/${KB_ID}/documents/${DOC_ID}" >/dev/null 2>&1 || true
    DOC_ID=""
  fi

  if [[ -z "$DOC_ID" ]]; then
    local body resp content
    content="$(cat "$KB_DOC_FILE")"
    body="$(jq -n \
      --arg filename "$KB_DOC_NAME" \
      --arg content "$content" \
      '{ original_filename: $filename, mime_type: "text/markdown",
         content_type: "markdown", content_text: $content }')"
    resp="$(api POST "/api/admin/knowledge-bases/${KB_ID}/documents/upload" "$body")"
    DOC_ID="$(echo "$resp" | jq -r '.documentId // .id // empty')"
    [[ -n "$DOC_ID" ]] || { err "Document upload failed: ${resp}"; exit 1; }
    log "uploaded document id=${DOC_ID}"
  else
    log "reusing existing document id=${DOC_ID}; requesting reingest"
    api POST "/api/admin/knowledge-bases/${KB_ID}/documents/${DOC_ID}/reingest" '{}' >/dev/null
  fi
}

stage_wait_document() {
  step "5/7 wait for document ingestion"
  local deadline now resp status chunks
  deadline=$(( $(date +%s) + DOC_TIMEOUT_S ))

  while true; do
    resp="$(api GET "/api/admin/knowledge-bases/${KB_ID}/documents/${DOC_ID}")"
    status="$(echo "$resp" | jq -r '.status // empty')"
    chunks="$(echo "$resp" | jq -r '.chunk_count // 0')"
    case "$status" in
      ready)
        log "document ready chunks=${chunks}"
        return 0
        ;;
      failed)
        err "document ingestion failed"
        echo "$resp" | jq . >&2
        return 1
        ;;
      pending|processing|"")
        now="$(date +%s)"
        if [[ "$now" -ge "$deadline" ]]; then
          err "timed out waiting for document ${DOC_ID}; last status=${status:-unknown}"
          echo "$resp" | jq . >&2
          return 1
        fi
        sleep 3
        ;;
      *)
        warn "unknown document status '${status}', continuing"
        sleep 3
        ;;
    esac
  done
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
    --arg kbId "$KB_ID" \
    --argjson connectorId "$connector_json" \
    '{
      name: $name,
      description: $description,
      system_prompt: "You answer using the attached knowledge base. If the knowledge base contains a verification phrase, include it. Keep the answer concise. Do not call tools unless absolutely necessary.",
      model_config: {
        llm: { provider: $provider, model: $model, connectorId: $connectorId, temperature: 0.1, maxTokens: 300 },
        rules: "Prefer knowledge-base facts over general knowledge. If the answer is not in the KB, say so.",
        soul: "Precise and support-oriented.",
        subagents: []
      },
      tools: [
        { name: "loadSkill", description: "Built-in tool enabled only to use the tool-capable runtime path.", source_type: "builtin", builtin: true }
      ],
      channels: [],
      knowledge_base_ids: [$kbId]
    }'
}

stage_upsert_agent() {
  step "6/7 upsert + publish KB-backed agent '${AGENT_NAME}'"
  local existing_id body resp
  existing_id="$(resolve_agent_id_by_name "$AGENT_NAME")"

  if [[ -n "$existing_id" && "$RECREATE" == "1" ]]; then
    api DELETE "/api/admin/agents/${existing_id}" >/dev/null 2>&1 || true
    existing_id=""
  fi

  body="$(agent_payload)"
  if [[ -n "$existing_id" ]]; then
    resp="$(api PUT "/api/admin/agents/${existing_id}" "$body")"
  else
    resp="$(api POST /api/admin/agents "$body")"
  fi
  AGENT_ID="$(echo "$resp" | jq -r '.id // empty')"
  [[ -n "$AGENT_ID" ]] || { err "Agent upsert failed: ${resp}"; exit 1; }
  log "agent id=${AGENT_ID} knowledge_base_ids=[${KB_ID}]"

  resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
  echo "$resp" | jq -e '.id // empty' >/dev/null || { err "Agent publish failed: ${resp}"; exit 1; }
  log "published agent"
}

stage_execute() {
  step "7/7 execute KB-backed question"
  local body resp deadline now state
  body="$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg message "$AGENT_MESSAGE" \
    '{ agentId: $agentId, message: $message,
       conversationId: "ai-knowledge-base-agent", channel: "sample",
       customerName: "SDK Sample", userId: "sdk-sample", context: [] }')"

  resp="$(api POST /api/runtime/executions "$body")"
  EXECUTION_ID="$(echo "$resp" | jq -r '.executionId // empty')"
  [[ -n "$EXECUTION_ID" ]] || { err "Execution submit failed: ${resp}"; exit 1; }
  log "execution id=${EXECUTION_ID}"

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
stage_ensure_kb
stage_upload_document
stage_wait_document
stage_upsert_agent
stage_execute
