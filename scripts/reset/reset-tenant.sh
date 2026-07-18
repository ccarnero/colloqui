#!/usr/bin/env bash
# reset-tenant.sh — manifest-from-zero wipe of a tenant's resource
# *definitions* (workflows, agents, channel accounts, adapters, etc.) plus
# the platform-wide tracking traces table.
#
# Use case: you want to `yoizen manifests apply` a manifest.yaml against a
# tenant that has NO prior resources (a true "create everything" run).
# `scripts/reset/reset-dev.ts` deliberately does NOT reach this: it only
# truncates DATA tables (messages/events/runs), never resource
# DEFINITIONS. See `scripts/reset/INVENTORY.md`'s "Manifest-from-zero"
# section for the full table list and the audit behind it.
#
# What it does:
#   Step A — TRUNCATE the tenant's Postgres resource-definition tables
#     (workflow_definitions, agents, channel_accounts, ... — full list
#     below) inside `tenant_<name>` via `kubectl exec` into the
#     postgres-shared CNPG primary. Preserves tenant_users, tenant_roles,
#     tenant_role_permissions, credentials so login/RBAC used to run the
#     next `apply` survives.
#   Step B — TRUNCATE `tracking.tracked_events` on the platform DB
#     (postgres-0), per README.md § 2.
#
# What it preserves (NEVER touched):
#   tenant_users, tenant_roles, tenant_role_permissions, credentials
#
# Subcommands: (none — always runs both steps A and B)
#
# Flags:
#   --tenant=NAME   tenant to wipe (default: $TENANT from .env, else "acme")
#   --dry-run       (default) print row counts per table, truncate nothing
#   --apply         actually truncate
#   --yes / -y      skip the interactive confirmation
#   --namespace=NS  k8s namespace (default: $RESET_NAMESPACE from .env,
#                     else support-services-dev)
#   --context=CTX   kubectl context (default: $KUBECTL_CONTEXT from .env,
#                     else orbstack)
#
# Exit codes:
#   0  wipe succeeded (or dry-run finished)
#   1  a TRUNCATE step failed
#   2  bad input / preflight failed before any mutation

set -euo pipefail

# ----- load .env (if present) ------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/.env"
  set +a
fi

# ----- defaults --------------------------------------------------------------

DEFAULT_TENANT="${TENANT:-acme}"
DEFAULT_NAMESPACE="${RESET_NAMESPACE:-support-services-dev}"
DEFAULT_CONTEXT="${KUBECTL_CONTEXT:-orbstack}"
DEFAULT_TENANT_PG_POD="${TENANT_POSTGRES_SHARED_POD:-postgres-shared-1}"
DEFAULT_TENANT_PG_USER="${TENANT_POSTGRES_SHARED_PG_USER:-postgres}"
DEFAULT_TRACKING_PG_POD="${TRACKING_POSTGRES_POD:-postgres-0}"
DEFAULT_TRACKING_PG_USER="${TRACKING_POSTGRES_USER:-yoizen}"
DEFAULT_TRACKING_PG_DB="${TRACKING_POSTGRES_DB:-yoizen}"

# ----- color logging ---------------------------------------------------------

# ANSI-C ($'...') quoting so these hold the REAL ESC byte, not the literal
# 4-character sequence "\033" — required so `cat <<EOF` heredocs (e.g.
# print_post_wipe_caveats below) render color too. A plain '\033[...' single
# quote only happens to render correctly through `echo -e` (which parses the
# backslash escape itself); heredocs never do that parsing, so they used to
# print the literal escape-code text instead of coloring it.
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'
NC=$'\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*"; }
info() { echo -e "${BLUE}[ ... ]${NC} $*"; }

# ----- tenant resource-definition tables (INVENTORY.md, Manifest-from-zero) --
# Preserves tenant_users, tenant_roles, tenant_role_permissions, credentials.

