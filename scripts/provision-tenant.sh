#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
MINIKUBE_PROFILE="yoizen-arch"

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "\n${CYAN}[STEP]${NC}  $*"; }

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  err "jq is required but not installed. Run: brew install jq"
  exit 1
fi

# ---------------------------------------------------------------------------
# Parameters
# Positional: TENANT_NAME USER_EMAIL USER_PASSWORD USER_DISPLAY_NAME USER_ROLE
# Env overrides for infrastructure params
# ---------------------------------------------------------------------------
TENANT_NAME="${1:-acme}"
USER_EMAIL="${2:-admin@acme.com}"
USER_PASSWORD="${3:-password}"
USER_DISPLAY_NAME="${4:-admin}"
USER_ROLE="${5:-tenant_admin}"

USER_SUPPLIED_BASE_URL="false"
if [[ -n "${BASE_URL:-}" ]]; then
  USER_SUPPLIED_BASE_URL="true"
fi

ENVIRONMENT="${ENVIRONMENT:-dev}"
BASE_URL="${BASE_URL:-http://localhost:8080}"
HOST_HEADER="${HOST_HEADER:-}"
PLATFORM_ADMIN_EMAIL="${PLATFORM_ADMIN_EMAIL:-admin@yoizen.io}"
PLATFORM_ADMIN_PASSWORD="${PLATFORM_ADMIN_PASSWORD:-yoizen-admin-change-me}"

# Optional tenant configuration — omitted from payload if unset
Y_SOCIAL_URL="${Y_SOCIAL_URL:-}"
Y_FLOW_URL="${Y_FLOW_URL:-}"

resolve_gateway_target() {
  local default_host_header

  if kubectl config current-context 2>/dev/null | grep -q "^orbstack$"; then
    default_host_header="api-gateway.platform-services-${ENVIRONMENT}.127.0.0.1.sslip.io"
    if [[ -z "$HOST_HEADER" ]]; then
      HOST_HEADER="$default_host_header"
    fi
    if [[ "$USER_SUPPLIED_BASE_URL" != "true" ]]; then
      BASE_URL="http://${HOST_HEADER}"
      log "Detected OrbStack cluster context"
      log "Using direct OrbStack ingress at ${BASE_URL}"
      return
    fi
    log "Detected OrbStack cluster context"
    return
  fi

  if command -v minikube &>/dev/null && minikube status -p "$MINIKUBE_PROFILE" &>/dev/null; then
    default_host_header="api-gateway.platform-services-${ENVIRONMENT}.$(minikube ip -p "$MINIKUBE_PROFILE").sslip.io"
    if [[ -z "$HOST_HEADER" ]]; then
      HOST_HEADER="$default_host_header"
    fi
    log "Detected Minikube profile '${MINIKUBE_PROFILE}'"
    return
  fi

  if [[ -z "$HOST_HEADER" ]]; then
    HOST_HEADER="api-gateway.platform-services-${ENVIRONMENT}.127.0.0.1.sslip.io"
  fi
  warn "Could not detect OrbStack or Minikube. Falling back to ${HOST_HEADER}"
}

resolve_gateway_target

log "Provisioning tenant '${TENANT_NAME}' on ${BASE_URL}"
log "  Host header    : ${HOST_HEADER}"
log "  Platform admin : ${PLATFORM_ADMIN_EMAIL}"
log "  Tenant user    : ${USER_EMAIL} (${USER_ROLE})"

# ---------------------------------------------------------------------------
# Helper: curl with status-code check
# Usage: api_call <description> <http_method> <path> [extra curl args...]
# Prints the JSON response body to stdout.
# Exits on non-2xx response.
# ---------------------------------------------------------------------------
api_call() {
  local description="$1"
  local method="$2"
  local path="$3"
  shift 3

  local url="${BASE_URL}${path}"
  local tmp_body
  tmp_body="$(mktemp)"
  local tmp_err
  tmp_err="$(mktemp)"

  local http_code
  if ! http_code="$(
    curl -s -o "$tmp_body" -w "%{http_code}" \
      --request "$method" \
      --url "$url" \
      --header "host: ${HOST_HEADER}" \
      --header "content-type: application/json" \
      --connect-timeout 5 \
      "$@"
      2>"$tmp_err"
  )"; then
    err "${description} failed — could not reach ${url}"
    err "curl: $(cat "$tmp_err")"
    rm -f "$tmp_body" "$tmp_err"
    exit 1
  fi

  local body
  body="$(cat "$tmp_body")"
  rm -f "$tmp_body" "$tmp_err"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    err "${description} failed — HTTP ${http_code}"
    err "Response: ${body}"
    exit 1
  fi

  echo -e "${GREEN}[INFO]${NC}  ${description} → HTTP ${http_code}" >&2
  printf '%s' "$body"
}

