# Platform Cluster — Architecture Analysis

> Analysis of the `yoizen-platform` monorepo (a.k.a. the **YoizenClaw** platform).
> Written from a full read of the repo's `DOCS/`, root config, and service layout.
> Audience: Chris. Purpose: shared mental model before evaluating `codebase-memory-mcp`.
>
> **Verification status:** cross-checked against the real TypeScript source (not just `DOCS/`).
> ~9 load-bearing claims confirmed in code — subject constants (`evt.<tenant>.<producer>...`),
> `TENANT_HEADER = 'x-yoizen-tenant'`, `EventEnvelope`, the 6 workflow activities, per-tenant
> connection managers (postgres + mongo), claim-check (`packages/database/src/claim-check.ts`,
> `multi-tenant-consumer-manager.ts`), channel-service signature verification, `runPhase`
> provisioning, and the Vercel AI SDK (`ai` v6 + `@ai-sdk/{anthropic,google,openai,mcp}`).
> The doc holds up; the two minor corrections found are noted inline.

---

## 1. What this product is, in one paragraph

It is a **multi-tenant, event-driven, serverless platform for building and running AI agents and automations**, deployed on Kubernetes. External channels (Telegram, WhatsApp, generic webhooks) and API clients send events in; those events flow over a NATS JetStream "service bus"; automations run as **Temporal workflows**; and **AI agents** (LLM pipeline + tools + long-term memory) act on the conversations. Every tenant is isolated — its own namespace, its own database, its own message streams. The whole thing is packaged so a single command brings up an entire local cluster on a laptop.

The product name surfaced in the code is **YoizenClaw** — the AI-agent layer is the "brain," and the rest of the platform is the nervous system that feeds it events and carries out its actions.

---

## 2. The mental model (analogy)

Think of it as an **automated call center / customer-operations factory**, built as a city:

- **The mailroom (ingress)** — `api-gateway` and `channel-service` receive everything from the outside world (a WhatsApp message, a webhook, an API call) and turn it into a standard "envelope."
- **The postal system (NATS JetStream)** — a durable, per-tenant set of mail tubes (`INGRESS-<tenant>`) that carry envelopes between buildings. Nothing is lost; mail is retried if a building is busy.
- **The factory floor (Temporal workflows)** — recipes ("workflows") that say "call this API, then run this code, then send this message." Temporal guarantees each step completes even if a machine crashes mid-recipe.
- **The specialist contractors (connector-runtime)** — a separate crew that only makes outbound HTTP calls to external systems (CRMs, etc.), tuned for high concurrency.
- **The brain (AI agents)** — `agent-ai-service` and friends: the LLM that reads a conversation, picks tools, remembers context, and decides what to say or do.
- **City hall (platform ops)** — `auth-service`, `tenant-service`, `registry-service`, etc.: who's allowed in, provisioning new tenants, where each service lives.
- **Utilities (support services)** — shared NATS, Redis, PostgreSQL, Temporal: the water and electricity every building uses.

Each **tenant is a gated neighborhood** inside the same city: same utilities, but its own street (namespace), its own house (database), and its own mailboxes (NATS streams).

---

## 3. Three-layer model

The cluster is organized into three concentric scopes (per `DOCS/architecture/overview.md`):

| Layer | Namespace | Contains |
|---|---|---|
| **Support services** | `support-services-<env>` | Shared infra for one environment: NATS JetStream, Redis, Temporal, shared CNPG PostgreSQL clusters (`postgres-shared`, `postgres-usage-shared`, `postgres-temporal`, `postgres-temporal-visibility`). |
| **Platform services** | `platform-services-<env>` | The 18 application services (APIs, workflow engine, AI agents, ops, UI). |
| **Per-tenant data boundary** | `<tenant>-<env>-ns` | Tenant isolation: a `postgres` ExternalName aliasing the shared cluster (default `shared` tier) or a dedicated StatefulSet (`dedicated` tier), plus that tenant's NATS streams. |

