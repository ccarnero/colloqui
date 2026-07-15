#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the hosted-services-api sample end-to-end — SDK-powered
# (sdk/GROWTH-PLAN.md P3.1). The actual login/list/invoke logic lives in
# src/index.ts, run via `@yoizen/platform-sdk`; this script only resolves the
# dev environment (via ../../lib/resolve-env.sh, same as every other sample's
# run.sh) and execs the Node app with those env vars in scope.
#
# Prerequisite: run ./setup.sh once first to provision the hosted service and
# its dynamic route (and, optionally, the workflow + dedicated HTTP channel
# instance). This script never creates or modifies platform objects.
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see integrations/http/hosted-services-api/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see integrations/http/hosted-services-api/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
