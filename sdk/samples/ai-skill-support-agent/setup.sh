#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-skill-support-agent  (skills catalog + knowledge base -> agent)
# =============================================================================
#
# Provisions a call-center support agent that combines the two AI catalog
# features:
#   1. A custom SKILL from AI > Skills ("refund-policy-expert"): a reusable
#      prompt package with trigger commands, when-to-use routing hints and a
#      reference cheat-sheet file. It is attached to the agent through
#      model_config.subagents with catalog_skill_id.
#   2. A KNOWLEDGE BASE from AI > Knowledge Bases ("ai-sample-callcenter-kb")
#      with the full Acme Telco policy handbook uploaded and embedded, attached
#      through knowledge_base_ids.
#
# Flow: preflight -> login -> LLM connector -> skill -> KB + document ->
#       agent upsert + publish. Run ./run.sh afterwards to ask questions.
#
# Contract sources (verified in code, paths relative to repo root):
#   - Skills API      : services/api-gateway/src/modules/admin/admin-skills.controller.ts
#                       services/agent-admin-service/src/modules/skills/skills.dto.ts
#                       services/agent-admin-service/src/modules/skills/skills.service.ts
#   - Subagent shape  : services/admin-console/src/app/core/models/agent.model.ts (ISubagentConfig)
#   - Skill runtime   : services/agent-ai-service/src/modules/chat/chat.service.ts (preparePrompt)
#                       services/agent-ai-service/src/modules/skills/skill-mapper.ts (CatalogSkill)
#                       services/agent-ai-service/src/modules/skills/skill-router.service.ts
#   - KB CRUD/ingest  : sdk/samples/ai-knowledge-base-agent/setup.sh (same contract)
#   - Agent CRUD      : services/api-gateway/src/modules/admin/admin-agents.controller.ts
#   - Runtime exec    : services/api-gateway/src/modules/runtime/runtime.controller.ts
#
# Runtime note (verified): agent-ai-service consumes model_config.subagents
# directly — it does NOT re-fetch the skill by catalog_skill_id. The admin
# console copies the catalog skill snapshot into the subagent entry, so this
# script does the same: the subagent carries the full skill snapshot
# (system_prompt, trigger_commands, when_to_use, priority, mode) PLUS
# catalog_skill_id as the link back to the catalog entry.
# =============================================================================

SKILL_NAME="${AI_SKILL_NAME:-refund-policy-expert}"
KB_NAME="${KB_NAME:-ai-sample-callcenter-kb}"
KB_DESCRIPTION="${KB_DESCRIPTION:-Acme Telco call-center policy handbook for SDK AI samples}"
KB_DOC_FILE="${KB_DOC_FILE:-$(pwd)/policy/acme-telco-policy.md}"
KB_DOC_NAME="${KB_DOC_NAME:-acme-telco-policy.md}"
KB_EMBEDDING_MODEL="${KB_EMBEDDING_MODEL:-text-embedding-3-small}"

AGENT_NAME="${AI_AGENT_NAME:-ai-sample-support}"
AGENT_DESCRIPTION="${AI_AGENT_DESCRIPTION:-Call-center support agent with a catalog skill and a knowledge base}"
AGENT_PROVIDER="${AI_AGENT_PROVIDER:-openai}"
AGENT_MODEL="${AI_AGENT_MODEL:-gpt-4o-mini}"
CREDENTIAL_MODE="${AI_CREDENTIAL_MODE:-connector}"
LLM_CONNECTOR_NAME="${AI_LLM_CONNECTOR_NAME:-sample-${AGENT_PROVIDER}-llm}"

