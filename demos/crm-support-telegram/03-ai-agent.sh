#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# 03-ai-agent — provisions the support agent (LLM connector, knowledge base,
# custom skill, system variables, per-user memory) for the crm-support-telegram
# demo.
# =============================================================================
#
# Thin bash wrapper over src/03-ai-agent.ts (mirrors the
# sdk/samples/ai-knowledge-base-agent + ai-skill-support-agent pattern and
# this demo's 01-/02- scripts). The actual provisioning logic lives there, run
# via `@yoizen/platform-sdk`; this script only checks prerequisites and execs
# the TypeScript entrypoint with the caller's environment in scope.
#
# Required env (not resolved here — see README.md "Environment variables"):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL,
#   OPENAI_API_KEY (or the matching provider key for AI_AGENT_PROVIDER)
# Optional: YOIZEN_HOST_HEADER, AI_AGENT_PROVIDER, AI_AGENT_MODEL,
#   AI_CREDENTIAL_MODE, AI_LLM_CONNECTOR_NAME, CRM_KB_NAME, CRM_SKILL_NAME,
#   CRM_AGENT_NAME, CRM_COMPANY_NAME, CRM_SLA_HOURS, CRM_SYSVARS_RESET
#
# The orchestrator and later numbered scripts never parse this script's
# stdout — they re-resolve every artifact by name through the SDK themselves.
# This script's final lines print the resolved connector/KB/skill/system
# variable/agent ids and the agent's publish state purely for human/CI
# readability.
# =============================================================================

if ! command -v node >/dev/null 2>&1; then
  echo "[03-ai-agent] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[03-ai-agent] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[03-ai-agent] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/03-ai-agent.ts
else
  exec npx tsx src/03-ai-agent.ts
fi
