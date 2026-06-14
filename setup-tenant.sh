#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# setup-tenant.sh — Create tenant + admin user
# ──────────────────────────────────────────────────────────────
# Usage:
#   ./setup-tenant.sh [OPTIONS]
#
# Creates a tenant and a tenant_admin user (idempotent).
# Requires the API to be already reachable.
#
# Options:
#   --tenant-id <id>        Tenant ID (default: acme)
#   --tenant-tier <tier>    Tenant tier (default: shared)
#   --email <email>         Tenant admin email (default: yclawd@demo.io)
#   --password <password>   Tenant admin password (default: admin123)
#   --role <role>           Tenant admin role (default: tenant_admin)
#   --display-name <name>   Tenant display name (default: derived from email)
#   --api-url <url>         API base URL (default: http://api-gateway.platform-services-dev.dev.local)
#   -h, --help              Show this help message
# ──────────────────────────────────────────────────────────────

# ── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ ${NC}$*"; }
success() { echo -e "${GREEN}✔ ${NC}$*"; }
warn()    { echo -e "${YELLOW}⚠ ${NC}$*"; }
error()   { echo -e "${RED}✖ ${NC}$*" >&2; }
header()  { echo -e "\n${BOLD}── $* ──${NC}"; }

# ── Defaults ──────────────────────────────────────────────────
TENANT_ID="acme"
TENANT_TIER="shared"
TENANT_ADMIN_EMAIL="yclawd@demo.io"
TENANT_ADMIN_PASS="admin123"
TENANT_ADMIN_ROLE="tenant_admin"
TENANT_DISPLAY_NAME=""
API_URL="http://api-gateway.platform-services-dev.dev.local"

