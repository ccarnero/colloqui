#!/usr/bin/env bash
# scale-all-to-one.sh — pin every Knative Service (API) and KEDA-managed
# worker Deployment in a namespace to exactly 1 replica, with a
# byte-for-byte reversible backup.
#
# Subcommands:
#   scale  [--namespace=NS] [--backup-dir=DIR] [--force]
#   revert [--namespace=NS] [--backup-dir=DIR]
#   status [--namespace=NS]
#
# Why two mechanisms (and not `kubectl scale`):
#   - KEDA owns worker Deployments' replica count. `kubectl scale` is
#     silently overridden on the next reconciliation. The idiomatic pin
#     is the `autoscaling.keda.sh/paused-replicas: "1"` annotation on the
#     ScaledObject; revert is `kubectl annotate ... paused-replicas-`.
#   - Knative Services do not expose `/scale`; the only knob is the
#     annotation pair on `spec.template.metadata.annotations`. Setting
#     `min-scale=1` AND `max-scale=1` pins the revision to exactly 1.
#
# Backup file shape (scripts/.scale-backup/<namespace>.json):
#   {
#     "namespace": "...",
#     "savedAt":   "...",
#     "ksvc":          { "<name>": { "minScale": "..."|null, "maxScale": "..."|null } },
#     "scaledobjects": { "<name>": { "pausedReplicas": "..."|null } }
#   }
# `null` is meaningful: "annotation was absent, remove on revert" — handled
# via JSON merge patch's null-deletes-key semantic for KSVCs and
# `kubectl annotate ... key-` for ScaledObjects.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_NAMESPACE="platform-services-dev"
DEFAULT_BACKUP_DIR="${SCRIPT_DIR}/.scale-backup"

KSVC_MIN_ANNOTATION="autoscaling.knative.dev/min-scale"
KSVC_MAX_ANNOTATION="autoscaling.knative.dev/max-scale"
KEDA_PAUSE_ANNOTATION="autoscaling.keda.sh/paused-replicas"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
info() { echo -e "${BLUE}[ ... ]${NC} $*"; }

usage() {
  cat <<EOF
Usage:
  $(basename "$0") scale  [--namespace=NS] [--backup-dir=DIR] [--force]
  $(basename "$0") revert [--namespace=NS] [--backup-dir=DIR]
  $(basename "$0") status [--namespace=NS]

Defaults:
  --namespace   ${DEFAULT_NAMESPACE}
  --backup-dir  ${DEFAULT_BACKUP_DIR}

Behavior:
  scale   Pins every Knative Service to min/max-scale=1 and every KEDA
          ScaledObject's target Deployment to paused-replicas=1.
          Refuses to run if a backup already exists for NS (unless
          --force is passed, which reuses the existing backup).
  revert  Restores prior min/max-scale annotations on KSVCs and removes
          paused-replicas on ScaledObjects (or restores the prior value).
          Deletes the backup file on success.
  status  Prints the current scaling state for NS.
EOF
}

require_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "Required command not found: $cmd"
    exit 127
  fi
}

parse_flags() {
  NAMESPACE="$DEFAULT_NAMESPACE"
  BACKUP_DIR="$DEFAULT_BACKUP_DIR"
  FORCE=false
  for arg in "$@"; do
    case "$arg" in
      --namespace=*)  NAMESPACE="${arg#*=}" ;;
      --backup-dir=*) BACKUP_DIR="${arg#*=}" ;;
      --force)        FORCE=true ;;
      -h|--help)      usage; exit 0 ;;
      *)
        err "Unknown flag: $arg"
        usage
        exit 2
        ;;
    esac
  done
  BACKUP_FILE="${BACKUP_DIR}/${NAMESPACE}.json"
}

ensure_namespace_exists() {
  if ! kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    err "Namespace not found: $NAMESPACE"
    exit 1
  fi
}

# Lists names (one per line) of every Knative Service in the namespace.
list_ksvcs() {
  kubectl get ksvc -n "$NAMESPACE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | awk 'NF'
}

# Lists names (one per line) of every KEDA ScaledObject in the namespace.
list_scaledobjects() {
  kubectl get scaledobject -n "$NAMESPACE" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | awk 'NF'
}

