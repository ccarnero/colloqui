#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# rebuild-changed.sh — detect changed services, pick interactively, rebuild+redeploy
# =============================================================================
#
# Looks at what you changed in git, maps those files to the services that need
# rebuilding (using the SAME path rules as the Tiltfile, including shared-package
# fan-out), shows an interactive checklist with the changed services pre-checked,
# and on confirm rebuilds + redeploys each selected service by delegating to the
# existing ./rebuild-redeploy.sh (build image + Knative/worker rollout).
#
# Nothing else is modified — infrastructure (postgres, redis, nats, temporal) is
# never touched, and this script only orchestrates rebuild-redeploy.sh.
#
# Change detection (default): uncommitted local edits — staged + unstaged +
# untracked, i.e. `git diff HEAD` + untracked files. Use --since <ref> to also
# include everything committed since a ref/branch (e.g. --since origin/main).
#
# Usage:
#   ./rebuild-changed.sh                       # detect + pick + rebuild (env=dev)
#   ./rebuild-changed.sh qa                    # target env=qa
#   ./rebuild-changed.sh --since origin/main   # changes vs main branch too
#   ./rebuild-changed.sh --all                 # list ALL services to choose from
#   ./rebuild-changed.sh --yes                 # non-interactive: rebuild all detected
#   ./rebuild-changed.sh --dry-run             # just show what changed, do nothing
#   ./rebuild-changed.sh --no-cache            # passthrough: bust docker cache
#
# Interactive keys:
#   <numbers>  toggle those entries (e.g. "1 3 5")
#   a          select all      n  select none      i  invert
#   <Enter>    confirm current selection
#   q          quit without doing anything
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REBUILD_SCRIPT="${SCRIPT_DIR}/rebuild-redeploy.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }
bold() { echo -e "${BOLD}$*${NC}"; }

VALID_ENVIRONMENTS=(dev qa staging production)

# ── Service lists sourced from single source of truth ────────────────────────
source "${SCRIPT_DIR}/services.conf"
ORDERED_SERVICES=($YZ_SERVICES)
TESTING_SVCS="$YZ_TESTING_SVCS"
CORE_SVCS="$YZ_CORE_SVCS"
NO_DB_SVCS="$YZ_NODB_SVCS"
NESTJS_ALL="$YZ_NESTJS_ALL"
DB_SVCS="$YZ_DB_SVCS"

# ── Argument parsing ──────────────────────────────────────────────────────────
ENVIRONMENT="dev"
SINCE_REF=""
SHOW_ALL="false"
ASSUME_YES="false"
DRY_RUN="false"
NO_CACHE=""

usage() { sed -n '3,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while (( $# > 0 )); do
  case "$1" in
    -h|--help)     usage; exit 0 ;;
    --since)       SINCE_REF="${2:-}"; [[ -z "$SINCE_REF" ]] && { err "--since needs a git ref"; exit 1; }; shift 2 ;;
    --since=*)     SINCE_REF="${1#*=}"; shift ;;
    --all)         SHOW_ALL="true"; shift ;;
    -y|--yes)      ASSUME_YES="true"; shift ;;
    --dry-run)     DRY_RUN="true"; shift ;;
    --no-cache)    NO_CACHE="--no-cache"; shift ;;
    dev|qa|staging|production) ENVIRONMENT="$1"; shift ;;
    -*)            err "Unknown option: $1"; usage; exit 1 ;;
    *)             err "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

is_known_service() {
  local needle="$1" s
  for s in "${ORDERED_SERVICES[@]}"; do [[ "$s" == "$needle" ]] && return 0; done
  return 1
}

