#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-dev}"
PLATFORM_DB="${POSTGRES_DB:-yoizen}"
PLATFORM_HOST="${POSTGRES_HOST:-postgres.support-services-${ENVIRONMENT}.svc.cluster.local}"
PLATFORM_PORT="${POSTGRES_PORT:-5432}"
PLATFORM_USER="${POSTGRES_USER:-yoizen}"
PLATFORM_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

SHARED_HOST="${TENANT_POSTGRES_SHARED_HOST:-postgres-shared.support-services-${ENVIRONMENT}.svc.cluster.local}"
SHARED_PORT="${TENANT_POSTGRES_SHARED_PORT:-5432}"
SHARED_ADMIN_DB="${TENANT_POSTGRES_SHARED_ADMIN_DB:-postgres}"
SHARED_ADMIN_USER="${TENANT_POSTGRES_SHARED_ADMIN_USER:-${PLATFORM_USER}}"
SHARED_ADMIN_PASSWORD="${TENANT_POSTGRES_SHARED_ADMIN_PASSWORD:-${PLATFORM_PASSWORD}}"
SHARED_TENANT_PASSWORD="${TENANT_POSTGRES_SHARED_PASSWORD:-${PLATFORM_PASSWORD}}"
DEFAULT_TIER="${TENANT_POSTGRES_DEFAULT_TIER:-shared}"
APPLY_DATA_COPY="false"

usage() {
  printf '%s\n' \
    "Usage: ENVIRONMENT=dev POSTGRES_PASSWORD=... $0 [--apply-data-copy]" \
    "" \
    "Creates shared tenant_<slug> databases/roles for tenants whose tier is shared." \
    "No existing dedicated database, namespace, StatefulSet, table, or row is deleted." \
    "" \
    "Set --apply-data-copy to run a non-clean pg_dump | pg_restore pipeline." \
    "Without it, the script prints the copy commands that would be run."
}

