#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
. ../lib/resolve-env.sh

# =============================================================================
# Sample: ai-skill-support-agent — run: ask the support agent three questions
# =============================================================================
#
# Requires ./setup.sh to have provisioned and published the agent first.
#
# Flow: login -> resolve agent by name -> submit three /api/runtime/executions
# and poll each to completion:
#   1. A refund-window question that starts with the skill trigger ("refund")
#      so the skill router activates 'refund-policy-expert' by trigger match.
#   2. A shipping-SLA question grounded in the knowledge base.
#   3. An out-of-policy refund demand, to show the rules guardrail (decline +
#      escalation offer, no promised refund).
#
# Contract sources (verified in code, paths relative to repo root):
#   - Runtime exec : services/api-gateway/src/modules/runtime/runtime.controller.ts
#   - Skill router : services/agent-ai-service/src/modules/skills/skill-router.service.ts
#                    (trigger match = userMessage startsWith(trigger))
# =============================================================================

AGENT_NAME="${AI_AGENT_NAME:-ai-sample-support}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-120}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
step() { echo -e "${BLUE}[STEP]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

TOKEN=""
AGENT_ID=""

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

stage_login() {
  step "login as ${YOIZEN_EMAIL} (tenant ${YOIZEN_TENANT})"
  local resp
  resp="$(api POST /api/auth/login \
    "{\"email\":\"${YOIZEN_EMAIL}\",\"password\":\"${YOIZEN_PASSWORD}\",\"tenant_id\":\"${YOIZEN_TENANT}\"}")"
  TOKEN="$(echo "$resp" | jq -r '.access_token // empty')"
  [[ -n "$TOKEN" ]] || { err "Login failed: $resp"; exit 1; }
  log "authenticated"
}

stage_resolve_agent() {
  step "resolve agent '${AGENT_NAME}'"
  AGENT_ID="$(api GET "/api/admin/agents?limit=100" \
    | jq -r --arg n "$AGENT_NAME" '(.agents // []) | map(select(.name==$n and (.is_active // true))) | .[0].id // empty')"
  if [[ -z "$AGENT_ID" ]]; then
    err "Agent '${AGENT_NAME}' not found. Run ./setup.sh first."
    exit 1
  fi
  log "agent id=${AGENT_ID}"
}

ask() {
  local label="$1" message="$2"
  step "ask: ${label}"
  log "question: ${message}"

  local body resp execution_id deadline now state
  body="$(jq -n \
    --arg agentId "$AGENT_ID" \
    --arg message "$message" \
    '{ agentId: $agentId, message: $message,
       conversationId: "ai-skill-support-agent", channel: "sample",
       customerName: "SDK Sample", userId: "sdk-sample", context: [] }')"

  resp="$(api POST /api/runtime/executions "$body")"
  execution_id="$(echo "$resp" | jq -r '.executionId // empty')"
  [[ -n "$execution_id" ]] || { err "Execution submit failed: ${resp}"; return 1; }
  log "execution id=${execution_id}"

  deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
  while true; do
    resp="$(api GET "/api/runtime/executions/${execution_id}")"
    state="$(echo "$resp" | jq -r '.state // .status // empty')"
    case "$state" in
      completed)
        log "completed"
        echo "$resp" | jq '{executionId, state, reply: (.result.reply // .result.response // .result.text // null), usage: .result.usage, provider: .result.provider, model: .result.model, costUsd: .result.costUsd, toolCalls: (.result.toolCalls // [])}'
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
          err "timed out waiting for execution ${execution_id}; last state=${state:-unknown}"
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

stage_login
stage_resolve_agent

# 1. Skill-trigger path: message starts with "refund" -> trigger match.
ask "refund window (skill trigger)" \
  "refund question: I bought a SmartHub router 20 days ago and it works fine, I just do not want it anymore. Can I get my money back, and is there any fee?"

# 2. KB-grounded path: shipping SLA facts live only in the policy document.
ask "shipping SLA (knowledge base)" \
  "My express shipment to a metro area is 4 business days late. What is the express shipping SLA and am I entitled to anything?"

# 3. Guardrail path: out-of-policy demand, agent must decline and escalate.
ask "out-of-policy demand (rules guardrail)" \
  "I bought a phone 90 days ago and I demand a full cash refund today or I will post about it everywhere. Give me the refund now."

log "done — compare the three replies: trigger-activated skill, KB-grounded answer, and the policy guardrail."
