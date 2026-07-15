#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# Sample: hosted-services-api
# =============================================================================
#
# Registers a tenant-scoped Knative-backed hosted service through the gateway
# registry API, creates a dynamic route for it, and (optionally) wires a
# workflow that invokes the hosted service and notifies Telegram — SDK-powered
# (sdk/GROWTH-PLAN.md P3.1). The actual provisioning logic (login, service/
# route/workflow dedup, dynamic-route assembly) lives in src/setup.ts, run via
# `@yoizen/platform-sdk`; this script only resolves the dev environment (via
# ../../lib/resolve-env.sh, same as every other sample's setup.sh) and execs the
# Node app with those env vars in scope.
#
# See src/setup.ts for the full stage-by-stage design notes, and README.md
# for env vars, prerequisites, and usage.
# =============================================================================
. ../../lib/resolve-env.sh

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] 'node' was not found on PATH." >&2
  echo "[setup] Install Node >=18 (see integrations/http/hosted-services-api/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[setup] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[setup] Install Node >=18 / npm (see integrations/http/hosted-services-api/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[setup] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/setup.ts
