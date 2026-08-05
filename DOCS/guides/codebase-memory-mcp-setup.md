# `codebase-memory-mcp` — setup in this repo

Class: prescriptive
Summary: How to install and wire the codebase-memory-mcp code-graph server in this repo (.mcp.json, git hooks, reindex script), plus the dated 2026-06 fit assessment and trial results.

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

## Fit assessment and trial results (2026-06-20 — RECORD)

> Carried over verbatim from §11-§12 of the former `cowork/ARCHITECTURE-ANALYSIS.md`
> (deleted by the docs-truth-audit T10, ruling D21 — it was a self-declared stale
> snapshot; SB5 required carving these two sections out first). This is now the
> only place the assessment exists. It is a **dated record**: the numbers below
> (node/edge counts, index size) describe one machine on 2026-06-20 and are not
> re-verified. The setup sections above ARE current.

### Fit assessment: `codebase-memory-mcp` (DeusData)

**What the tool is**: a high-performance, local **code-intelligence MCP server**. It parses a codebase with 155 vendored tree-sitter grammars into a **persistent knowledge graph** (SQLite, stored in `~/.cache/codebase-memory-mcp/`), and exposes ~14 MCP tools so an agent can ask structural questions instead of grepping file-by-file. Single static binary, no LLM inside, no API keys. Headline claims: index an average repo in milliseconds, sub-ms queries, ~99% fewer tokens than file-by-file exploration.

**Its tools**: `index_repository`, `list_projects`, `delete_project`, `index_status`, `search_graph`, `trace_call_path`, `detect_changes` (git-diff → blast radius + risk), `query_graph` (Cypher subset), `get_graph_schema`, `get_code_snippet`, `get_architecture`, `search_code`, `manage_adr`, `ingest_traces`.

**Why it is a strong fit for *this* repo specifically**:
1. **Scale & language match** — 18 TypeScript services + 6 packages in one monorepo is exactly the "too big to hold in an agent's head" case. It has first-class TS/JS/JSX/TSX type resolution.
2. **Cross-service linking is the platform's hardest problem** — the system is glued by NATS subjects and HTTP calls across service boundaries. The tool's `HTTP_CALLS` / `ASYNC_CALLS` edges and **channel detection (`EMITS`/`LISTENS_ON` for pub-sub)** map almost 1:1 onto "who publishes `evt.<tenant>.*` and who consumes it" — the question that file search answers worst.
3. **IaC indexing** — it indexes Dockerfiles, Kubernetes manifests, and **Kustomize overlays** as graph nodes. This repo is Kustomize-heavy (`infrastructure/`, `knative/`).
4. **Token savings on a multi-agent shop** — you already run several agents; structural queries instead of grep directly cut context cost.
5. **Complements, not replaces, what you have** — Engram remembers *decisions and conversations*; `codebase-memory-mcp` remembers *code structure*. The empty `.codegraph/` dir suggests a code-graph slot was anticipated but never filled.
6. **Team-shared artifact** — `.codebase-memory/graph.db.zst` can be committed so teammates skip the re-index, with auto `merge=ours` to avoid conflicts.

**Caveats / things to verify before adopting**:
- **Index freshness vs. dev-mode churn** — there's a background watcher + git-based change detection, but a fast-moving monorepo means you'll want to confirm the auto-sync keeps up and tune `auto_index_limit` (default 50k files; exclude `node_modules`, `dist`, `.bun` via `.cbmignore`).
- **Accuracy of dynamic edges** — NATS subjects here are built from constants + tenant interpolation (`evt.{tenant}.<service>.>`). The tool resolves constants for channel detection, but heavily templated/runtime-built subjects may not all resolve; treat `EMITS`/`LISTENS_ON` as a strong hint, not ground truth. `ingest_traces` can validate HTTP edges against real runtime traces.
- **It is a structural backend, not an oracle** — no semantic understanding of *business* intent; the agent (Claude) remains the reasoning layer.
- **Binary + cache footprint** — static binary is easy, but the SQLite graph for a 24-package monorepo will take disk; it persists per-machine cache.

