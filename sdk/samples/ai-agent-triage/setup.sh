#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: ai-agent-triage  (HTTP channel in -> agentCall triage -> Telegram out)
# =============================================================================
#
# Provisions an LLM connector + a published triage agent + a dedicated HTTP
# channel account + a workflow (agentCall triage -> jsFunction route ->
# conditional notify) — SDK-powered. The actual provisioning logic (login,
# dedup, LLM connector/agent upsert, Telegram chat_id discovery, workflow
# assembly) lives in src/setup.ts, run via `@yoizen/platform-sdk`; this
# script only resolves the dev environment (via ../lib/resolve-env.sh, same
# as every other sample's setup.sh) and execs the Node app with those env
# vars in scope.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md
# for env vars, prerequisites, and usage.
# =============================================================================
. ../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see sdk/samples/ai-agent-triage/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see sdk/samples/ai-agent-triage/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
