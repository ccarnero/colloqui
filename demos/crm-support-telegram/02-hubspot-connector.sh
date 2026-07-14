#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# 02-hubspot-connector — provisions the `demo-hubspot` connector (HubSpot CRM
# REST API) for the crm-support-telegram demo.
# =============================================================================
#
# Thin bash wrapper over src/02-hubspot-connector.ts (mirrors the
# sdk/samples/http-connectors and 01-telegram-channel.sh pattern). The actual
# provisioning logic (connector + endpoint + cache-strategy upsert, the
# telegram_user_id custom contact property, and the search-contact smoke
# check) lives there, run via `@yoizen/platform-sdk`; this script only checks
# prerequisites and execs the TypeScript entrypoint with the caller's
# environment in scope.
#
# Required env (not resolved here — see README.md "Environment variables"):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL,
#   HUBSPOT_SERVICE_KEY
# Optional: YOIZEN_HOST_HEADER, HUBSPOT_CACHE_TTL_SECONDS
#
# The orchestrator and later numbered scripts never parse this script's
# stdout — they re-resolve the connector by name through the SDK themselves.
# This script's final lines print the resolved connector id, property status,
# and smoke-check HTTP status purely for human/CI readability.
# =============================================================================

if ! command -v node >/dev/null 2>&1; then
  echo "[02-hubspot-connector] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[02-hubspot-connector] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[02-hubspot-connector] node_modules missing — running npm install..."
  npm install
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/02-hubspot-connector.ts
else
  exec npx tsx src/02-hubspot-connector.ts
fi
