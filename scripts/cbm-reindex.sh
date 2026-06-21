#!/usr/bin/env bash
#
# cbm-reindex.sh — refresh the codebase-memory-mcp knowledge graph for this repo.
#
# Idempotent: re-indexing the same repo just refreshes the existing graph, so it
# is safe to run repeatedly (manually, from a git hook, or from a scheduler).
# Respects .cbmignore at the repo root automatically (the tool reads it).
#
# Config (all overridable via env):
#   CBM_BIN     binary name / path        (default: codebase-memory-mcp)
#   CBM_MODE    full|moderate|fast        (default: moderate — keeps semantic edges)
#   CBM_REPO    repo to index             (default: git toplevel of this script)
#   CBM_PERSIST true|false                (default: false — set true to refresh
#                                          the shared .codebase-memory/graph.db.zst artifact)
#
# Exit code is ALWAYS 0 so this can never block a git operation. Failures are
# logged loudly to stderr instead of aborting.

set -uo pipefail

log() { printf '[cbm-reindex %(%H:%M:%S)T] %s\n' -1 "$*" >&2; }

CBM_BIN="${CBM_BIN:-codebase-memory-mcp}"
CBM_MODE="${CBM_MODE:-moderate}"
CBM_PERSIST="${CBM_PERSIST:-false}"

# Resolve repo root: env override → git toplevel → two levels up from this script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${CBM_REPO:-}" ]]; then
  REPO="$CBM_REPO"
elif REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

log "repo=$REPO mode=$CBM_MODE persist=$CBM_PERSIST bin=$CBM_BIN"

if ! command -v "$CBM_BIN" >/dev/null 2>&1; then
  log "SKIP: '$CBM_BIN' not found on PATH. Install it or set CBM_BIN to its absolute path."
  exit 0
fi

if [[ ! -d "$REPO" ]]; then
  log "SKIP: repo path '$REPO' is not a directory."
  exit 0
fi

# Build the JSON argument safely (repo path may contain spaces).
PAYLOAD="$(printf '{"repo_path":"%s","mode":"%s","persistence":%s}' "$REPO" "$CBM_MODE" "$CBM_PERSIST")"

log "indexing… (codebase-memory-mcp cli index_repository)"
if "$CBM_BIN" cli index_repository "$PAYLOAD"; then
  log "done. (querying counts)"
  "$CBM_BIN" cli list_projects 2>/dev/null || true
else
  log "WARN: index_repository returned non-zero — graph may be stale. Not blocking."
fi

exit 0
