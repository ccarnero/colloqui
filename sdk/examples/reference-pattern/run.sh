#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Drives the http-bridge sample end-to-end — SDK-powered (sdk/GROWTH-PLAN.md
# P3.1). The actual login/list/ingest logic lives in src/index.ts, run via
# `@yoizen/platform-sdk`; this script only resolves the dev environment and
# execs the Node app with those env vars in scope.
#
# NOTE: this sample lives under sdk/examples/ (the SDK-surface tier), which
# must not depend on integrations/lib — so the dev-environment resolution
# below is inlined verbatim from integrations/lib/resolve-env.sh instead of
# being sourced from it.
#
# Prerequisite: run ./setup.sh once first to provision the workflow and its
# dedicated HTTP account. This script never creates or modifies platform
# objects.

# --- inlined dev-environment resolver (see integrations/lib/resolve-env.sh) --
if [ -f "./.env" ]; then
  set -a; . "./.env"; set +a
  echo "[env] loaded ./.env"
fi

YWAI_ENV="${YWAI_ENV:-dev}"
__namespace="platform-services-${YWAI_ENV}"
DEV_DOMAIN="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"
API_GATEWAY_PORT="${API_GATEWAY_PORT:-8080}"
GW_HOST="api-gateway.${__namespace}.${DEV_DOMAIN}"

__tenant="${YOIZEN_TENANT:-acme}"
__email="${YOIZEN_EMAIL:-yclawd@demo.io}"
__password="${YOIZEN_PASSWORD:-admin123}"

__reachable() { curl -fsS -m 3 -o /dev/null "$1/health" 2>/dev/null; }

if [ -n "${YOIZEN_BASE_URL:-}" ]; then
  __base="$YOIZEN_BASE_URL"
elif __reachable "http://localhost:${API_GATEWAY_PORT}"; then
  __base="http://localhost:${API_GATEWAY_PORT}"
elif __reachable "http://${GW_HOST}"; then
  __base="http://${GW_HOST}"
else
  __base="http://localhost:${API_GATEWAY_PORT}"
fi
__host="${YOIZEN_HOST_HEADER:-$GW_HOST}"

export YOIZEN_BASE_URL="$__base"
export YOIZEN_HOST_HEADER="$__host"
export YOIZEN_TENANT="$__tenant"
export YOIZEN_EMAIL="$__email"
export YOIZEN_PASSWORD="$__password"

# vestigial TG_* compatibility aliases — no current sample reads them (they all
# use YOIZEN_*); kept for exact parity with the shared resolver even though this
# sample doesn't read them itself.
export TG_API_URL="$__base"
export TG_HOST_HEADER="$__host"
export TG_TENANT="$__tenant"
export TG_EMAIL="$__email"
export TG_PASSWORD="$__password"

echo "[env] gateway=${YOIZEN_BASE_URL}  host=${YOIZEN_HOST_HEADER}  tenant=${YOIZEN_TENANT}  user=${YOIZEN_EMAIL}"
if ! __reachable "$YOIZEN_BASE_URL"; then
  echo "[env] WARN: ${YOIZEN_BASE_URL}/health unreachable — start the port-forward first:" >&2
  echo "[env]       ./port-forward.sh ${YWAI_ENV}   (from the repo root)" >&2
fi
# --- end inlined dev-environment resolver -----------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "[run] 'node' was not found on PATH." >&2
  echo "[run] Install Node >=18 (see sdk/examples/reference-pattern/README.md) and re-run." >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "[run] 'npx' was not found on PATH (usually ships with npm)." >&2
  echo "[run] Install Node >=18 / npm (see sdk/examples/reference-pattern/README.md) and re-run." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[run] node_modules missing — running npm install..."
  npm install
fi

exec npx tsx src/index.ts