RECREATE="${RECREATE:-0}"
DOC_TIMEOUT_S="${DOC_TIMEOUT_S:-120}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
CONNECTOR_ID=""
SKILL_ID=""
KB_ID=""
DOC_ID=""
AGENT_ID=""

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
  step "0/7 preflight"
  command -v jq >/dev/null || { err "jq is required"; exit 1; }
  command -v curl >/dev/null || { err "curl is required"; exit 1; }
  [[ -f "$KB_DOC_FILE" ]] || { err "Policy doc not found: ${KB_DOC_FILE}"; exit 1; }

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
    warn "OPENAI_API_KEY is not set in this shell. KB upload may still work through provider_connector_id,"
    warn "but runtime KB search in agent-ai-service also needs OPENAI_API_KEY in the service environment."
  fi

  log "gateway=${YOIZEN_BASE_URL} tenant=${YOIZEN_TENANT} skill=${SKILL_NAME} kb=${KB_NAME} agent=${AGENT_NAME} recreate=${RECREATE}"
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

resolve_skill_id_by_name() {
  api GET /api/admin/skills \
    | jq -r --arg n "$1" '(.skills // []) | map(select(.name==$n and (.is_active // true))) | .[0].id // empty'
}

# Fields verified against CreateSkillDto in
# services/agent-admin-service/src/modules/skills/skills.dto.ts:
#   name, description, system_prompt, icon, color, trigger_commands[],
#   when_to_use, priority (0-1000), allowed_tools[],
#   mode in [router, llm_driven, inline],
#   files[{name, path, type in [script, reference, asset], content}]
skill_payload() {
  local cheatsheet
  cheatsheet="$(cat <<'EOF'
# Refund cheat-sheet (Acme Telco policy v3, condensed)

- Devices: full refund within 30 days of delivery (45 days for Acme Max customers).
- Accessories: 14 days.
- Prepaid top-ups / consumed data packs: non-refundable.
- Plan charges: prorated refund only for confirmed outages > 48 h.
- Restocking fee: 15% for opened, non-defective devices returned after day 15.
- Refunds go to the original payment method; 5-7 business days after inspection.
- RMA number required before any return shipment.
- Outside the window: never promise a refund — escalate to Tier 2 Billing (24 h SLA).
EOF
)"
  jq -n \
    --arg name "$SKILL_NAME" \
    --arg cheatsheet "$cheatsheet" \
    '{
      name: $name,
      description: "Expert handling of refund and return requests under the Acme Telco policy.",
      system_prompt: "You are the refund-policy expert for Acme Telco support. Steps: (1) identify the item type (device, accessory, prepaid) and the days elapsed since delivery; (2) apply the matching refund window (30 days devices, 45 for Acme Max, 14 accessories, prepaid non-refundable); (3) check the restocking-fee rule for opened non-defective devices after day 15; (4) if the request is inside policy, explain the RMA step and the 5-7 business day timeline; (5) if it is outside policy, decline politely and offer escalation to Tier 2 Billing. Always cite the policy section applied.",
      icon: "currency_exchange",
      color: "#66bb6a",
      trigger_commands: ["refund", "reembolso"],
      when_to_use: "Use when the customer asks about refunds, returns, RMA, restocking fees, or money back.",
      priority: 10,
      allowed_tools: [],
      mode: "llm_driven",
      files: [
        {
          name: "refund-cheatsheet.md",
          path: "reference/refund-cheatsheet.md",
          type: "reference",
          content: $cheatsheet
        }
      ]
    }'
}

