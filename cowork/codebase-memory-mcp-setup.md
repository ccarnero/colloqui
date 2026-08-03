# `codebase-memory-mcp` — setup in this repo

> Status: **wired and active** (as of 2026-06-20).
> The MCP server is configured at the **repo level** via `.mcp.json`, not via Claude Desktop's global config.
> Auto-reindex on branch changes is handled by git hooks + `scripts/cbm-reindex.sh`.

---

## How it's wired

### 1. Repo-level MCP config (`.mcp.json`)

`.mcp.json` at the repo root registers the server for Claude Code (and Cowork sessions that mount this repo):

```json
{
  "mcpServers": {
    "codebase-memory-mcp": {
      "command": "codebase-memory-mcp",
      "args": []
    }
  }
}
```

The binary is looked up from `PATH` (no hardcoded absolute path). Make sure `codebase-memory-mcp` is on your shell's PATH:

```bash
which codebase-memory-mcp
# e.g. /opt/homebrew/bin/codebase-memory-mcp  (Homebrew, Apple Silicon)
#      /usr/local/bin/codebase-memory-mcp      (npm global / Intel)
#      ~/.local/bin/codebase-memory-mcp        (setup script)
```

### 2. Auto-reindex via git hooks

Two hooks in `.git/hooks/` call `scripts/cbm-reindex.sh` non-blockingly (always `exit 0`).

> **These hooks are NOT versioned.** `.git/hooks/` is inside the git directory,
> so nothing in it can be tracked, and this repo sets no `core.hooksPath`
> (`git config core.hooksPath` returns empty) and ships no hook template dir —
> `git ls-files | rg hook` matches only `scripts/claude-hook-lint-test.sh`, an
> unrelated Claude Code hook. A fresh clone therefore has **no** cbm hooks; see
> "First-time setup on a new machine" below.

| Hook | When it fires |
|---|---|
| `post-merge` | After every `git pull` / `git merge` |
| `post-checkout` | After every branch switch (not file-only checkouts) |

Both log to `.git/cbm-reindex.log`. They never delay or break git operations.

### 3. Reindex script (`scripts/cbm-reindex.sh`)

Idempotent, safe to run manually at any time:

```bash
# Manual re-index (respects .cbmignore automatically)
./scripts/cbm-reindex.sh

# Tune via env vars
CBM_MODE=full ./scripts/cbm-reindex.sh        # full semantic analysis
CBM_PERSIST=true ./scripts/cbm-reindex.sh     # refresh shared .codebase-memory/graph.db.zst
```

Config env vars:

| Var | Default | Description |
|---|---|---|
| `CBM_BIN` | `codebase-memory-mcp` | Binary name or absolute path |
| `CBM_MODE` | `moderate` | `full \| moderate \| fast` |
| `CBM_REPO` | git toplevel | Override repo path |
| `CBM_PERSIST` | `false` | Refresh the shared compressed graph artifact |

If `codebase-memory-mcp` is not on PATH the script logs a `SKIP` and exits 0 — no crash.

---

## First-time setup on a new machine

```bash
# 1. Install the binary (Homebrew example)
brew install deusdata/tap/codebase-memory-mcp

# 2. Verify it's on PATH
which codebase-memory-mcp

# 3. Write the git hooks — they are NOT committed and a fresh clone has none.
#    The two bodies are NOT identical: post-checkout carries a branch-checkout
#    guard as its first statement so file-only checkouts do not re-index.
#    Copy-paste both blocks as-is.

printf '%s\n' '#!/bin/sh' \
  'REPO="$(git rev-parse --show-toplevel 2>/dev/null)"' \
  '[ -n "$REPO" ] && [ -x "$REPO/scripts/cbm-reindex.sh" ] && \' \
  '  nohup "$REPO/scripts/cbm-reindex.sh" >"$REPO/.git/cbm-reindex.log" 2>&1 &' \
  'exit 0' > .git/hooks/post-merge
chmod +x .git/hooks/post-merge

printf '%s\n' '#!/bin/sh' \
  '# Only re-index on a branch checkout; ignore plain file checkouts.' \
  '[ "${3:-0}" = "1" ] || exit 0' \
  'REPO="$(git rev-parse --show-toplevel 2>/dev/null)"' \
  '[ -n "$REPO" ] && [ -x "$REPO/scripts/cbm-reindex.sh" ] && \' \
  '  nohup "$REPO/scripts/cbm-reindex.sh" >"$REPO/.git/cbm-reindex.log" 2>&1 &' \
  'exit 0' > .git/hooks/post-checkout
chmod +x .git/hooks/post-checkout

# 4. Pre-build the graph so the first query is instant
./scripts/cbm-reindex.sh
```

The `.cbmignore` at the repo root excludes `dist/`, `build/`, `coverage/`,
lockfiles (`pnpm-lock.yaml`, `bun.lock`, `*.lock`) and the local agent caches
(`.turbo/`, `.codegraph/`, `.atl/`, `.claude/worktrees/`, `.opencode/`).
`node_modules/` and `.git/` are **not** listed — its own header records that the
tool ignores those two automatically.

---

## Verifying the connection

In a Claude Code / Cowork session on this repo, ask:

```
index_repository {"repo_path": "/Users/chris/sources/yoizen/platform-cluster"}
list_projects
```

A healthy graph shows ~15k+ nodes and ~44k+ edges (TypeScript: ~1.5k files as of 2026-06-20).

---

## Note on Claude Desktop global config

The earlier version of this doc described adding the server to
`~/Library/Application Support/Claude/claude_desktop_config.json`. That approach still works
for personal Cowork sessions not tied to a repo, but the **canonical setup for this codebase**
is the repo-level `.mcp.json` above — it's version-controlled, shared by the whole team, and
picked up automatically by Claude Code when you open the repo.

---

*Sources: `.mcp.json`, `scripts/cbm-reindex.sh`, `.git/hooks/post-merge`, `.git/hooks/post-checkout`, `.cbmignore`. Re-verified 2026-08-03 (docs-truth-audit T08): `.mcp.json` is byte-identical to the block quoted above; both hooks exist, both invoke `scripts/cbm-reindex.sh` via `nohup`, both log to `.git/cbm-reindex.log`, both end in `exit 0`; `scripts/cbm-reindex.sh`'s four env knobs and their defaults match the table. The two corrections above are the hook-installation step and the `.cbmignore` contents. The "~15k+ nodes / ~44k+ edges" figure is a dated 2026-06-20 observation of a per-machine cache and is left as such.*
