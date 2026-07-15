#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: ai-skill-support-agent  (skills catalog + knowledge base -> agent)
# =============================================================================
#
# Provisions a call-center support agent that combines the two AI catalog
# features — a custom SKILL from AI > Skills and a KNOWLEDGE BASE from AI >
# Knowledge Bases, both attached to an agent — SDK-powered
# (@yoizen/platform-sdk). The actual provisioning logic (login, dedup,
# skill/KB/agent upsert, document ingestion poll) lives in src/setup.ts; this
# script only resolves the dev environment (via ../../lib/resolve-env.sh, same
# as every other sample's setup.sh) and execs the Node app with those env
# vars in scope.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md
# for env vars, prerequisites, and usage.
# =============================================================================
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see integrations/ai/ai-skill-support-agent/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see integrations/ai/ai-skill-support-agent/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