In developer mode only the `dev` environment exists; qa/staging/production overlays were stripped to keep the local config minimal.

---

## 4. The services (18 of them)

Grouped by responsibility:

### Ingress (the front door)
- **`api-gateway`** (port 3000, 1–10 replicas) — single HTTP entry point. Enforces JWT auth + scopes, ingests events (`POST /events` → 202), streams results over SSE, and does **dynamic tenant routing**: every 15s it pulls the route table from `registry-service` and proxies `/<tenant>/...` calls to the right Knative service. Also the webhook entry point.
- **`channel-service`** (1–5) — channel ingress/egress for Telegram/WhatsApp. **The only service that verifies provider signatures** and re-publishes the canonical `ChannelEnvelope`. Handles claim-check offload for large payloads.

### Automation (the factory)
- **`workflow-service`** — splits into **API** (REST entry, starts Temporal workflows, per-tenant Postgres pools) and **Worker** (the Temporal orchestrator running `runWorkflow`). Action types: `endpointCall`, `serviceCall`, `jsFunction`, `agentCall`, `serviceBusCall`, `channelSend`, `branch`, `conditional`. Templated with `{{path.to.value}}`.
- **`connector-runtime`** — a standalone Temporal worker that does **only** outbound HTTP (`endpointCall`/`serviceCall`), with circuit breaker, retries, response caching, and tenant-header injection. **Max 400 concurrent activities** (`maxConcurrentActivityTaskExecutions: 400`, `services/connector-runtime/src/worker.ts:35` — note: `DOCS/architecture/overview.md` still says 200, which is stale). Plain Deployment (not Knative).
- **`connector-admin`** — config store for outbound HTTP connectors (base URLs, endpoints, OAuth2 auth). `connector-runtime` caches this config in Redis with a stale-while-revalidate (SWR) strategy.

### AI Agents (the brain) — the "YoizenClaw" core
- **`agent-ai-service`** — the LLM runtime. Consumes CloudEvents from NATS and dispatches to internal modules: `chat`, `llm`, `tools`, `skills`, `memory`, `knowledge-bases`, `job-executor`, `scheduler`, `condition-evaluator`, `template-renderer`, `prompt-references`, `rate-limit`, `depth-tracker`, etc. Uses the Vercel AI SDK (OpenAI, Anthropic, Google).
- **`ai-agent-gateway`** — async bridge between APIs/workflows and the agent runtime via NATS (execution lifecycle events).
- **`agent-admin-service`** — CRUD + publish lifecycle for agents, templates, credentials, and files.
- **`agent-memory-service`** — long-term memory: facts / preferences / notices / incidents / promotions, scoped to `SESSION` / `USER` / `TENANT`, with an approval workflow for tenant-wide writes (REPLACE-by-`topicKey` vs KEEP_BOTH merge strategies).
- **`agent-scheduler-service`** — platform-level cron/interval scheduler. Reads every tenant's `jobs` table, uses `toad-scheduler` + PG advisory-lock leader election, and fires `job_trigger` events into each tenant's `INGRESS-<tenant>` stream.

### Platform Ops (city hall)
- **`auth-service`** (1–3) — JWT issuance (`jose`, HS256), platform users + API clients, argon2id hashing via `Bun.password`, dynamic public-route sync to Redis.
- **`tenant-service`** (1–3) — tenant lifecycle. Provisioning is **async**: `POST /tenants` returns 202, and a durable JetStream consumer on `PLATFORM_TENANTS` drives ordered phases (namespace → database → wait-ready → NATS ingress stream → mark ready). Storage-engine aware (`postgres.provider.ts` / `mongo.provider.ts`).
- **`registry-service`** — dynamic Knative service registry + route metadata + canary deployments (traffic splitting 90/10 → 50/50 → promote/rollback).
- **`cache-service`** (scale-to-zero, 0–5) — HTTP key-value cache with L1 (in-memory, max 1000, FIFO) + L2 (Redis).
- **`proxy-service`** — HTTP proxy for external tenant-dependent backends.
- **`audit-service`** (1–5) — durable event audit; a NATS consumer persists every event to the tenant's `events` table in PostgreSQL. Audit traceability shipped: `correlation_id`/`causation_id`/`depth` persisted in `events`, `channel_events`, and `gateway_audit_events`; chain endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId` are live.
- **`usage-aggregator-service`** — cross-stream usage aggregation for tenant analytics/billing.

