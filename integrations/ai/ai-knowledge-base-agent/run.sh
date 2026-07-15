#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the ai-knowledge-base-agent sample end-to-end — SDK-powered
# (sdk/GROWTH-PLAN.md P3.1). The actual provisioning + question-asking logic
# lives in src/index.ts (which re-runs src/setup.ts's pipeline, same as the
# old `run.sh` being `exec ./setup.sh`), run via `@yoizen/platform-sdk`; this
# script only resolves the dev environment (via ../../lib/resolve-env.sh, same
# as every other sample's run.sh) and execs the Node app with those env vars
# in scope.
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see integrations/ai/ai-knowledge-base-agent/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see integrations/ai/ai-knowledge-base-agent/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
