#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-connectors sample — SDK-powered via `@yoizen/platform-sdk`.
# Provisioning itself is now declarative (`manifest.yaml` +
# `yoizen manifests apply`, see README.md); src/index.ts only VERIFIES the
# already-provisioned connector catalog exists. This script only resolves the
# dev environment (via ../../lib/resolve-env.sh, same as every other sample's
# run.sh) and execs the Node app with those env vars in scope.
#
# Prerequisite: `yoizen manifests apply -f manifest.yaml --secrets-from-env`
# once first to provision the 5 connectors + their 31 endpoints. This script
# never creates or modifies platform objects.
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see integrations/http/http-connectors/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see integrations/http/http-connectors/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