### UI
- **`admin-console`** — Angular operational UI for platform + YoizenClaw admin workflows.

> Note: `pnpm-workspace.yaml` excludes `services/messaging-console` and `services/yoizenclaw-runtime` as **not** real workspace members. **Correction (source check):** those directories have since been deleted — only the exclusion lines remain in the config. So the live service count is exactly **18**.

---

## 5. Shared packages (`packages/`)

| Package | Purpose |
|---|---|
| `@yoizen/shared` | Canonical types (`EventEnvelope`, `ChannelEnvelope`, `WebhookIngressEnvelope`, `WorkflowDefinition`, `JwtPayload`) and all subject/stream/header constants. The contract that every service shares. |
| `@yoizen/database` | DB + messaging helpers: `ensureTenantIngressStream`, `ensureTenantDlqStream`, claim-check store, migrations. |
| `@yoizen/observability` | `PinoLoggerService`, OpenTelemetry setup, NATS spans, split-service bootstrap (`SERVICE_MODE` lets one image run as API or Worker). |
| `@yoizen/angular-shared` | Shared Angular building blocks for `admin-console`. |
| `@yoizen/http-sdk` | Plain-Node ESM ingest SDK at repo-root `sdk/` (not a workspace member). The former TS `@yoizen/sdk` package was removed. |
| `@yoizen/testing` | Test utilities (auth/tenant services). |

