#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# 05-workflow — ensures the `crm-support-telegram` low-code orchestration
# workflow (trigger -> search-contact -> normalize -> score -> agent ->
# VIP conditional -> reply) for the crm-support-telegram demo.
# =============================================================================
#
# Thin bash wrapper over src/05-workflow.ts (mirrors this demo's 01-/02-/
# 03-/04- scripts). The actual provisioning logic (resolving the T02-T05
# artifacts by name/slug, building the workflow action sequence, create-or-
# update by name) lives there, run via `@yoizen/platform-sdk`; this script
# only checks prerequisites and execs the TypeScript entrypoint with the
# caller's environment in scope.
#
# Required env (not resolved here — see README.md "Environment variables"):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL
# Optional: YOIZEN_HOST_HEADER, CRM_WORKFLOW_NAME, CRM_WORKFLOW_APPLICATION,
#   TG_ACCOUNT_NAME, CRM_AGENT_NAME, SCORER_SERVICE_NAME
#
# Depends on 01-telegram-channel.sh, 02-hubspot-connector.sh, 03-ai-agent.sh,
# and 04-priority-scorer.sh having run first — every artifact this script
# needs is re-resolved by name/slug at run time (never parsed from another
# script's stdout).
#
# The orchestrator never parses this script's stdout — it re-resolves the
# workflow by name through the SDK itself. This script's final lines print
# the resolved workflow id and every referenced artifact id purely for
# human/CI readability.
# =============================================================================

if ! command -v node >/dev/null 2>&1; then
  echo "[05-workflow] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[05-workflow] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[05-workflow] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/05-workflow.ts
else
  exec npx tsx src/05-workflow.ts
fi
