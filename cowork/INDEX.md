# Index — work from this session (cowork/)

Map of everything produced and where each piece lives. Start here.

## Prerequisites

What you need to run the stack and work with these docs:

| Prerequisite | Why / notes |
|---|---|
| **Bun 1.3+** | Runtime for all TypeScript services and scripts. |
| **Docker + a local Kubernetes** | **OrbStack** (macOS) or **minikube** (Linux/CI). The whole cluster runs locally. |
| **kubectl** | Talk to the cluster. |
| **kustomize ≥ 5.7.0** (standalone) | The kubectl-bundled version is too old; install the standalone binary. |
| **codebase-memory-mcp** on `PATH` | Code knowledge-graph MCP used by Claude Code (see "Tooling: codebase-memory-mcp" below). Optional but recommended. |
| **Claude Code** (this repo's config) | SDD subagents + `cheap`/`premium` model profiles + lint/test hooks live under `.claude/`. |
| **sudo** (Linux) | The minikube orchestrator needs it up-front for the Kourier port-forward. |

One-command startup once the prereqs are in place: `scripts/orbstack/startup.sh` (macOS) or `scripts/minikube/startup.sh` (Linux). See `CHECKPOINT.md` for the full runbook.

## Tooling: codebase-memory-mcp

A local code knowledge-graph MCP server (tree-sitter based) used by Claude Code to search, trace paths, and query the architecture of this repo.

| Where | What |
|---|---|
| `.mcp.json` | Registers `codebase-memory-mcp` for Claude Code at the repo level (binary resolved from `PATH`). |
| `scripts/cbm-reindex.sh` | Idempotent re-index script (respects `.cbmignore`). |
| `.cbmignore` | Excludes `node_modules/`, `dist/`, lockfiles, caches from the graph. |
| `.git/hooks/post-merge`, `.git/hooks/post-checkout` | Non-blocking auto-reindex on pull/branch switch (always `exit 0`). |

Full setup, install, and verification steps: `codebase-memory-mcp-setup.md`.

## Documents in `cowork/` (analysis)

| Doc | What it covers |
|---|---|
| `INDEX.md` | This index. |
| `CHECKPOINT.md` | Compact resume state: what's done, run-from-scratch runbook, next steps. |
| `ARCHITECTURE-ANALYSIS.md` | Full platform architecture (18 services, NATS, Temporal, multi-tenancy), verified against the code + evaluation of `codebase-memory-mcp`. |
| `DOC-VS-CODE-AUDIT.md` | Doc-vs-code audit of `DOCS/`: what matches and 3 discrepancies (200→400, stream tiers, durable name). |
| `SDK-http-sdk.md` | Documentation of the nascent `@yoizen/platform-sdk` (the TS `@yoizen/sdk` was removed). |
| `CACHE-architecture.md` | The 3 cache layers (cache-service L1/L2, per-service Redis, in-memory) + deep dive on the AdapterClient SWR + the L1 gotcha. |
| `TRACEABILITY-audit.md` | End-to-end, hop-by-hop traceability audit (OTel vs correlation) — **historical**: its P0 findings are already shipped/committed (see the banner at the top of that doc). |
| `CHANGES-for-dev.md` | **Handoff for the other dev**: what each change shipped, decisions, gaps, and how to close it out. ← start here to communicate. |
| `codebase-memory-mcp-setup.md` | How the `codebase-memory-mcp` tool was wired up. |

## Artifacts in the repo (outside `cowork/`)

| Location | What's there |
|---|---|
| `.sdd/changes/traceability-causal-chain-ingress/` | SDD record of change 1 (explore/design/adr/tasks/archive). |
| `.sdd/changes/traceability-audit-persist-ids/` | SDD record of change 2. |
| `.sdd/changes/traceability-channel-ingress-causal/`, `.sdd/changes/traceability-channel-chain-endpoint/` | SDD records of the ingress fix + the channel-events chain endpoint. |
| `services/audit-service/`, `services/api-gateway/`, `packages/shared/` | Code for the changes — **committed** on `main` (incl. `6292520`). |
| `DOCS/messaging/envelope.md` §8 · `services/audit-service/CLAUDE.md` | Official docs updated by the changes. |
| `.claude/agents/sdd-*.md`, `.claude/commands/sdd/*.md`, `.claude/settings.json`, `.claude/sdd-profiles.json` | Claude Code config (SDD subagents + profiles + commands + hooks). |
| `scripts/orbstack/startup.sh` | Full startup orchestrator for OrbStack (macOS): sudo, precheck, rebuild, bootstrap, readiness gate, setup-tenant, e2e. |
| `scripts/minikube/startup.sh` | Equivalent orchestrator for minikube (Linux/CI): uses `BUILD_PARALLELISM=2`, Kourier port-forward to localhost:8080, `READY_WAIT=300`. |
| `scripts/sdd-profile.mjs`, `scripts/claude-hook-lint-test.sh` | SDD profile switch + lint/test hook. |
| `scripts/cbm-reindex.sh`, `.cbmignore`, `.git/hooks/post-merge\|post-checkout` | Maintenance of the `codebase-memory-mcp` graph. |
| `.mcp.json` | Connects `codebase-memory-mcp` to Claude Code. |
| `services/tracking-ingester-service/` | **Message-tracking delivery** — bus→Postgres tracking ingester (classify + persist every bus event to `tracking.tracked_events`). Operational doc: `services/tracking-ingester-service/README.md`; classification rules: `TAXONOMY.md`; build-loop playbook: `cowork/LOOP-PLAYBOOK.md`. |

## Overall status

- **Full traceability shipped and committed** (`6292520` + earlier): root ingress fix, persistence in `audit` + `channel_events` + `gateway_audit_events`, endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId`.
- Validated on **OrbStack (macOS)** and **minikube (Linux)**. One-command startup: `scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`.
- Only pending item: optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid).
- Uncommitted: `.mcp.json`, `.cbmignore`, `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).