TENANT_DEFINITION_TABLES=(
  workflow_definitions
  http_adapters
  adapter_endpoints
  agents
  agent_versions
  channel_accounts
  knowledge_bases
  documents
  document_chunks
  document_chunks_embedding
  kb_document_checksums
  mcp_servers
  manifest_revisions
  system_variables
  skills
  jobs
  config_files
  auto_reply_rules
)

# ----- usage ------------------------------------------------------------------

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [flags]

Defaults:
  --tenant     ${DEFAULT_TENANT}
  --namespace  ${DEFAULT_NAMESPACE}
  --context    ${DEFAULT_CONTEXT}

Examples:
  # Dry-run (default): print row counts, truncate nothing
  ./scripts/reset/reset-tenant.sh --tenant acme

  # Actually wipe (asks for confirmation)
  ./scripts/reset/reset-tenant.sh --tenant acme --apply

  # Non-interactive (CI / scripted)
  ./scripts/reset/reset-tenant.sh --tenant acme --apply --yes

Behavior:
  Step A: TRUNCATE ... CASCADE on ${#TENANT_DEFINITION_TABLES[@]} resource
          definition tables in tenant_<name> (postgres-shared CNPG
          primary). PRESERVES tenant_users, tenant_roles,
          tenant_role_permissions, credentials.
  Step B: TRUNCATE tracking.tracked_events on the platform DB
          (postgres-0 / yoizen).

Post-wipe caveats (printed again after --apply):
  - The Telegram webhook is NOT restored; the old channel account no
    longer exists. Re-register it by hand, see
    integrations/channels/telegram-transform-reply/README.md
    § "Run / exercise".
  - Re-provision the tenant with \`yoizen manifests apply\`; the next
    \`yoizen manifests plan\` will show every resource as \`create\`
    (expected for a blank tenant, not a bug).
EOF
}

# ----- arg parsing -------------------------------------------------------------

TENANT_NAME="$DEFAULT_TENANT"
NAMESPACE="$DEFAULT_NAMESPACE"
CONTEXT="$DEFAULT_CONTEXT"
DRY_RUN=true
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant=*)    TENANT_NAME="${1#*=}"; shift ;;
    --tenant)      TENANT_NAME="$2"; shift 2 ;;
    --namespace=*) NAMESPACE="${1#*=}"; shift ;;
    --namespace)   NAMESPACE="$2"; shift 2 ;;
    --context=*)   CONTEXT="${1#*=}"; shift ;;
    --context)     CONTEXT="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --apply)       DRY_RUN=false; shift ;;
    -y|--yes)      ASSUME_YES=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)
      err "Unknown flag: $1"
      usage
      exit 2
      ;;
  esac
done

TENANT_DB="tenant_${TENANT_NAME}"
KCTL=(kubectl --context "$CONTEXT" -n "$NAMESPACE")

# ----- preflight ---------------------------------------------------------------

require_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 2
  fi
}
require_cmd kubectl

ensure_namespace_exists() {
  if ! "${KCTL[@]}" get ns "$NAMESPACE" >/dev/null 2>&1; then
    err "Namespace not found: $NAMESPACE"
    exit 2
  fi
}

ensure_pod_exists() {
  local pod=$1
  if ! "${KCTL[@]}" get pod "$pod" >/dev/null 2>&1; then
    err "Pod not found: ${NAMESPACE}/${pod}"
    exit 2
  fi
}

# ----- psql plumbing -------------------------------------------------------------

psql_tenant() {
  # Usage: psql_tenant <sql...>
  "${KCTL[@]}" exec -i "$DEFAULT_TENANT_PG_POD" -c postgres -- \
    psql -U "$DEFAULT_TENANT_PG_USER" -d "$TENANT_DB" -v ON_ERROR_STOP=1 "$@"
}

psql_tracking() {
  # Usage: psql_tracking <sql...>
  "${KCTL[@]}" exec -i "$DEFAULT_TRACKING_PG_POD" -c postgres -- \
    psql -U "$DEFAULT_TRACKING_PG_USER" -d "$DEFAULT_TRACKING_PG_DB" \
    -v ON_ERROR_STOP=1 "$@"
}

print_tenant_counts() {
  log "Row counts in ${TENANT_DB} (pod=${DEFAULT_TENANT_PG_POD}):"
  local sql="" first=true
  for t in "${TENANT_DEFINITION_TABLES[@]}"; do
    if [[ "$first" == "true" ]]; then
      sql+="SELECT '${t}'::text AS tbl, COUNT(*)::bigint AS rows FROM ${t}"
      first=false
    else
      sql+=" UNION ALL SELECT '${t}'::text, COUNT(*)::bigint FROM ${t}"
    fi
  done
  sql+=" ORDER BY tbl;"
  psql_tenant -At -F $'\t' -c "$sql" 2>/dev/null | while IFS=$'\t' read -r tbl rows; do
    [[ -z "$tbl" ]] && continue
    printf '  %-32s %10s\n' "$tbl" "$rows"
  done
}

print_tracking_count() {
  log "Row count in tracking.tracked_events (pod=${DEFAULT_TRACKING_PG_POD}):"
  psql_tracking -At -c "SELECT COUNT(*) FROM tracking.tracked_events;" 2>/dev/null \
    | while read -r rows; do printf '  %-32s %10s\n' "tracking.tracked_events" "$rows"; done
}

confirm() {
  if [[ "$ASSUME_YES" == "true" ]]; then
    return 0
  fi
  cat <<EOF

This will TRUNCATE ... CASCADE on ${#TENANT_DEFINITION_TABLES[@]} resource
definition table(s) in ${TENANT_DB} (pod=${DEFAULT_TENANT_PG_POD}), PLUS
tracking.tracked_events on ${DEFAULT_TRACKING_PG_DB} (pod=${DEFAULT_TRACKING_PG_POD}).

PRESERVED (never touched): tenant_users, tenant_roles,
tenant_role_permissions, credentials.

EOF
  read -r -p "Type 'yes' to proceed: " answer
  if [[ "$answer" != "yes" ]]; then
    err "Aborted."
    exit 1
  fi
}

print_post_wipe_caveats() {
  cat <<EOF

${YELLOW}Post-wipe caveats:${NC}
  1. The Telegram webhook is NOT restored — the old channel account no
     longer exists. Re-register it by hand, see
     integrations/channels/telegram-transform-reply/README.md
     § "Run / exercise".
  2. Re-provision with \`yoizen manifests apply\`; the next
     \`yoizen manifests plan\` shows every resource as \`create\`
     (expected for a blank tenant, not a bug).

EOF
}

main() {
  ensure_namespace_exists
  ensure_pod_exists "$DEFAULT_TENANT_PG_POD"
  ensure_pod_exists "$DEFAULT_TRACKING_PG_POD"

  log "Tenant: ${TENANT_NAME} (db=${TENANT_DB})"
  log "Mode: $([[ "$DRY_RUN" == "true" ]] && echo "DRY-RUN (default)" || echo "APPLY")"

  if [[ "$DRY_RUN" == "true" ]]; then
    print_tenant_counts
    print_tracking_count
    log "DRY-RUN complete. Re-run with --apply to actually truncate."
    return 0
  fi

  confirm

  log "Step A: truncating ${#TENANT_DEFINITION_TABLES[@]} definition table(s) in ${TENANT_DB}"
  local table_list
  table_list=$(IFS=,; echo "${TENANT_DEFINITION_TABLES[*]}")
  if ! echo "TRUNCATE ${table_list} CASCADE;" | psql_tenant; then
    err "Step A (tenant definitions) FAILED"
    exit 1
  fi
  log "Step A complete."

  log "Step B: truncating tracking.tracked_events"
  if ! echo "TRUNCATE tracking.tracked_events;" | psql_tracking; then
    err "Step B (tracking traces) FAILED"
    exit 1
  fi
  log "Step B complete."

  print_post_wipe_caveats
  log "reset-tenant.sh complete."
}

main
