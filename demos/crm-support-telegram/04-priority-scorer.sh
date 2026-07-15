#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# =============================================================================
# 04-priority-scorer — builds the priority-scorer hosted-service image and
# registers it as a Knative-backed service for the crm-support-telegram demo.
# =============================================================================
#
# Thin bash wrapper over src/04-priority-scorer.ts (mirrors the
# integrations/http/hosted-services-api + this demo's 01-/02-/03- scripts). The
# actual provisioning logic (docker build, registry.services create-or-
# update, Knative Ready wait, /score smoke check) lives there, run via
# `@yoizen/platform-sdk`; this script only checks prerequisites and execs the
# TypeScript entrypoint with the caller's environment in scope.
#
# Required env (not resolved here — see README.md "Environment variables"):
#   YOIZEN_TENANT, YOIZEN_EMAIL, YOIZEN_PASSWORD, YOIZEN_BASE_URL
# Optional: YOIZEN_HOST_HEADER, SCORER_SERVICE_NAME, SCORER_SERVICE_PORT,
#   SCORER_MIN_SCALE, SCORER_MAX_SCALE, SCORER_CONCURRENCY_TARGET,
#   SCORER_IMAGE_TAG, SCORER_READY_TIMEOUT_SECONDS, PLATFORM_ENVIRONMENT
#
# Depends on 02-hubspot-connector.sh (resolves the demo-hubspot connector +
# its list-deals-by-contact/list-tickets-by-contact/create-ticket endpoints
# by name) having run first.
#
# The orchestrator and later numbered scripts never parse this script's
# stdout — they re-resolve the registered service by name through the SDK
# themselves. This script's final lines print the resolved service UUID,
# slug, Knative ready state, and smoke check result purely for human/CI
# readability.
# =============================================================================

if ! command -v node >/dev/null 2>&1; then
  echo "[04-priority-scorer] 'node' was not found on PATH." >&2
  exit 1
fi
if ! command -v bunx >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  echo "[04-priority-scorer] neither 'bunx' nor 'npx' was found on PATH." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[04-priority-scorer] 'docker' was not found on PATH — required to build the hosted-service image." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[04-priority-scorer] node_modules missing — running npm install..."
  npm install
fi
if [ ! -d priority-scorer/node_modules ]; then
  echo "[04-priority-scorer] priority-scorer/node_modules missing — running bun install..."
  (cd priority-scorer && bun install)
fi

if command -v bunx >/dev/null 2>&1; then
  exec bunx tsx src/04-priority-scorer.ts
else
  exec npx tsx src/04-priority-scorer.ts
fi
