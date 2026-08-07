#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# kustomize-safe-apply.sh — apply a kustomize overlay without the $patch:delete panic
# =============================================================================
#
# Why this exists
# ---------------
# `kubectl apply -k <overlay>` uses the kustomize build that is *bundled inside
# kubectl*. Versions of that bundled kustomize older than v5.7.0 crash with a
# nil-pointer SIGSEGV when a single strategic-merge patch file contains MULTIPLE
# `$patch: delete` documents:
#
#   panic: runtime error: invalid memory address or nil pointer dereference
#     sigs.k8s.io/kustomize/api/resource.(*Resource).CurId(...)
#     ...transformStrategicMerge -> GetById -> demandOneMatch
#
# This is upstream kustomize bug kubernetes-sigs/kustomize#5552, fixed by
# PR #5859 and released in kustomize v5.7.0.
#
# This repo hits it through:
#   infrastructure/overlays/postgres/patches/exclude-mongo.yaml          (9 deletes)
#   infrastructure/overlays/mongo/patches/exclude-oltp-postgres.yaml     (9 deletes)
# both of which strip the unused storage engine from the shared base.
#
# What this script does (without modifying any tracked file)
# ----------------------------------------------------------
# 1. Mirrors the relevant top-level tree (infrastructure/ or knative/) into a
#    throwaway temp dir.
# 2. In that mirror, rewrites every kustomization that references a patch file
#    holding more than one `$patch: delete` document, splitting it into one
#    document per file (one `$patch: delete` per `patches:` entry) — the
#    documented workaround that the buggy kustomize handles fine.
# 3. Runs `kubectl apply -k <mirrored-overlay>`.
# 4. Cleans up the temp dir.
#
# If a standalone `kustomize` >= v5.7.0 is on PATH, it is used directly
# (`kustomize build | kubectl apply -f -`) — faster, and no mirror needed.
#
# Usage:
#   ./kustomize-safe-apply.sh <overlay-dir> [extra kubectl apply args...]
#   ./kustomize-safe-apply.sh infrastructure/overlays/orbstack/dev
# =============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERR]${NC}   $*" >&2; }
step() { echo -e "${CYAN}[STEP]${NC}  $*"; }

MIN_KUSTOMIZE="5.7.0"

