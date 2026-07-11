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

## Change: per-tenant workflow enable/disable (workflow-toggle)

Spec-driven change adding a per-tenant `status` (`enabled`/`disabled`) toggle to
workflow definitions: disabling blocks new executions and terminates running Temporal
executions; enabling restores normal behavior. Full task queue, gates, and human
decisions: `manual-loops/workflow-toggle.md`. Operational contract (schema, block point, 409
`WORKFLOW_DISABLED` body, termination semantics): `services/workflow-service/README.md`.

Decision cuádruple:
- **Rule**: disable = block new executions + terminate running ones (not hide, not
  drain) — `manual-loops/workflow-toggle.md` §User decisions.
- **Why**: per-tenant control of automation, so a tenant admin can stop a misbehaving
  or unwanted workflow immediately without waiting for in-flight runs to finish.
- **Evidence**: the single choke point is `WorkflowsService.executeWorkflow` in
  `services/workflow-service/src/modules/workflows/workflows.service.ts` — both the
  HTTP execute endpoint and the trigger-fired path go through it.
- **Engram topic**: `workflows/tenant-toggle`.

## Change: durable payload capture, retention & admin payload viewer (payload-capture)

Spec-driven change closing the claim-check payload gap: the ingester now resolves
claim-checked payloads at ingest time (not just inline ones), a scheduled scrub
enforces a 30-day payload retention window while causal-chain metadata stays
unlimited, and a tenant-admin-only endpoint exposes a single event's payload with a
full audit trail. Full task queue, gates, and human decisions:
`manual-loops/payload-capture.md`. Operational contract (payload lifecycle state
machine, retention env var, scrub runbook, claim-check resolution semantics):
`services/tracking-ingester-service/README.md`. Console-facing contract (permission,
audit trail, status-specific UI messages): `DOCS/guides/trace-console.md`.

Decision cuádruple:
- **Rule**: capture ALL payloads (no per-flow opt-in), resolve claim-checks at
  ingest; retention is 30 days for payload content only (event metadata is kept
  forever); payload viewing is tenant-admin-only with an audit trail for every
  view — `manual-loops/payload-capture.md` §User decisions.
- **Why**: claim-checked payloads previously lived only in Redis until the claim-check
  TTL expired, making the trace console's "did this message actually carry X?"
  debugging scenario impossible once the cache entry was gone; unbounded payload
  storage was rejected in favor of a single global retention window.
- **Evidence**: the resolution choke point is `resolve-payload.ts` wrapping
  `resolveClaimCheckEnvelope` (`packages/database/src/claim-check.ts`), invoked from
  `makeTrackedEventHandler` before insert (`main.ts` sets
  `resolveClaimChecks: false` on the consumer manager so the shared middleware never
  resolves claim-checks itself, avoiding a resolve-then-nak poison loop on an expired
  ref); the read endpoint is guarded by `tracking:payload:read`
  (`services/api-gateway/src/modules/tracking/tracking.controller.ts`).
- **Engram topic**: `tracking/payload-capture`.

## Overall status

- **Full traceability shipped and committed** (`6292520` + earlier): root ingress fix, persistence in `audit` + `channel_events` + `gateway_audit_events`, endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId`.
- Validated on **OrbStack (macOS)** and **minikube (Linux)**. One-command startup: `scripts/orbstack/startup.sh` or `scripts/minikube/startup.sh`.
- Only pending item: optional minor `traceability-depth-and-traceid` (`>=`/`>` adjustment in depth-tracker + D9 traceid).
- Uncommitted: `.mcp.json`, `.cbmignore`, `.sdd/changes/` (SDD artifacts), `cowork/` (these docs).
