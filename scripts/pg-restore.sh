#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
ENVIRONMENT="${2:-dev}"
NAMESPACE="support-services-${ENVIRONMENT}"
STATEFULSET_NAME="postgres"
SECRET_NAME="postgres-credentials"
ASSUME_YES="false"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

usage() {
  printf '%s\n' \
    "Usage: $0 <BACKUP_FILE> [ENV] [--yes]" \
    "" \
    "  BACKUP_FILE   Path to .dump file created by scripts/pg-backup.sh" \
    "  ENV           Environment name (default: dev)" \
    "  --yes, -y     Skip confirmation prompt" \
    "" \
    "Restores the backup into the database configured in postgres-credentials." \
    "This operation drops existing objects in the target database before restore." \
    "" \
    "Examples:" \
    "  $0 backups/yoizen-dev-20260408-153000.dump" \
    "  $0 backups/yoizen-dev-20260408-153000.dump qa" \
    "  $0 backups/yoizen-dev-20260408-153000.dump dev --yes"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command() {
  local cmd=$1
  if ! command -v "$cmd" &>/dev/null; then
    err "Required command not found: $cmd"
    exit 1
  fi
}

decode_base64() {
  if base64 --decode </dev/null >/dev/null 2>&1; then
    base64 --decode
  else
    base64 -D
  fi
}

get_secret_value() {
  local key=$1
  kubectl get secret "$SECRET_NAME" \
    --namespace "$NAMESPACE" \
    -o "jsonpath={.data.${key}}" | decode_base64
}

confirm_restore() {
  local db_name=$1

  if [[ "$ASSUME_YES" == "true" ]]; then
    warn "Skipping confirmation because --yes was provided."
    return 0
  fi

  echo ""
  warn "Restore confirmation"
  echo "  Namespace : ${NAMESPACE}"
  echo "  Database  : ${db_name}"
  echo "  File      : ${BACKUP_FILE}"
  echo ""
  warn "This will DROP existing objects in '${db_name}' and replace them."
  read -r -p "Continue? [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *)
      log "Restore cancelled."
      exit 0
      ;;
  esac
}

parse_args() {
  if (( $# < 1 || $# > 3 )); then
    err "Invalid arguments."
    usage
    exit 1
  fi

  BACKUP_FILE="$1"

  if (( $# >= 2 )); then
    case "$2" in
      --yes|-y)
        ASSUME_YES="true"
        ENVIRONMENT="dev"
        ;;
      -* )
        err "Unknown option: $2"
        usage
        exit 1
        ;;
      * )
        ENVIRONMENT="$2"
        ;;
    esac
  fi

  if (( $# == 3 )); then
    case "$3" in
      --yes|-y) ASSUME_YES="true" ;;
      * )
        err "Unknown option: $3"
        usage
        exit 1
        ;;
    esac
  fi

  NAMESPACE="support-services-${ENVIRONMENT}"
}

main() {
  require_command kubectl
  parse_args "$@"

  if [[ -z "$BACKUP_FILE" ]]; then
    err "Missing BACKUP_FILE argument."
    usage
    exit 1
  fi

  if [[ ! -f "$BACKUP_FILE" ]]; then
    err "Backup file not found: ${BACKUP_FILE}"
    exit 1
  fi

  if [[ "$BACKUP_FILE" != *.dump ]]; then
    err "Unsupported file format. Expected a .dump file."
    exit 1
  fi

  if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    err "Namespace '${NAMESPACE}' does not exist."
    exit 1
  fi

  if ! kubectl get statefulset "$STATEFULSET_NAME" --namespace "$NAMESPACE" &>/dev/null; then
    err "StatefulSet '${STATEFULSET_NAME}' not found in '${NAMESPACE}'."
    exit 1
  fi

  if ! kubectl get secret "$SECRET_NAME" --namespace "$NAMESPACE" &>/dev/null; then
    err "Secret '${SECRET_NAME}' not found in '${NAMESPACE}'."
    exit 1
  fi

  local db_name
  local db_user
  local db_password
  db_name="$(get_secret_value "POSTGRES_DB")"
  db_user="$(get_secret_value "POSTGRES_USER")"
  db_password="$(get_secret_value "POSTGRES_PASSWORD")"

  if [[ -z "$db_name" || -z "$db_user" || -z "$db_password" ]]; then
    err "Could not read PostgreSQL credentials from secret '${SECRET_NAME}'."
    exit 1
  fi

  confirm_restore "$db_name"

  log "Restoring '${BACKUP_FILE}' into database '${db_name}' (${NAMESPACE})"

  kubectl exec \
    --namespace "$NAMESPACE" \
    -i "${STATEFULSET_NAME}-0" \
    -- env "PGPASSWORD=${db_password}" pg_restore \
    -U "$db_user" \
    -d "$db_name" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    < "$BACKUP_FILE"

  log "Restore completed successfully."
}

main "$@"
