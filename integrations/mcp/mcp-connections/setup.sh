#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: mcp-connections  (MCP Servers — auth, test-connection, tool
# discovery, per-tool agent enablement, and an mcpCall workflow action)
# =============================================================================
#
# Provisions one MCP server (auth type + a fake/example endpoint), probes it
# with testConnection()/listTools(), upserts a demo agent and enables a
# hardcoded subset of that server's tools per-agent (plus a description
# override), and — if the SDK's workflows resource supports it — creates a
# minimal workflow with one mcpCall step. All through `@yoizen/platform-sdk`.
# The actual provisioning logic lives in src/setup.ts; this script only
# resolves the dev environment (via ../../lib/resolve-env.sh, same as every
# other sample's setup.sh) and execs the Node app with those env vars in
# scope.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md
# for env vars, prerequisites, and usage.
# =============================================================================
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see integrations/mcp/mcp-connections/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see integrations/mcp/mcp-connections/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
