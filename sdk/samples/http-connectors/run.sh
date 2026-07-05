#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-connectors sample — SDK-powered via `@yoizen/platform-sdk`.
# The actual provisioning logic lives in src/index.ts (which just delegates to
# src/setup.ts's provisionConnectors()); this script only resolves the dev
# environment (via ../lib/resolve-env.sh, same as every other sample's
# run.sh) and execs the Node app with those env vars in scope.
. ../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see sdk/samples/http-connectors/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see sdk/samples/http-connectors/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