# Reads a single annotation value from a resource. Echoes the literal
# string `__ABSENT__` if missing, the value otherwise. We use a sentinel
# instead of empty-string because empty is a valid annotation value.
read_annotation() {
  local kind=$1 name=$2 path=$3 annotation=$4
  kubectl get "$kind" "$name" -n "$NAMESPACE" -o json 2>/dev/null \
    | jq -r --arg p "$path" --arg a "$annotation" '
        ($p | split(".")) as $pp
        | (getpath($pp) // {}) as $anns
        | ($anns[$a] // "__ABSENT__")
      '
}

# Builds the full backup JSON for the namespace and writes it to
# $BACKUP_FILE. Idempotent against repeated runs (overwrites).
build_backup_file() {
  local saved_at
  saved_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local ksvc_json='{}' so_json='{}'

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    local min_v max_v
    min_v="$(read_annotation ksvc "$name" 'spec.template.metadata.annotations' "$KSVC_MIN_ANNOTATION")"
    max_v="$(read_annotation ksvc "$name" 'spec.template.metadata.annotations' "$KSVC_MAX_ANNOTATION")"
    ksvc_json="$(
      jq --arg name "$name" --arg min "$min_v" --arg max "$max_v" '
        .[$name] = {
          minScale: (if $min == "__ABSENT__" then null else $min end),
          maxScale: (if $max == "__ABSENT__" then null else $max end)
        }
      ' <<< "$ksvc_json"
    )"
  done < <(list_ksvcs)

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    local pr_v
    pr_v="$(read_annotation scaledobject "$name" 'metadata.annotations' "$KEDA_PAUSE_ANNOTATION")"
    so_json="$(
      jq --arg name "$name" --arg pr "$pr_v" '
        .[$name] = {
          pausedReplicas: (if $pr == "__ABSENT__" then null else $pr end)
        }
      ' <<< "$so_json"
    )"
  done < <(list_scaledobjects)

  mkdir -p "$BACKUP_DIR"
  jq -n \
    --arg ns "$NAMESPACE" \
    --arg savedAt "$saved_at" \
    --argjson ksvc "$ksvc_json" \
    --argjson so "$so_json" \
    '{ namespace: $ns, savedAt: $savedAt, ksvc: $ksvc, scaledobjects: $so }' \
    > "$BACKUP_FILE"

  log "Backup written: $BACKUP_FILE"
}

# ------------------------------------------------------------------ scale --

cmd_scale() {
  ensure_namespace_exists

  if [[ -f "$BACKUP_FILE" && "$FORCE" != "true" ]]; then
    err "Backup already exists at $BACKUP_FILE."
    err "  Either run 'revert' first to restore prior state, or pass"
    err "  --force to reuse the existing backup as authoritative."
    exit 1
  fi

  if [[ ! -f "$BACKUP_FILE" ]]; then
    log "Capturing current scaling state for ns/$NAMESPACE..."
    build_backup_file
  else
    warn "--force: reusing existing backup at $BACKUP_FILE"
  fi

  local ksvc_count=0 so_count=0

  log "Pinning Knative Services to min=1 / max=1..."
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    info "ksvc/$name"
    kubectl patch ksvc "$name" -n "$NAMESPACE" --type=merge -p \
      "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"${KSVC_MIN_ANNOTATION}\":\"1\",\"${KSVC_MAX_ANNOTATION}\":\"1\"}}}}}" \
      >/dev/null
    ksvc_count=$((ksvc_count + 1))
  done < <(list_ksvcs)

  log "Pausing KEDA ScaledObjects at replicas=1..."
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    info "scaledobject/$name"
    kubectl annotate scaledobject "$name" -n "$NAMESPACE" \
      "${KEDA_PAUSE_ANNOTATION}=1" --overwrite >/dev/null
    so_count=$((so_count + 1))
  done < <(list_scaledobjects)

  log "Done. Pinned ${ksvc_count} Knative Service(s) and ${so_count} ScaledObject(s)."
  log "To restore prior state: $(basename "$0") revert --namespace=${NAMESPACE}"
}

# ----------------------------------------------------------------- revert --

