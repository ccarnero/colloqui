#!/usr/bin/env bash
# =============================================================================
# resolve-env.sh  —  shared dev-environment resolver for the SDK sample run.sh's
# =============================================================================
#
# SOURCE this from a sample's run.sh (`. ../lib/resolve-env.sh`). It figures out
# the dev gateway endpoint, host header, tenant and seed credentials the SAME
# WAY `port-forward.sh` does — so `./run.sh` works with zero hand-set variables.
#
# Resolution (every value is overridable via env or a sibling `.env`):
#   - API_GATEWAY_PORT  (default 8080)         -> same var port-forward.sh reads
#   - DEV_DOMAIN / MINIKUBE_DOMAIN (default dev.local)
#   - GW_HOST = api-gateway.platform-services-<env>.<domain>
#   - base URL: explicit YOIZEN_BASE_URL  >  http://localhost:<port> (port-fwd)
#               >  http://<GW_HOST> (ingress)   — picked by a /health probe
#   - tenant/email/password: dev seed (acme / yclawd@demo.io / admin123)
#
# It loads `<sample>/.env` first (so secrets like TELEGRAM_BOT_TOKEN live there),
# then exports YOIZEN_* (consumed by http-connectors / http-fanout-telegram /
# the SDK) AND TG_* aliases (consumed by telegram-transform-reply).
# =============================================================================

# --- load the caller sample's .env (secrets, overrides) ----------------------
__sample_dir="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd)"
if [ -f "${__sample_dir}/.env" ]; then
  set -a; . "${__sample_dir}/.env"; set +a
  echo "[env] loaded ${__sample_dir}/.env"
fi

# --- derive infra coordinates (mirror of port-forward.sh) --------------------
YWAI_ENV="${YWAI_ENV:-dev}"
__namespace="platform-services-${YWAI_ENV}"
DEV_DOMAIN="${DEV_DOMAIN:-${MINIKUBE_DOMAIN:-dev.local}}"
API_GATEWAY_PORT="${API_GATEWAY_PORT:-8080}"
GW_HOST="api-gateway.${__namespace}.${DEV_DOMAIN}"

__tenant="${YOIZEN_TENANT:-acme}"
__email="${YOIZEN_EMAIL:-yclawd@demo.io}"
__password="${YOIZEN_PASSWORD:-admin123}"

# --- pick a reachable base URL ----------------------------------------------
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

# --- export for both naming conventions used by the samples -------------------
export YOIZEN_BASE_URL="$__base"
export YOIZEN_HOST_HEADER="$__host"
export YOIZEN_TENANT="$__tenant"
export YOIZEN_EMAIL="$__email"
export YOIZEN_PASSWORD="$__password"

# telegram-transform-reply/setup.sh reads TG_* instead of YOIZEN_*
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