# ── Collect the list of changed files from git ────────────────────────────────
collect_changed_files() {
  if ! git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
    err "Not inside a git repository: ${SCRIPT_DIR}"
    exit 1
  fi

  {
    # Uncommitted: staged + unstaged (tracked) relative to HEAD
    git -C "$SCRIPT_DIR" diff --name-only HEAD 2>/dev/null || true
    # Untracked, honoring .gitignore
    git -C "$SCRIPT_DIR" ls-files --others --exclude-standard 2>/dev/null || true
    # Optional: everything committed since a ref/branch
    if [[ -n "$SINCE_REF" ]]; then
      if git -C "$SCRIPT_DIR" rev-parse --verify --quiet "$SINCE_REF" >/dev/null; then
        git -C "$SCRIPT_DIR" diff --name-only "${SINCE_REF}...HEAD" 2>/dev/null \
          || git -C "$SCRIPT_DIR" diff --name-only "${SINCE_REF}" HEAD 2>/dev/null || true
      else
        warn "--since ref '${SINCE_REF}' not found — ignoring it"
      fi
    fi
  } | sed '/^$/d' | sort -u
}

# ── Map one changed path to the services it affects ───────────────────────────
# Emits "service<TAB>reason" lines (a single path can affect several services).
map_path_to_services() {
  local path="$1" svc
  case "$path" in
    services/*/*|services/*)
      svc="${path#services/}"; svc="${svc%%/*}"
      if is_known_service "$svc"; then printf '%s\t%s\n' "$svc" "services/${svc}"; fi
      ;;
    packages/shared/*)         for svc in $NESTJS_ALL; do printf '%s\t%s\n' "$svc" "packages/shared"; done ;;
    packages/observability/*)  for svc in $NESTJS_ALL; do printf '%s\t%s\n' "$svc" "packages/observability"; done ;;
    packages/database/*)       for svc in $DB_SVCS;    do printf '%s\t%s\n' "$svc" "packages/database"; done ;;
    packages/testing/*)        for svc in $TESTING_SVCS; do printf '%s\t%s\n' "$svc" "packages/testing"; done ;;
    packages/angular-shared/*) printf '%s\t%s\n' "admin-console" "packages/angular-shared" ;;
    package.json)              for svc in $NESTJS_ALL; do printf '%s\t%s\n' "$svc" "package.json (root)"; done ;;
    *) : ;;  # infra/knative/docs/etc → no image rebuild
  esac
}

# ── Build detection: unique services + a human-readable reason per service ─────
DETECT_FILE="$(mktemp -t rebuild-detect-XXXXXX)"
REASON_FILE="$(mktemp -t rebuild-reason-XXXXXX)"
RELEVANT_FILE="$(mktemp -t rebuild-relevant-XXXXXX)"
cleanup() { rm -f "$DETECT_FILE" "$REASON_FILE" "$RELEVANT_FILE" 2>/dev/null || true; }
trap cleanup EXIT

CHANGED_FILES="$(collect_changed_files)"
TOTAL_CHANGED=0
[[ -n "$CHANGED_FILES" ]] && TOTAL_CHANGED="$(printf '%s\n' "$CHANGED_FILES" | sed '/^$/d' | wc -l | tr -d ' ')"

# For each changed path, record the services it maps to (DETECT_FILE) and, when
# it maps to at least one service, the path itself (RELEVANT_FILE) so the report
# only surfaces files that actually drive a rebuild — not every untracked file.
if [[ -n "$CHANGED_FILES" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    mapped="$(map_path_to_services "$f")"
    if [[ -n "$mapped" ]]; then
      printf '%s\n' "$mapped" >> "$DETECT_FILE"
      printf '%s\n' "$f" >> "$RELEVANT_FILE"
    fi
  done <<< "$CHANGED_FILES"
fi

# Unique services (in canonical order), and reason string per service.
DETECTED_SVCS=()
if [[ -s "$DETECT_FILE" ]]; then
  for svc in "${ORDERED_SERVICES[@]}"; do
    if grep -q "^${svc}	" "$DETECT_FILE"; then
      DETECTED_SVCS+=("$svc")
      # collect distinct reasons, comma-joined
      reason="$(awk -F'\t' -v s="$svc" '$1==s{print $2}' "$DETECT_FILE" | sort -u | paste -sd, -)"
      printf '%s\t%s\n' "$svc" "$reason" >> "$REASON_FILE"
    fi
  done
fi

reason_for() { awk -F'\t' -v s="$1" '$1==s{print $2}' "$REASON_FILE"; }

# ── Report what changed ───────────────────────────────────────────────────────
bold "\n╔══════════════════════════════════════════════╗"
bold "║   Rebuild changed services — Yoizen Platform   ║"
bold "╚══════════════════════════════════════════════╝"
log "Environment   : ${ENVIRONMENT}"
log "Baseline      : uncommitted edits${SINCE_REF:+ + since ${SINCE_REF}}"
RELEVANT_COUNT=0
[[ -s "$RELEVANT_FILE" ]] && RELEVANT_COUNT="$(wc -l < "$RELEVANT_FILE" | tr -d ' ')"
log "Changed files : ${TOTAL_CHANGED} total, ${RELEVANT_COUNT} affecting services"
echo ""

if [[ -s "$RELEVANT_FILE" ]]; then
  step "Relevant changed paths:"
  sort -u "$RELEVANT_FILE" | sed 's/^/    /'
  echo ""
fi

if (( ${#DETECTED_SVCS[@]} == 0 )) && [[ "$SHOW_ALL" != "true" ]]; then
  warn "No changed services detected from the current diff."
  warn "Re-run with --all to pick from every service, or --since <ref> to widen the diff."
  exit 0
fi

step "Services needing rebuild:"
if (( ${#DETECTED_SVCS[@]} == 0 )); then
  echo "    (none detected)"
else
  for svc in "${DETECTED_SVCS[@]}"; do
    printf "    %-26s ⟵ %s\n" "$svc" "$(reason_for "$svc")"
  done
fi
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  log "--dry-run: nothing built or deployed."
  exit 0
fi

# ── Build the candidate menu ──────────────────────────────────────────────────
# Default: only detected services (pre-checked). With --all: every service,
# detected ones pre-checked, the rest unchecked.
MENU_SVCS=()
MENU_SELECTED=()
is_detected() { local n="$1" s; for s in "${DETECTED_SVCS[@]:-}"; do [[ "$s" == "$n" ]] && return 0; done; return 1; }

if [[ "$SHOW_ALL" == "true" ]]; then
  for svc in "${ORDERED_SERVICES[@]}"; do
    MENU_SVCS+=("$svc")
    if is_detected "$svc"; then MENU_SELECTED+=("1"); else MENU_SELECTED+=("0"); fi
  done
else
  for svc in "${DETECTED_SVCS[@]}"; do
    MENU_SVCS+=("$svc"); MENU_SELECTED+=("1")
  done
fi

print_menu() {
  echo ""
  bold "Select services to rebuild + redeploy (env: ${ENVIRONMENT}):"
  local i
  for i in "${!MENU_SVCS[@]}"; do
    local box="[ ]"; [[ "${MENU_SELECTED[$i]}" == "1" ]] && box="[${GREEN}x${NC}]"
    local r=""; is_detected "${MENU_SVCS[$i]}" && r="  ${CYAN}⟵ $(reason_for "${MENU_SVCS[$i]}")${NC}"
    printf "  %2d) %b %-26s%b\n" "$((i+1))" "$box" "${MENU_SVCS[$i]}" "$r"
  done
  echo ""
  echo -e "  ${BOLD}[numbers]${NC} toggle   ${BOLD}a${NC} all   ${BOLD}n${NC} none   ${BOLD}i${NC} invert   ${BOLD}<Enter>${NC} confirm   ${BOLD}q${NC} quit"
}

# ── Interactive selection loop (skipped with --yes) ───────────────────────────
if [[ "$ASSUME_YES" != "true" ]]; then
  while true; do
    print_menu
    printf "  > "
    read -r line || { echo ""; line="q"; }

    case "$line" in
      "")  break ;;
      q|Q) log "Aborted — nothing built or deployed."; exit 0 ;;
      a|A) local_i=0; for local_i in "${!MENU_SELECTED[@]}"; do MENU_SELECTED[$local_i]="1"; done ;;
      n|N) local_i=0; for local_i in "${!MENU_SELECTED[@]}"; do MENU_SELECTED[$local_i]="0"; done ;;
      i|I) local_i=0; for local_i in "${!MENU_SELECTED[@]}"; do
             [[ "${MENU_SELECTED[$local_i]}" == "1" ]] && MENU_SELECTED[$local_i]="0" || MENU_SELECTED[$local_i]="1"
           done ;;
      *)
        for tok in $line; do
          if [[ "$tok" =~ ^[0-9]+$ ]] && (( tok >= 1 && tok <= ${#MENU_SVCS[@]} )); then
            idx=$((tok-1))
            [[ "${MENU_SELECTED[$idx]}" == "1" ]] && MENU_SELECTED[$idx]="0" || MENU_SELECTED[$idx]="1"
          else
            warn "Ignoring invalid entry: '${tok}'"
          fi
        done ;;
    esac
  done
fi

# ── Resolve final selection ───────────────────────────────────────────────────
SELECTED_SVCS=()
for i in "${!MENU_SVCS[@]}"; do
  [[ "${MENU_SELECTED[$i]}" == "1" ]] && SELECTED_SVCS+=("${MENU_SVCS[$i]}")
done

if (( ${#SELECTED_SVCS[@]} == 0 )); then
  warn "No services selected — nothing to do."
  exit 0
fi

echo ""
step "Will rebuild + redeploy (${ENVIRONMENT}): ${SELECTED_SVCS[*]}"
if [[ "$ASSUME_YES" != "true" ]]; then
  printf "  Proceed? [y/N] "
  read -r confirm || confirm="n"
  case "$confirm" in
    y|Y|yes|YES) : ;;
    *) log "Aborted."; exit 0 ;;
  esac
fi

# ── Delegate each service to rebuild-redeploy.sh (build + rollout) ─────────────
if [[ ! -x "$REBUILD_SCRIPT" ]]; then
  if [[ -f "$REBUILD_SCRIPT" ]]; then
    warn "rebuild-redeploy.sh is not executable — invoking via bash"
  else
    err "Required helper not found: ${REBUILD_SCRIPT}"
    exit 1
  fi
fi

run_rebuild() {
  local svc="$1"
  if [[ -x "$REBUILD_SCRIPT" ]]; then
    "$REBUILD_SCRIPT" "$svc" "$ENVIRONMENT" ${NO_CACHE}
  else
    bash "$REBUILD_SCRIPT" "$svc" "$ENVIRONMENT" ${NO_CACHE}
  fi
}

FAILED=()
total=${#SELECTED_SVCS[@]}
count=0
for svc in "${SELECTED_SVCS[@]}"; do
  count=$((count+1))
  echo ""
  bold "── [${count}/${total}] ${svc} ──────────────────────────────────────────"
  if run_rebuild "$svc"; then
    log "✔ ${svc} rebuilt + redeployed"
  else
    err "✘ ${svc} failed"
    FAILED+=("$svc")
  fi
done

echo ""
bold "╔══════════════════════════════════════════════╗"
if (( ${#FAILED[@]} == 0 )); then
  bold "║                 All done ✔                     ║"
  bold "╚══════════════════════════════════════════════╝"
  log "Rebuilt + redeployed (${ENVIRONMENT}): ${SELECTED_SVCS[*]}"
  echo ""
  echo "  Check status:"
  echo "    kubectl get ksvc -n platform-services-${ENVIRONMENT}"
  echo "    kubectl get pods -n platform-services-${ENVIRONMENT} -l app.kubernetes.io/part-of=yoizen-arch"
  exit 0
else
  bold "║              Completed with errors             ║"
  bold "╚══════════════════════════════════════════════╝"
  err "Failed: ${FAILED[*]}"
  warn "Succeeded: $(printf '%s ' "${SELECTED_SVCS[@]}" | tr ' ' '\n' | grep -vxF "$(printf '%s\n' "${FAILED[@]}")" | tr '\n' ' ')"
  exit 1
fi
