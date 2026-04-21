#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

ENVIRONMENT="${1:-dev}"
NAMESPACE="support-services-${ENVIRONMENT}"
STATEFULSET_NAME="postgres"
SECRET_NAME="postgres-credentials"
OUTPUT_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }

usage() {
  printf '%s\n' \
    "Usage: $0 [ENV]" \
    "" \
    "  ENV   Environment name (default: dev)" \
    "" \
    "Backs up the PostgreSQL database configured in postgres-credentials." \
    "Output format: PostgreSQL custom dump (.dump)." \
    "Output directory: ${OUTPUT_DIR}" \
    "" \
    "Examples:" \
    "  $0" \
    "  $0 qa"
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

main() {
  require_command kubectl

  if (( $# > 1 )); then
    err "Too many arguments."
    usage
    exit 1
  fi

  if (( $# == 1 )) && [[ "$1" == -* ]]; then
    err "Unknown option: $1"
    usage
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

  mkdir -p "$OUTPUT_DIR"

  local output_file
  output_file="${OUTPUT_DIR}/${db_name}-${ENVIRONMENT}-${TIMESTAMP}.dump"

  log "Creating backup for database '${db_name}' from namespace '${NAMESPACE}'"
  warn "Do not commit backup files. They are ignored via .gitignore (backups/)."

  kubectl exec \
    --namespace "$NAMESPACE" \
    "${STATEFULSET_NAME}-0" \
    -- env "PGPASSWORD=${db_password}" pg_dump \
    -U "$db_user" \
    -d "$db_name" \
    -F c \
    --no-owner \
    --no-privileges \
    > "$output_file"

  if [[ ! -s "$output_file" ]]; then
    err "Backup file is empty: ${output_file}"
    exit 1
  fi

  log "Backup completed: ${output_file}"
}

main "$@"