**Recommended trial (cheap, reversible)**: install the binary, add a `.cbmignore` excluding `node_modules/`, `dist/`, `.bun/`, `**/*.lock`, point `index_repository` at the repo root, then run three concrete questions that are painful today — e.g. *"who consumes `evt.<tenant>.channel-service.*`?"*, *"trace inbound callers of `runWorkflow`"*, and *"`get_architecture` for the whole monorepo"* — and compare answer quality + token cost against the current grep workflow. If those three land, it earns its place; if the cross-service edges are noisy, it still pays for itself as fast structural search.

---

---

### Trial results — run live on this repo

Connected the MCP server in Cowork and ran it against the indexed graph
(**15,759 nodes / 44,007 edges**, ~46 MB; TypeScript: 1,492 files). Verdict below is from real output, not the marketing.

#### What it nailed (keep it for these)
- **`get_architecture`** — instant, accurate. Per-package node counts match reality (admin-console > agent-admin > api-gateway > agent-ai…), plus hotspots, layers, Leiden clusters, and 176 Route nodes. This alone replaces a lot of manual spelunking.
- **`trace_path` (call graph / impact analysis)** — the real win. `ensureTenantIngressStream` inbound trace returned callers across **6 services** (ai-agent-gateway, api-gateway, channel-service, registry-service, tenant-service, + `MultiTenantConsumerManager`) with hop distances. That's the cross-service "who depends on this" question grep answers worst — easily 15+ greps collapsed into one call.
- **`search_graph` (BM25 natural-language)** — "verify webhook provider signature" → `verifyWebhookSignature` (Meta), `verifySignature` (Telegram/HTTP/Meta base), and the webhook-verify RPC client/server, ranked with file+line. Excellent discovery.

#### Where it falls short on THIS codebase (don't trust these blindly)
- **Async / event edges are unreliable.** Only 3 `Channel` nodes and 4 `LISTENS_ON` edges — and all 4 point at **ioredis emitter events** (`error`/`ready`/`end`), *not* the NATS JetStream pub/sub that actually wires the platform together. The "who consumes `evt.<tenant>.channel-service.*`" question is **not** answered by channel detection, because subjects are built from template helpers (`evt.${tenant}.${producer}…`) and consumers attach via durable-consumer abstractions the static analyzer can't follow. Use `search_graph` over the subject constants + consumer registrations instead.
- **Temporal string-dispatch is invisible.** `trace_path('runWorkflow', inbound)` = **0 callers**, because Temporal starts it by string name (`workflow.start("runWorkflow", …)`), not a static call edge. Same will apply to any reflection/registry-based dispatch.

#### Bottom line
**Keep it wired in.** It already paid for itself this session on call-graph, impact analysis, architecture overview, and semantic search — my four biggest pain points on a 24-package monorepo. Treat its automatic cross-service *event* edges as a weak hint, not ground truth; for NATS subject flows, fall back to graph-augmented search over the constants. Net: a strong **yes** for both of us, with that one documented blind spot.

---

## Note on Claude Desktop global config

The earlier version of this doc described adding the server to
`~/Library/Application Support/Claude/claude_desktop_config.json`. That approach still works
for personal Cowork sessions not tied to a repo, but the **canonical setup for this codebase**
is the repo-level `.mcp.json` above — it's version-controlled, shared by the whole team, and
picked up automatically by Claude Code when you open the repo.

---

*Sources: `.mcp.json`, `scripts/cbm-reindex.sh`, `.git/hooks/post-merge`, `.git/hooks/post-checkout`, `.cbmignore`. Re-verified 2026-08-03 (docs-truth-audit T08): `.mcp.json` is byte-identical to the block quoted above; both hooks exist, both invoke `scripts/cbm-reindex.sh` via `nohup`, both log to `.git/cbm-reindex.log`, both end in `exit 0`; `scripts/cbm-reindex.sh`'s four env knobs and their defaults match the table. The two corrections above are the hook-installation step and the `.cbmignore` contents. The "~15k+ nodes / ~44k+ edges" figure is a dated 2026-06-20 observation of a per-machine cache and is left as such.*