cmd_revert() {
  ensure_namespace_exists

  if [[ ! -f "$BACKUP_FILE" ]]; then
    err "No backup found at $BACKUP_FILE — nothing to revert."
    exit 1
  fi

  log "Restoring scaling state from $BACKUP_FILE..."

  local ksvc_count=0 so_count=0

  # ksvc revert: rebuild the annotation block per service, using `null`
  # for absent originals so JSON merge patch deletes the key.
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue

    local patch
    patch="$(jq -c \
      --arg name "$name" \
      --arg min_key "$KSVC_MIN_ANNOTATION" \
      --arg max_key "$KSVC_MAX_ANNOTATION" \
      '
        .ksvc[$name] as $entry
        | if $entry == null then empty
          else
            { spec: { template: { metadata: { annotations: (
                ({} | .[$min_key] = $entry.minScale)
                | .[$max_key] = $entry.maxScale
            )}}}}
          end
      ' "$BACKUP_FILE")"

    if [[ -z "$patch" ]]; then
      warn "ksvc/$name not in backup, skipping"
      continue
    fi

    info "ksvc/$name"
    kubectl patch ksvc "$name" -n "$NAMESPACE" --type=merge -p "$patch" >/dev/null
    ksvc_count=$((ksvc_count + 1))
  done < <(list_ksvcs)

  # scaledobject revert: per the backup, either re-apply the original
  # paused-replicas value or delete the annotation entirely.
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue

    local original
    original="$(jq -r --arg name "$name" '
      .scaledobjects[$name].pausedReplicas // "__ABSENT_OR_MISSING__"
    ' "$BACKUP_FILE")"

    info "scaledobject/$name"
    if [[ "$original" == "__ABSENT_OR_MISSING__" ]]; then
      kubectl annotate scaledobject "$name" -n "$NAMESPACE" \
        "${KEDA_PAUSE_ANNOTATION}-" >/dev/null 2>&1 || true
    else
      kubectl annotate scaledobject "$name" -n "$NAMESPACE" \
        "${KEDA_PAUSE_ANNOTATION}=${original}" --overwrite >/dev/null
    fi
    so_count=$((so_count + 1))
  done < <(list_scaledobjects)

  rm -f "$BACKUP_FILE"
  log "Done. Reverted ${ksvc_count} Knative Service(s) and ${so_count} ScaledObject(s)."
  log "Backup file removed: $BACKUP_FILE"
}

# ----------------------------------------------------------------- status --

cmd_status() {
  ensure_namespace_exists

  printf "\n%-32s %-10s %-10s %-12s\n" "KSVC" "min-scale" "max-scale" "ready"
  printf "%s\n" "------------------------------------------------------------------------"
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    local minv maxv ready
    minv="$(read_annotation ksvc "$name" 'spec.template.metadata.annotations' "$KSVC_MIN_ANNOTATION")"
    maxv="$(read_annotation ksvc "$name" 'spec.template.metadata.annotations' "$KSVC_MAX_ANNOTATION")"
    ready="$(kubectl get ksvc "$name" -n "$NAMESPACE" \
      -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "?")"
    [[ "$minv" == "__ABSENT__" ]] && minv="-"
    [[ "$maxv" == "__ABSENT__" ]] && maxv="-"
    printf "%-32s %-10s %-10s %-12s\n" "$name" "$minv" "$maxv" "${ready:-?}"
  done < <(list_ksvcs)

  printf "\n%-40s %-18s %-12s\n" "ScaledObject" "paused-replicas" "target-replicas"
  printf "%s\n" "------------------------------------------------------------------------"
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    local prv target replicas
    prv="$(read_annotation scaledobject "$name" 'metadata.annotations' "$KEDA_PAUSE_ANNOTATION")"
    target="$(kubectl get scaledobject "$name" -n "$NAMESPACE" \
      -o jsonpath='{.spec.scaleTargetRef.name}' 2>/dev/null || echo "")"
    if [[ -n "$target" ]]; then
      replicas="$(kubectl get deploy "$target" -n "$NAMESPACE" \
        -o jsonpath='{.spec.replicas}/{.status.readyReplicas}' 2>/dev/null || echo "?/?")"
    else
      replicas="?/?"
    fi
    [[ "$prv" == "__ABSENT__" ]] && prv="-"
    printf "%-40s %-18s %-12s\n" "$name" "$prv" "$replicas"
  done < <(list_scaledobjects)

  if [[ -f "$BACKUP_FILE" ]]; then
    printf "\n"
    log "Backup present: $BACKUP_FILE"
  else
    printf "\n"
    info "No backup file at $BACKUP_FILE (nothing to revert)."
  fi
}

# -------------------------------------------------------------------- main --

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 2
  fi

  local subcommand=$1
  shift

  require_cmd kubectl
  require_cmd jq

  parse_flags "$@"

  case "$subcommand" in
    scale)  cmd_scale ;;
    revert) cmd_revert ;;
    status) cmd_status ;;
    -h|--help|help) usage ;;
    *)
      err "Unknown subcommand: $subcommand"
      usage
      exit 2
      ;;
  esac
}

main "$@"