usage() { sed -n '3,44p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ── version compare: returns 0 if $1 >= $2 (dotted numeric) ───────────────────
ver_ge() {
  local a=$1 b=$2
  local IFS=.
  # shellcheck disable=SC2206
  local av=($a) bv=($b)
  local i
  for i in 0 1 2; do
    local x=${av[$i]:-0} y=${bv[$i]:-0}
    x=${x//[!0-9]/}; y=${y//[!0-9]/}
    (( 10#${x:-0} > 10#${y:-0} )) && return 0
    (( 10#${x:-0} < 10#${y:-0} )) && return 1
  done
  return 0
}

standalone_kustomize_ok() {
  command -v kustomize &>/dev/null || return 1
  local v
  v="$(kustomize version 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | tr -d v)"
  [[ -z "$v" ]] && return 1
  ver_ge "$v" "$MIN_KUSTOMIZE"
}

# ── Split a single multi-document $patch:delete patch file into one file per ──
# document and rewrite the referencing kustomization.yaml. No-op if the file has
# 0 or 1 documents (single delete never triggers the bug).
#   $1 = kustomization dir (in the mirror)
#   $2 = patch path relative to that dir (e.g. patches/exclude-mongo.yaml)
split_multidelete_patch() {
  local kdir="$1" rel="$2"
  local pfile="${kdir}/${rel}"
  local kfile="${kdir}/kustomization.yaml"
  [[ -f "$pfile" && -f "$kfile" ]] || return 0

  # Only act on files with more than one YAML document.
  local docs
  docs="$(grep -cE '^kind:' "$pfile" 2>/dev/null || true)"
  docs="${docs//[!0-9]/}"
  (( ${docs:-0} > 1 )) || return 0

  local stem splitdir
  stem="$(basename "${rel%.yaml}")"
  splitdir="${kdir}/$(dirname "$rel")/.${stem}.split"
  rm -rf "$splitdir"; mkdir -p "$splitdir"

  # Split on lines that are exactly `---`. Document 0 = everything before the
  # first separator (leading comments + first resource), then one file each.
  awk -v outdir="$splitdir" '
    BEGIN { idx = 0 }
    /^---[[:space:]]*$/ { idx++; next }
    { print >> (sprintf("%s/%03d.yaml", outdir, idx)) }
  ' "$pfile"

  # Keep only split files that actually contain a resource (a `kind:` line);
  # build the replacement list of `- path:` entries (relative to kdir).
  local repl="" sf relpath
  for sf in "$splitdir"/*.yaml; do
    [[ -f "$sf" ]] || continue
    if ! grep -qE '^kind:' "$sf"; then rm -f "$sf"; continue; fi
    relpath="${sf#"${kdir}"/}"
    repl+="  - path: ${relpath}"$'\n'
  done
  repl="${repl%$'\n'}"
  [[ -z "$repl" ]] && return 0

  # Replace the single `- path: <rel>` line in the kustomization with the block.
  awk -v ref="$rel" -v repl="$repl" '
    ($0 ~ /^[[:space:]]*-/) && (index($0, "path: " ref) > 0) { print repl; next }
    { print }
  ' "$kfile" > "${kfile}.tmp" && mv "${kfile}.tmp" "$kfile"

  step "Split multi-delete patch: ${rel} → ${docs} single-document patches"
}

# Walk every kustomization.yaml under a mirrored tree and split any referenced
# patch file that carries multiple `$patch: delete` documents. Generic, so it
# also covers future exclude files, not just the two we know about today.
fix_multidelete_in_tree() {
  local root="$1"
  local kfile kdir line p
  while IFS= read -r kfile; do
    kdir="$(dirname "$kfile")"
    # Extract `- path: X` patch references (ignore commented lines).
    while IFS= read -r p; do
      [[ -z "$p" ]] && continue
      [[ -f "${kdir}/${p}" ]] || continue
      local dc; dc="$(grep -cE '^\$patch: delete' "${kdir}/${p}" 2>/dev/null || true)"
      dc="${dc//[!0-9]/}"
      if (( ${dc:-0} > 1 )); then
        split_multidelete_patch "$kdir" "$p"
      fi
    done < <(grep -E '^[[:space:]]*-[[:space:]]*path:[[:space:]]*' "$kfile" \
              | sed -E 's/^[[:space:]]*-[[:space:]]*path:[[:space:]]*//; s/[[:space:]]*$//' \
              | sed -E 's/^["'"'"']//; s/["'"'"']$//')
  done < <(find "$root" -name kustomization.yaml -type f)
}

main() {
  [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { usage; exit 0; }
  local overlay="${1:-}"
  [[ -z "$overlay" ]] && { err "overlay dir required"; usage; exit 1; }
  shift || true
  local extra_args=("$@")

  command -v kubectl &>/dev/null || { err "kubectl not found on PATH"; exit 1; }

  # Normalize to an absolute path under the repo.
  if [[ "$overlay" != /* ]]; then overlay="${REPO_ROOT}/${overlay}"; fi
  overlay="$(cd "$overlay" 2>/dev/null && pwd || true)"
  [[ -z "$overlay" || ! -f "${overlay}/kustomization.yaml" ]] && {
    err "Not a kustomize overlay (no kustomization.yaml): ${1:-}"
    exit 1
  }

  # ── Fast path: a fixed standalone kustomize renders everything correctly ────
  if standalone_kustomize_ok; then
    log "Using standalone kustomize (>= ${MIN_KUSTOMIZE}) → build | kubectl apply"
    kustomize build "$overlay" | kubectl apply ${extra_args[@]+"${extra_args[@]}"} -f -
    return
  fi

  # ── Safe path: mirror + split multi-delete patches, then apply ──────────────
  local rel top tmp mirror_overlay
  rel="${overlay#"${REPO_ROOT}"/}"
  top="${rel%%/*}"
  if [[ "$rel" == "$overlay" || -z "$top" ]]; then
    warn "Overlay is outside the repo root — applying directly with kubectl -k"
    kubectl apply ${extra_args[@]+"${extra_args[@]}"} -k "$overlay"
    return
  fi

  tmp="$(mktemp -d -t kustomize-safe-XXXXXX)"
  trap 'rm -rf "$tmp"' EXIT

  step "Mirroring ${top}/ to bypass kustomize #5552 (bundled kustomize < ${MIN_KUSTOMIZE})"
  cp -R "${REPO_ROOT}/${top}" "${tmp}/${top}"
  fix_multidelete_in_tree "${tmp}/${top}"

  mirror_overlay="${tmp}/${rel}"
  log "Applying mirrored overlay: ${rel}"
  kubectl apply ${extra_args[@]+"${extra_args[@]}"} -k "$mirror_overlay"
}

main "$@"