stage_ensure_skill() {
  step "3/7 ensure catalog skill '${SKILL_NAME}'"
  SKILL_ID="$(resolve_skill_id_by_name "$SKILL_NAME")"

  if [[ -n "$SKILL_ID" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting skill ${SKILL_ID}"
    api DELETE "/api/admin/skills/${SKILL_ID}" >/dev/null 2>&1 || true
    SKILL_ID=""
  fi

  local body resp
  body="$(skill_payload)"

  if [[ -z "$SKILL_ID" ]]; then
    resp="$(api POST /api/admin/skills "$body")"
    SKILL_ID="$(echo "$resp" | jq -r '.id // empty')"
    [[ -n "$SKILL_ID" ]] || { err "Skill creation failed: ${resp}"; exit 1; }
    log "created skill id=${SKILL_ID}"
  else
    resp="$(api PATCH "/api/admin/skills/${SKILL_ID}" "$body")"
    echo "$resp" | jq -e '.id // empty' >/dev/null || { err "Skill update failed: ${resp}"; exit 1; }
    log "updated skill id=${SKILL_ID}"
  fi
}

resolve_kb_id_by_name() {
  api GET /api/admin/knowledge-bases \
    | jq -r --arg n "$1" '(.knowledge_bases // []) | map(select(.name==$n and (.is_active // true))) | .[0].id // empty'
}

stage_ensure_kb() {
  step "4/7 ensure knowledge base '${KB_NAME}'"
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
       category: "support", icon: "support_agent", ingestion_config: $ingestion }')"

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
  step "5/7 upload/reingest policy document '${KB_DOC_NAME}'"
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

  # poll ingestion to ready
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

# Subagent shape verified against ISubagentConfig
# (services/admin-console/src/app/core/models/agent.model.ts) plus the runtime
# consumer: agent-ai-service maps model_config.subagents -> agent.skills
# (agent-config.postgres.repository.ts) and converts every entry that has a
# system_prompt through catalogSkillToSkillDefinition (chat/chat.service.ts +
# skills/skill-mapper.ts), reading trigger_commands / when_to_use / priority /
# mode from the ENTRY ITSELF. That is why the subagent carries the full skill
# snapshot in addition to catalog_skill_id (same as the admin console does).
agent_payload() {
  local connector_json skill_body subagent
  if [[ "$CREDENTIAL_MODE" == "connector" ]]; then
    connector_json="$(jq -n --arg id "$CONNECTOR_ID" '$id')"
  else
    connector_json="null"
  fi

  skill_body="$(skill_payload)"
  subagent="$(echo "$skill_body" | jq \
    --arg skillId "$SKILL_ID" \
    '{
      name: .name,
      description: .description,
      system_prompt: .system_prompt,
      enabled: true,
      catalog_skill_id: $skillId,
      trigger_commands: .trigger_commands,
      when_to_use: .when_to_use,
      priority: .priority,
      mode: .mode
    }')"

  jq -n \
    --arg name "$AGENT_NAME" \
    --arg description "$AGENT_DESCRIPTION" \
    --arg provider "$AGENT_PROVIDER" \
    --arg model "$AGENT_MODEL" \
    --arg kbId "$KB_ID" \
    --argjson connectorId "$connector_json" \
    --argjson subagent "$subagent" \
    '{
      name: $name,
      description: $description,
      system_prompt: "You are the Acme Telco customer-care agent. Answer support questions about refunds, returns, shipping and plans using the attached knowledge base as the source of truth. If the knowledge base contains a verification phrase, include it once in your answer.",
      model_config: {
        llm: { provider: $provider, model: $model, connectorId: $connectorId, temperature: 0.2, maxTokens: 400 },
        rules: "Never promise a refund outside the policy windows; offer escalation to Tier 2 Billing instead. Always cite the policy section you are applying. Prefer knowledge-base facts over general knowledge; if the answer is not covered, say so.",
        soul: "Empathetic, professional and calm. Acknowledges frustration before explaining policy.",
        subagents: [$subagent]
      },
      tools: [],
      channels: [],
      knowledge_base_ids: [$kbId]
    }'
}

stage_upsert_agent() {
  step "6/7 upsert support agent '${AGENT_NAME}'"
  local existing_id body resp
  existing_id="$(resolve_agent_id_by_name "$AGENT_NAME")"

  if [[ -n "$existing_id" && "$RECREATE" == "1" ]]; then
    log "RECREATE=1 — deleting agent ${existing_id}"
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
  log "agent id=${AGENT_ID} skill=${SKILL_ID} knowledge_base_ids=[${KB_ID}]"
}

stage_publish_agent() {
  step "7/7 publish agent"
  local resp
  resp="$(api POST "/api/admin/agents/${AGENT_ID}/publish" '{}')"
  echo "$resp" | jq -e '.id // empty' >/dev/null || { err "Agent publish failed: ${resp}"; exit 1; }
  log "published agent '${AGENT_NAME}' — now ask it questions with ./run.sh"
}

stage_preflight
stage_login
stage_ensure_llm_connector
stage_ensure_skill
stage_ensure_kb
stage_upload_document
stage_upsert_agent
stage_publish_agent