while (( $# > 0 )); do
  case "$1" in
    --apply-data-copy) APPLY_DATA_COPY="true" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

tenant_db_name() {
  printf 'tenant_%s' "$1"
}

tenant_role_name() {
  printf '%s_app' "$(tenant_db_name "$1")"
}

psql_platform() {
  PGPASSWORD="$PLATFORM_PASSWORD" psql \
    --host "$PLATFORM_HOST" \
    --port "$PLATFORM_PORT" \
    --username "$PLATFORM_USER" \
    --dbname "$PLATFORM_DB" \
    --set ON_ERROR_STOP=1 \
    "$@"
}

psql_shared_admin() {
  PGPASSWORD="$SHARED_ADMIN_PASSWORD" psql \
    --host "$SHARED_HOST" \
    --port "$SHARED_PORT" \
    --username "$SHARED_ADMIN_USER" \
    --dbname "$SHARED_ADMIN_DB" \
    --set ON_ERROR_STOP=1 \
    "$@"
}

psql_shared_db() {
  local database=$1
  shift
  PGPASSWORD="$SHARED_ADMIN_PASSWORD" psql \
    --host "$SHARED_HOST" \
    --port "$SHARED_PORT" \
    --username "$SHARED_ADMIN_USER" \
    --dbname "$database" \
    --set ON_ERROR_STOP=1 \
    "$@"
}

ensure_tier_column() {
  psql_platform <<SQL
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'shared';
ALTER TABLE tenants ALTER COLUMN tier SET DEFAULT 'shared';
UPDATE tenants SET tier = 'shared' WHERE tier IS NULL;
DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_tier_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_tier_check
      CHECK (tier IN ('shared', 'dedicated'));
  END IF;
END \$\$;
SQL
}

ensure_shared_database() {
  local tenant=$1
  local database
  local role
  database="$(tenant_db_name "$tenant")"
  role="$(tenant_role_name "$tenant")"

  if psql_shared_admin --tuples-only --no-align \
    --set tenant_role="$role" \
    -c "SELECT 1 FROM pg_roles WHERE rolname = :'tenant_role'" | grep -qx "1"; then
    psql_shared_admin \
      --set tenant_role="$role" \
      --set tenant_password="$SHARED_TENANT_PASSWORD" \
      -c "ALTER ROLE :\"tenant_role\" LOGIN PASSWORD :'tenant_password'"
  else
    psql_shared_admin \
      --set tenant_role="$role" \
      --set tenant_password="$SHARED_TENANT_PASSWORD" \
      -c "CREATE ROLE :\"tenant_role\" LOGIN PASSWORD :'tenant_password'"
  fi

  if ! psql_shared_admin --tuples-only --no-align \
    --set tenant_database="$database" \
    -c "SELECT 1 FROM pg_database WHERE datname = :'tenant_database'" | grep -qx "1"; then
    psql_shared_admin \
      --set tenant_database="$database" \
      --set tenant_role="$role" \
      -c "CREATE DATABASE :\"tenant_database\" OWNER :\"tenant_role\""
  fi

  psql_shared_db "$database" \
    --set tenant_database="$database" \
    --set tenant_role="$role" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
GRANT CONNECT ON DATABASE :"tenant_database" TO :"tenant_role";
GRANT USAGE, CREATE ON SCHEMA public TO :"tenant_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"tenant_role";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"tenant_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"tenant_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"tenant_role";
SQL
}

copy_command_for_tenant() {
  local tenant=$1
  local database
  database="$(tenant_db_name "$tenant")"
  printf 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --host "postgres.%s-%s-ns.svc.cluster.local" --port 5432 --username "%s" --dbname "%s" --format custom --no-owner --no-privileges | PGPASSWORD="$TENANT_POSTGRES_SHARED_ADMIN_PASSWORD" pg_restore --host "%s" --port "%s" --username "%s" --dbname "%s" --no-owner --no-privileges\n' \
    "$tenant" "$ENVIRONMENT" "$PLATFORM_USER" "$PLATFORM_DB" \
    "$SHARED_HOST" "$SHARED_PORT" "$SHARED_ADMIN_USER" "$database"
}

copy_data_if_requested() {
  local tenant=$1
  local database
  database="$(tenant_db_name "$tenant")"
  if [[ "$APPLY_DATA_COPY" != "true" ]]; then
    copy_command_for_tenant "$tenant"
    return
  fi
  PGPASSWORD="$PLATFORM_PASSWORD" pg_dump \
    --host "postgres.${tenant}-${ENVIRONMENT}-ns.svc.cluster.local" \
    --port 5432 \
    --username "$PLATFORM_USER" \
    --dbname "$PLATFORM_DB" \
    --format custom \
    --no-owner \
    --no-privileges \
    | PGPASSWORD="$SHARED_ADMIN_PASSWORD" pg_restore \
      --host "$SHARED_HOST" \
      --port "$SHARED_PORT" \
      --username "$SHARED_ADMIN_USER" \
      --dbname "$database" \
      --no-owner \
      --no-privileges
}

main() {
  require_command psql
  require_command pg_dump
  require_command pg_restore
  if [[ "$APPLY_DATA_COPY" == "true" ]]; then
    echo "Data copy enabled. Restore is non-clean and will not drop target objects."
  fi

  ensure_tier_column

  mapfile -t tenants < <(
    psql_platform --tuples-only --no-align \
      --set default_tier="$DEFAULT_TIER" \
      -c "SELECT name FROM tenants WHERE COALESCE(tier, :'default_tier') = 'shared' ORDER BY name"
  )

  for tenant in "${tenants[@]}"; do
    [[ -z "$tenant" ]] && continue
    echo "Ensuring shared PostgreSQL database for tenant: $tenant"
    ensure_shared_database "$tenant"
    copy_data_if_requested "$tenant"
  done
}

main "$@"
