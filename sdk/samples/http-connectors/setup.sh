#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: http-connectors  (declarative outbound HTTP connectors / adapters)
# =============================================================================
#
# Provisions a set of EXTERNAL HTTP connectors (platform "adapters") from the
# declarative JSON files in ./connectors, through the platform API — SDK-
# powered via `@yoizen/platform-sdk`. The actual provisioning logic (upsert,
# dedup, endpoint/config reconcile, RECREATE) lives in src/setup.ts; this
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
  echo "[setup] Install Node >=18 (see sdk/samples/http-connectors/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see sdk/samples/http-connectors/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