The **`EventEnvelope`** is CloudEvents-inspired and is the heart of the system: `specversion, id, source, type, resource, time, traceid, causation_id, correlation_id, tenant, producer, domain, channel, provider, accountid, idempotencykey, transport, data` (plus optional pipeline-extension fields `callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`, confirmed in `interfaces.ts`). When payloads are large, `data` goes "slim" (claim-check) — `payload_inline: false` + a `payload_ref` pointing at the NATS object store. **Correction (source check):** the real `EventData` fields are `received_at, payload_inline, payload_ref, payload_bytes, payload_checksum, payload` (the overview doc's "checksum" is actually `payload_checksum`).

---

## 6. Key data flows

### a) Inbound webhook → canonical event (two-stage bridge + claim-check)
1. Provider (e.g. Telegram) → `api-gateway POST /webhooks/...`.
2. Gateway builds a `WebhookIngressEnvelope` (signature **not** yet verified, no `accountid`) and publishes to `INGRESS-<tenant>`.
3. `channel-service` durable consumer verifies the signature, resolves the account, builds the canonical `ChannelEnvelope`.
4. If payload > threshold → store blob in `PAYLOAD-<tenant>` object store, publish a slim envelope; else publish full.
5. Downstream consumers (audit, workflow, agent) re-inflate via `wrapHandler` and verify the SHA-256 checksum. Individual handlers never see `payload_inline: false`.

### b) Workflow execution
`POST /workflows` → gateway → workflow-API → `workflow.start(runWorkflow)` in Temporal → 202 `{workflowId, runId}`. The Worker iterates actions: HTTP actions dispatch to the **connector-runtime** task queue; `jsFunction`/`serviceBusCall`/`channelSend`/`agentCall` run as local activities; `branch`/`conditional` are workflow-level control flow.

### c) Tenant provisioning (async, durable)
`POST /tenants` inserts a `pending` row, publishes `platform.tenant.provision.requested` (Nats-Msg-Id = tenant id for idempotency), returns 202. A durable consumer then runs phases wrapped in `runPhase(...)` so a hang shows as `phase=X status=started` with no matching `status=ok`. `INGRESS-<TENANT>` is created **before** the tenant is marked ready, guaranteeing downstream consumers can attach.

### d) AI agent execution
Workflow `agentCall` (or a channel message) emits `execution_requested` over NATS → `ai-agent-gateway` / `agent-ai-service` picks it up, runs the LLM pipeline (tools, memory context, knowledge bases), and emits execution-lifecycle events back. Long-term memory reads/writes go through `agent-memory-service`.

---

## 7. Multi-tenancy model

One cluster, many tenants, isolation enforced **at the application layer** (there are deliberately **no NATS ACLs**):

- **NATS**: per-tenant streams `INGRESS-<TENANT>`, `DLQ-<TENANT>`, `PAYLOAD-<TENANT>` object store; subject prefix `evt.<tenant>.>`; durable-consumer filters.
- **Database**: logical DB per tenant on shared CNPG (default), exposed as a `postgres` ExternalName inside the tenant namespace, so the hostname `postgres.<tenant>-<env>-ns` is stable regardless of tier.
- **HTTP**: every tenant call carries `x-yoizen-tenant`.
- **JWT scopes**: `tenant:<name>` for operators, `platform` for platform-level access.
- **Temporal**: search attribute `TenantId`.
- **Redis**: key prefixes (`adapter:<tenant>:*`, `callback:<tenant>:*`).

`workflow-service` keeps a **lazy per-tenant connection pool map** (`WorkflowTenantConnectionManager`) — the database *is* the tenant boundary; there are no shared tables.

---

## 8. Tech stack

| Layer | Tech |
|---|---|
| Language | TypeScript 5 (strict) |
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Messaging | NATS JetStream |
| Cache | Redis 7 (ioredis) |
| DB | PostgreSQL 17 (`postgres` driver; native, no ORM) — optional MongoDB engine |
| Workflow | Temporal |
| Auth | JWT (`jose`, HS256) + argon2id (`Bun.password`) |
| LLM | Vercel AI SDK (OpenAI / Anthropic / Google) |
| Orchestration | Kubernetes (OrbStack on macOS, Minikube on Linux) |
| Serverless | Knative Serving 1.17 + Kourier ingress |
| IaC | Kustomize (base + overlays) |
| Validation | class-validator + ajv |
| Build | Docker multi-stage: `node:24-alpine` build → `oven/bun:1.3-alpine` runtime (Debian/slim for Temporal workers, since the native SDK is glibc-only) |
| Observability | OpenTelemetry, Prometheus, Grafana, Loki, Tempo, Promtail (in `infrastructure/base/observability`) |
| Package mgr | pnpm workspaces (the `package.json` `workspaces` field is intentionally not used) |

---

## 9. Deployment & dev workflow

- **Bring-up**: `./bootstrap-orbstack-osx.sh` (macOS) or `./bootstrap-minikube-linux.sh` (Linux) stands up support + platform in one command. `/etc/hosts` gets a managed block so `api-gateway.platform-services-dev.dev.local` resolves immediately.
- **Iterate**: `./rebuild-changed.sh` rebuilds only changed images; images are `dev.local/<service>:local` against the shared daemon.
- **Source-mounted dev mode**: `./dev-mode.sh <service> on` mounts source + `bun --watch` (Linux uses a polling reloader because the 9p mount carries no inotify events) — no image rebuild.
- **Smoke/e2e**: `scripts/smoke-test.sh` (readiness preflight) and `scripts/e2e-http-workflow.sh` (HTTP → channel → NATS → workflow → Temporal → assert nonce in logs). Playwright config + `e2e/` present.
- **Other tooling visible at root**: Tilt (`Tiltfile`), `setup-tenant.sh`, `port-forward.sh`, KEDA removed in dev mode.

---

## 10. Notable internal/AI-dev tooling already in the repo

This repo is heavily instrumented for AI-assisted development — relevant context for the tool evaluation:

- **`.sdd/`** + the root `CLAUDE.md` "SDD Orchestrator" — a Spec-Driven Development workflow (init → explore → propose → spec → design → tasks → apply → verify → archive) driven by sub-agents with per-phase model profiles (`.ywai/sdd-profiles.json`).
- **`.ywai/engram/`** — **Engram** persistent-memory system is already installed (`engram 1.7.1`, auto-configured for 3 targets). This is a *conversation/observation* memory ("save after bug fix / decision / discovery"), not a code-structure index.
- **`.codegraph/`** — present but effectively empty (only a `.gitignore`).
- **`.agents/`, `.opencode/`, `.gemini/`, `.cursor/`, `.github/prompts/`** — multiple agent configs; this is a multi-agent shop (Claude Code, OpenCode, Gemini, Cursor).
- **`DOCS/`** — unusually rich: `architecture/`, `messaging/service-bus.md`, `channels/`, `workflows/engine.md`, `agents/` (execution, jobs, memory, adapter-tools), `runbooks/`, `adr/`, `skb/`.

---

## 11. Fit assessment: `codebase-memory-mcp` (DeusData)

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

## 12. Trial results — `codebase-memory-mcp` run live on this repo

Connected the MCP server in Cowork and ran it against the indexed graph
(**15,759 nodes / 44,007 edges**, ~46 MB; TypeScript: 1,492 files). Verdict below is from real output, not the marketing.

### What it nailed (keep it for these)
- **`get_architecture`** — instant, accurate. Per-package node counts match reality (admin-console > agent-admin > api-gateway > agent-ai…), plus hotspots, layers, Leiden clusters, and 176 Route nodes. This alone replaces a lot of manual spelunking.
- **`trace_path` (call graph / impact analysis)** — the real win. `ensureTenantIngressStream` inbound trace returned callers across **6 services** (ai-agent-gateway, api-gateway, channel-service, registry-service, tenant-service, + `MultiTenantConsumerManager`) with hop distances. That's the cross-service "who depends on this" question grep answers worst — easily 15+ greps collapsed into one call.
- **`search_graph` (BM25 natural-language)** — "verify webhook provider signature" → `verifyWebhookSignature` (Meta), `verifySignature` (Telegram/HTTP/Meta base), and the webhook-verify RPC client/server, ranked with file+line. Excellent discovery.

### Where it falls short on THIS codebase (don't trust these blindly)
- **Async / event edges are unreliable.** Only 3 `Channel` nodes and 4 `LISTENS_ON` edges — and all 4 point at **ioredis emitter events** (`error`/`ready`/`end`), *not* the NATS JetStream pub/sub that actually wires the platform together. The "who consumes `evt.<tenant>.channel-service.*`" question is **not** answered by channel detection, because subjects are built from template helpers (`evt.${tenant}.${producer}…`) and consumers attach via durable-consumer abstractions the static analyzer can't follow. Use `search_graph` over the subject constants + consumer registrations instead.
- **Temporal string-dispatch is invisible.** `trace_path('runWorkflow', inbound)` = **0 callers**, because Temporal starts it by string name (`workflow.start("runWorkflow", …)`), not a static call edge. Same will apply to any reflection/registry-based dispatch.

### Bottom line
**Keep it wired in.** It already paid for itself this session on call-graph, impact analysis, architecture overview, and semantic search — my four biggest pain points on a 24-package monorepo. Treat its automatic cross-service *event* edges as a weak hint, not ground truth; for NATS subject flows, fall back to graph-augmented search over the constants. Net: a strong **yes** for both of us, with that one documented blind spot.

---

*Sources: repo `README.md`, `DOCS/architecture/overview.md`, `DOCS/architecture/*`, `DOCS/agents/memory.md`, service `README.md` files, `pnpm-workspace.yaml`, `.ywai/engram/`, the `DeusData/codebase-memory-mcp` GitHub README, and a live `codebase-memory-mcp` trial run (`get_architecture`, `trace_path`, `search_graph`, `query_graph`).*
