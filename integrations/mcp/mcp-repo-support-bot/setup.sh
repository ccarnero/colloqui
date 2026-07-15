#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: mcp-repo-support-bot  (the mcpCall workflow action, end to end)
# =============================================================================
#
# A Telegram "Repo Support Bot":
#
#   Telegram inbound (a question about a GitHub repo)
#     -> [agentCall  triage]  is this about the repo, or not?
#     -> [jsFunction route]   parse the triage agent's strict-JSON verdict
#     -> [conditional respond]
#         |- about the repo -> [mcpCall  DeepWiki ask_question]
#         |                    [jsFunction extract]
#         |                    [agentCall  summarize]
#         |                    [channelSend reply]
#         `- anything else  -> [channelSend polite decline]
#
# Provisions the DeepWiki MCP server, a triage agent, a summarizer agent, a
# Telegram channel account + webhook, and the workflow above — all through
# `@yoizen/platform-sdk`. The actual provisioning logic lives in src/setup.ts;
# this script only resolves the dev environment (via ../../lib/resolve-env.sh,
# same as every other sample's setup.sh) and execs the Node app.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md for
# env vars, prerequisites, and usage.
# =============================================================================
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see integrations/mcp/mcp-repo-support-bot/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see integrations/mcp/mcp-repo-support-bot/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