# ---------------------------------------------------------------------------
# Step 1 — Login as platform admin, extract access token
# ---------------------------------------------------------------------------
step "1/3  Authenticating as platform admin"

LOGIN_PAYLOAD="$(jq -n \
  --arg email "$PLATFORM_ADMIN_EMAIL" \
  --arg password "$PLATFORM_ADMIN_PASSWORD" \
  '{"email": $email, "password": $password}'
)"

LOGIN_RESPONSE="$(api_call "Login" POST /api/auth/login \
  --data "$LOGIN_PAYLOAD")"

ACCESS_TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | jq -r '.access_token // .token // empty')"

if [[ -z "$ACCESS_TOKEN" ]]; then
  err "Could not extract access_token from login response."
  err "Response was: ${LOGIN_RESPONSE}"
  exit 1
fi

log "  Access token acquired (${#ACCESS_TOKEN} chars)"

AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"

# ---------------------------------------------------------------------------
# Step 2 — Create the tenant
# ---------------------------------------------------------------------------
step "2/3  Creating tenant '${TENANT_NAME}'"

# Build configuration object; only include optional URL fields when provided
TENANT_CONFIG="{}"
if [[ -n "$Y_SOCIAL_URL" ]]; then
  TENANT_CONFIG="$(printf '%s' "$TENANT_CONFIG" | jq --arg v "$Y_SOCIAL_URL" '. + {"ySocialUrl": $v}')"
fi
if [[ -n "$Y_FLOW_URL" ]]; then
  TENANT_CONFIG="$(printf '%s' "$TENANT_CONFIG" | jq --arg v "$Y_FLOW_URL" '. + {"yFlowUrl": $v}')"
fi

TENANT_PAYLOAD="$(jq -n \
  --arg name "$TENANT_NAME" \
  --argjson config "$TENANT_CONFIG" \
  '{"name": $name, "configuration": $config}'
)"

api_call "Create tenant" POST /api/tenants \
  --header "$AUTH_HEADER" \
  --data "$TENANT_PAYLOAD" >/dev/null

# ---------------------------------------------------------------------------
# Step 3 — Create tenant admin user
# ---------------------------------------------------------------------------
step "3/3  Creating tenant user '${USER_EMAIL}'"

USER_PAYLOAD="$(jq -n \
  --arg tenant_id "$TENANT_NAME" \
  --arg email "$USER_EMAIL" \
  --arg password "$USER_PASSWORD" \
  --arg role_id "$USER_ROLE" \
  --arg display_name "$USER_DISPLAY_NAME" \
  '{
    "tenant_id": $tenant_id,
    "email": $email,
    "password": $password,
    "role_id": $role_id,
    "display_name": $display_name
  }'
)"

api_call "Create tenant user" POST /api/auth/tenant-users \
  --header "$AUTH_HEADER" \
  --header "x-yoizen-tenant: ${TENANT_NAME}" \
  --data "$USER_PAYLOAD" >/dev/null

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Tenant provisioned successfully${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Tenant        : ${CYAN}${TENANT_NAME}${NC}"
echo -e "  Admin user    : ${CYAN}${USER_EMAIL}${NC}"
echo -e "  Role          : ${CYAN}${USER_ROLE}${NC}"
if [[ -n "$Y_SOCIAL_URL" ]]; then
  echo -e "  ySocialUrl    : ${CYAN}${Y_SOCIAL_URL}${NC}"
fi
if [[ -n "$Y_FLOW_URL" ]]; then
  echo -e "  yFlowUrl      : ${CYAN}${Y_FLOW_URL}${NC}"
fi
echo ""