# ── Arguments ─────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant-id)
      [[ $# -lt 2 ]] && { error "Missing value for --tenant-id"; exit 1; }
      TENANT_ID="$2"; shift 2 ;;
    --tenant-tier)
      [[ $# -lt 2 ]] && { error "Missing value for --tenant-tier"; exit 1; }
      TENANT_TIER="$2"; shift 2 ;;
    --email)
      [[ $# -lt 2 ]] && { error "Missing value for --email"; exit 1; }
      TENANT_ADMIN_EMAIL="$2"; shift 2 ;;
    --password)
      [[ $# -lt 2 ]] && { error "Missing value for --password"; exit 1; }
      TENANT_ADMIN_PASS="$2"; shift 2 ;;
    --role)
      [[ $# -lt 2 ]] && { error "Missing value for --role"; exit 1; }
      TENANT_ADMIN_ROLE="$2"; shift 2 ;;
    --display-name)
      [[ $# -lt 2 ]] && { error "Missing value for --display-name"; exit 1; }
      TENANT_DISPLAY_NAME="$2"; shift 2 ;;
    --api-url)
      [[ $# -lt 2 ]] && { error "Missing value for --api-url"; exit 1; }
      API_URL="$2"; shift 2 ;;
    -h|--help)
      sed -n '/^# Usage:/,/^# ──/p' "$0" | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *) error "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Config (derived from CLI args / defaults) ─────────────────
BASE_URL="${API_URL%/}"
API_BASE="${BASE_URL}/api"
KOURIER_HOST="Host: api-gateway.platform-services-dev.dev.local"

PLATFORM_ADMIN_EMAIL="admin@yoizen.io"
PLATFORM_ADMIN_PASS="yoizen-admin-change-me"

if [[ -z "$TENANT_DISPLAY_NAME" ]]; then
  TENANT_DISPLAY_NAME="${TENANT_ADMIN_EMAIL%%@*}"
fi

ADMIN_CONSOLE_URL="${BASE_URL}/admin-console"

# ── Helpers ───────────────────────────────────────────────────

json_get() {
  python3 -c "import sys, json; print(json.load(sys.stdin)$1)" 2>/dev/null
}

extract_token() {
  json_get "['access_token']"
}

login_with_retry() {
  local max_wait=${1:-0}
  local email="$2" password="$3" tenant="$4"
  local body elapsed=0 interval=3

  while true; do
    body=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/auth/login" \
      -H "${KOURIER_HOST}" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"tenant_id\":\"${tenant}\"}" \
    ) || true

    local http_code
    http_code=$(echo "$body" | tail -n1)
    body=$(echo "$body" | sed '$d')

    if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
      local token
      token=$(echo "$body" | extract_token)
      if [[ -n "$token" && "$token" != "None" ]]; then
        echo "$token"
        return 0
      fi
    fi

    elapsed=$((elapsed + interval))
    if (( elapsed >= max_wait )); then
      error "Login failed after ${max_wait}s (last HTTP ${http_code}):"
      echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
      return 1
    fi
    info "Login not ready (HTTP ${http_code}), retrying in ${interval}s... (${elapsed}/${max_wait}s)"
    sleep "$interval"
  done
}

# ── Verify API ────────────────────────────────────────────────
header "Verifying API at ${BASE_URL}"

http_code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "${KOURIER_HOST}" \
  "${BASE_URL}/health" 2>/dev/null || echo "000")
if [[ "$http_code" != "200" ]]; then
  error "API is not reachable (HTTP ${http_code})"
  error "Ensure Kourier is routing with the Host header — start the API first and try again."
  exit 1
fi
success "API is healthy"

# ── Platform admin login ─────────────────────────────────────
header "Platform admin login"

info "Logging in as ${PLATFORM_ADMIN_EMAIL}..."
PLATFORM_TOKEN=$(login_with_retry 30 "$PLATFORM_ADMIN_EMAIL" "$PLATFORM_ADMIN_PASS" "")
if [[ -z "$PLATFORM_TOKEN" ]]; then
  error "Failed to obtain platform admin token"
  exit 1
fi
success "Platform admin token obtained"

# ── Create tenant (idempotent) ───────────────────────────────
header "Create tenant '${TENANT_ID}'"

TENANT_LIST=$(curl -s \
  -H "${KOURIER_HOST}" \
  -H "Authorization: Bearer ${PLATFORM_TOKEN}" \
  -H "x-yoizen-tenant: ${TENANT_ID}" \
  "${API_BASE}/tenants" 2>/dev/null || echo "[]")

TENANT_EXISTS=false
if echo "$TENANT_LIST" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data if isinstance(data, list) else [data]
    for t in items:
        if t.get('name') == '${TENANT_ID}' or t.get('id') == '${TENANT_ID}':
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
  TENANT_EXISTS=true
fi

if [[ "$TENANT_EXISTS" == true ]]; then
  warn "Tenant '${TENANT_ID}' already exists — skipping"
else
  info "Creating tenant '${TENANT_ID}' (tier: ${TENANT_TIER})..."
  RESP=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/tenants" \
    -H "${KOURIER_HOST}" \
    -H "Authorization: Bearer ${PLATFORM_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "x-yoizen-tenant: ${TENANT_ID}" \
    -d "{\"name\":\"${TENANT_ID}\",\"tier\":\"${TENANT_TIER}\"}" 2>/dev/null)

  CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$CODE" == "200" || "$CODE" == "201" || "$CODE" == "202" ]]; then
    success "Tenant '${TENANT_ID}' created"

    # Extract status URL and wait for provisioning to complete
    STATUS_URL=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusUrl',''))" 2>/dev/null || echo "")
    if [[ -n "$STATUS_URL" ]]; then
      info "Waiting for tenant provisioning to complete..."
      elapsed=0 max_wait=60 interval=5
      while true; do
        STATUS_RESP=$(curl -s "${BASE_URL}${STATUS_URL}" \
          -H "${KOURIER_HOST}" \
          -H "Authorization: Bearer ${PLATFORM_TOKEN}" 2>/dev/null || echo "{}")
        PROV_STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('provisioningStatus',''))" 2>/dev/null || echo "")
        if [[ "$PROV_STATUS" == "ready" ]]; then
          success "Tenant provisioning complete"
          break
        fi
        elapsed=$((elapsed + interval))
        if (( elapsed >= max_wait )); then
          warn "Tenant provisioning not ready after ${max_wait}s (status: ${PROV_STATUS}) — continuing anyway"
          break
        fi
        info "Provisioning status: ${PROV_STATUS}... (${elapsed}/${max_wait}s)"
        sleep "$interval"
      done
    fi
  elif [[ "$CODE" == "409" ]]; then
    warn "Tenant '${TENANT_ID}' already exists (conflict) — continuing"
  else
    error "Failed to create tenant (HTTP ${CODE})"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 1
  fi
fi

# ── Create tenant admin user (idempotent) ────────────────────
header "Create tenant admin '${TENANT_ADMIN_EMAIL}'"

TENANT_USERS=$(curl -s \
  -H "${KOURIER_HOST}" \
  -H "Authorization: Bearer ${PLATFORM_TOKEN}" \
  -H "x-yoizen-tenant: ${TENANT_ID}" \
  "${API_BASE}/auth/tenant-users" 2>/dev/null || echo "[]")

USER_EXISTS=false
if echo "$TENANT_USERS" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    users = data if isinstance(data, list) else data.get('users', data.get('data', []))
    for u in users:
        if u.get('email') == '${TENANT_ADMIN_EMAIL}':
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
  USER_EXISTS=true
fi

if [[ "$USER_EXISTS" == true ]]; then
  warn "User '${TENANT_ADMIN_EMAIL}' already exists — skipping"
else
  info "Creating user '${TENANT_ADMIN_EMAIL}' (role: ${TENANT_ADMIN_ROLE})..."
  RESP=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/auth/tenant-users" \
    -H "${KOURIER_HOST}" \
    -H "Authorization: Bearer ${PLATFORM_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "x-yoizen-tenant: ${TENANT_ID}" \
    -d "{\"email\":\"${TENANT_ADMIN_EMAIL}\",\"password\":\"${TENANT_ADMIN_PASS}\",\"role_id\":\"${TENANT_ADMIN_ROLE}\",\"tenant_id\":\"${TENANT_ID}\"}" 2>/dev/null)

  CODE=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | sed '$d')

  if [[ "$CODE" == "200" || "$CODE" == "201" ]]; then
    success "User '${TENANT_ADMIN_EMAIL}' created"
  elif [[ "$CODE" == "409" ]]; then
    warn "User '${TENANT_ADMIN_EMAIL}' already exists (conflict) — continuing"
  else
    error "Failed to create user (HTTP ${CODE})"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 1
  fi
fi

# ── Verify tenant admin login ────────────────────────────────
header "Verify tenant admin login"

info "Testing login as ${TENANT_ADMIN_EMAIL}..."
TENANT_TOKEN=$(login_with_retry 10 "$TENANT_ADMIN_EMAIL" "$TENANT_ADMIN_PASS" "$TENANT_ID")
if [[ -z "$TENANT_TOKEN" ]]; then
  error "Tenant admin login verification failed"
  exit 1
fi
success "Tenant admin login verified"

# ── Credentials ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            🎉  Setup complete!                         ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Admin Console:${NC}   ${CYAN}${ADMIN_CONSOLE_URL}${NC}"
echo ""
echo -e "  ${BOLD}Platform Admin:${NC}"
echo -e "    Email:    ${PLATFORM_ADMIN_EMAIL}"
echo -e "    Password: ${PLATFORM_ADMIN_PASS}"
echo ""
echo -e "  ${BOLD}Tenant Admin (${TENANT_ID}):${NC}"
echo -e "    Email:    ${TENANT_ADMIN_EMAIL}"
echo -e "    Password: ${TENANT_ADMIN_PASS}"
echo -e "    Tenant:   ${TENANT_ID}"
echo ""
echo -e "  ${BOLD}Login Endpoint:${NC} ${CYAN}${API_BASE}/auth/login${NC}"
echo ""
