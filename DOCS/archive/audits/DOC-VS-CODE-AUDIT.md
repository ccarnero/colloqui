# Doc-vs-Code Audit — Platform Cluster

Class: RECORD
Summary: The 2026-07-07 doc-vs-code audit that started the guard family: drift rows with file:line evidence, the SKB wiring defects, the K1-K10 lock proposals, and the K-to-G crosswalk appended in 2026-08.
Status: historical

> Goal: compare project documentation against the actual codebase and treat code as the source of truth.
> Date: 2026-07-07 (strict re-run; supersedes the 2026-07-01 audit).
> Method: five parallel fresh-context audit agents — (1) async/long-running-execution resilience (see `cowork/ASYNC-RESILIENCE-AUDIT.md`), (2) architecture/runbooks, (3) messaging/channels/connectors, (4) agents/AI/SKB/SDK, (5) workflows/admin-console/gateway. Every claim required `file:line` evidence. Verified claims come with a proposed "lock" (guard/contract test) so regressions fail loudly.

## Executive summary

**The 2026-07-01/02 repair pass held: zero regressions found in the areas it fixed.** Runbooks, observability, security, storage-engine, Temporal, envelope, claim-check, service-bus, ingress and channel docs all verified accurate against current code.

**All new drift comes from post-2026-07-02 work** that landed without a doc pass: SDK growth (`@yoizen/platform-sdk`, 19 namespaces), `/api/v1` global API versioning, live token streaming, and MCP connections.

**Code defects (not doc drift):** the 5 SKB wiring defects found on 2026-07-02 are **all still present** in code; docs correctly flag them. The async-resilience audit found 1 CRITICAL + 1 HIGH + 2 MEDIUM code findings — see `cowork/ASYNC-RESILIENCE-AUDIT.md`.

| Severity | Count | Main areas |
| --- | ---: | --- |
| High | 7 | Two "Status: Design (not implemented)" docs for shipped features (mcp-connections, runtime-streaming); gateway endpoint table without `/api/v1`; `mcpCall` absent from overview action tables; workflow-service README fabricated `channelSend` example + wrong 24h timeout |
| Medium | 8 | SDK described as "ingest SDK"; DOCS/README omits agent-memory/agent-scheduler in two tables; SDK `getUsage` gap unrecorded; decision-log says "MCP pending"; streaming/MCP missing from `DOCS/agents/*`; gateway versioning undocumented |
| Low | 7 | connector-runtime README concurrency 200→400 self-contradiction; cache TTL numbers reversed; utils file locations; PATCH endpoint caveat; stale ARCHITECTURE-ANALYSIS.md; missing healthz/readyz rows; admin-console MCP "placeholder" comment |

## High-priority drift

| # | Doc file:line | Doc claims | Code reality | Fix |
| --- | --- | --- | --- | --- |
| H1 | `DOCS/architecture/mcp-connections.md:3` | "Status: Design (not implemented)" | Fully implemented (commit c4da71a, ~99 files): `mcp-servers` module w/ `:id/test`, `:id/tools`, `:id/usage`, tool bridge, `mcpCall` activity, admin-console list+detail, SDK resource | Flip to `Implemented`; add dated as-implemented delta (known gaps: SDK `getUsage`, delete confirm-dialog) |
| H2 | `DOCS/architecture/runtime-streaming.md:2` | "Status: Design (not implemented)" | Fully implemented (commit 4d77d0a): `rt.<tenant>.exec.<id>.token` subjects, SSE relay w/ `reply.hijack()`, SDK `runtime.stream()`, 61/61 e2e | Flip to `Implemented` |
| H3 | `DOCS/architecture/overview.md:254-276` | Gateway endpoints shown unversioned (`/auth/token`, `/events`, `/tenants`) | `api-gateway/src/main.ts:98-110` — global `api` prefix + URI versioning; canonical `/api/v1/*`; unversioned alias deprecated w/ `Deprecation`/`Sunset`/`Link` headers; `/api/docs` Swagger | Rewrite table; add "API Versioning" subsection |
| H4 | `DOCS/architecture/overview.md:444-453,916-978` | Action-type table/diagrams omit `mcpCall` | `workflow-service/src/temporal/workflows.ts:314-319`, validator `:32,53-88`, `connector-runtime/src/activities/mcp-call.activity.ts` | Add `mcpCall` everywhere endpointCall/serviceCall appear |
| H5 | `services/workflow-service/README.md:326-335` | `channelSend` example `{channel:"email", recipient, subject, body}` (fabricated) | `packages/shared/src/workflow.interfaces.ts:152-164` requires `accountId, channel(whatsapp\|instagram\|telegram\|http), provider, to, type` | Replace example with the shape `patterns.md:456` uses |
| H6 | `services/workflow-service/README.md:619` | "Workflow timeout: 24 hours" | `WORKFLOW_DEFAULT_TIMEOUT_MS = 600_000` (10 min), `packages/shared/src/constants.ts:72`, applied `workflows.service.ts:338` | Change to 10 minutes, cite constant |
| H7 | `services/api-gateway/README.md` + `CLAUDE.md` | Routes documented only as `/api/*`, no versioning mention | Same as H3 | Add "API versioning" section: `/api/v1/*` canonical, deprecated alias, `VERSIONING_EXEMPT_PREFIXES` |

## Medium-priority drift

| # | Doc file:line | Doc claims | Code reality | Fix |
| --- | --- | --- | --- | --- |
| M1 | `DOCS/architecture/overview.md:584`, `cowork/ARCHITECTURE-ANALYSIS.md:99` | SDK is a "Plain-Node ESM ingest SDK" | Full platform SDK, 19 namespaces (`sdk/src/infrastructure/create-client.ts:176-197`) | Rewrite: full-surface SDK; ingest is one capability |
| M2 | `DOCS/README.md:223-246,406-423` | Components table + project tree omit `agent-memory-service`, `agent-scheduler-service` | Both in `services/` and `services.conf`; same file lists them elsewhere (internal inconsistency) | Add to both tables |
| M3 | `DOCS/architecture/mcp-connections.md:329-332` | SDK plan includes `getUsage(id)` | `sdk/src/resources/mcp-servers/client.ts` has 7 methods, no `getUsage` (backend route exists) | Record as explicit known gap when flipping status |
| M4 | `DOCS/architecture/decision-log.md:51,73` | Only MCP mention is "MCP server as publish interface — Pending" | Shipped feature is the inverse (consume external MCP servers as tools) | Add closed/implemented entry; keep O8/M2 as distinct pending idea |
| M5 | `DOCS/agents/execution.md:12-29` | Only old async model; no streaming | Stream-mode + token pipeline shipped; documented only in `runtime-streaming.md` | Cross-link or merge |
| M6 | `DOCS/agents/adapter-tools.md`, `DOCS/agents/execution.md`, `DOCS/skb/*` | Zero MCP mentions | MCP tool bridge + per-tool enablement (`enabled_mcp_tools`, flag `AGENT_MCP_TOOL_FILTERING_ENABLED`) shipped | Cross-link `mcp-connections.md` |
| M7 | the old `sdk/samples` tier's top-level `README.md` (committed HEAD, since superseded by the `integrations/`/`sdk/examples/` reorg) | "migration underway, only http-bridge SDK-powered" | All samples SDK-powered; accurate rewrite exists **uncommitted** in working tree | Commit the pending rewrite (historical — superseded) |
| M8 | `DOCS/architecture/multi-tenancy.md:274-278` | `buildIngressStreamName`/`buildClaimCheckBucket` in `channel.constants.ts` | Both live in `packages/shared/src/channel.utils.ts` | Fix file column |

## Low-priority drift

| # | Doc file:line | Doc claims | Code reality | Fix |
| --- | --- | --- | --- | --- |
| L1 | `services/connector-runtime/README.md:60,288` | "Max 200 concurrent activity tasks" (self-contradicts :280) | `worker.ts:35` → 400 | Unify on 400 |
| L2 | `services/connector-runtime/README.md:76` | Cache "TTL 300s, stale window 60s" | `packages/shared/src/adapter-client.ts:20-21`: soft TTL 60s, stale-serve window 300s (numbers reversed) | Swap the numbers |
| L3 | `services/connector-admin/README.md` | Documents only `/health` | `/healthz` and `/readyz` also exist | Add rows |
| L4 | `DOCS/adr/variable-system.md:3` | "system-variables controller has no update endpoint" | `system-variables.controller.ts:35-44` has `@Patch(":id")` | Update caveat |
| L5 | `DOCS/architecture/overview.md:117-124` | Related Documents omits runtime-streaming.md, mcp-connections.md | Both describe shipped features | Add links |
| L6 | `cowork/ARCHITECTURE-ANALYSIS.md` | Presents as current mental model | Predates SDK/versioning/streaming/MCP | Add stale banner or archive |
| L7 | `services/admin-console/README.md:64` | "MCP placeholder/page" | Full list (mat-table) + detail page | Update comment |

## Code defects surfaced by the audit (NOT doc drift — docs are accurate about them)

### SKB wiring defects — all 5 STILL PRESENT (unchanged since 2026-07-02)

| # | Defect | Evidence |
| --- | --- | --- |
| 1 | `skb_container_files` table never created but read/written | `schema-initializer.ts` creates 5 SKB tables, not this one; `skb-containers.repository.ts:135,156,164` uses it |
| 2 | `insertRows` arity mismatch hidden by `as any` | Def 6 args (`skb-rows.repository.ts:93-99`); call passes 4 (`skb-ingestion-worker.service.ts:225-230`) |
| 3 | Watchdog stubbed | `skb-containers.repository.ts:195-203` — `findProcessingFilesOlderThan` returns `[]` unconditionally |
| 4 | `skb_query_history` never written | Service registered (`structured-kb.module.ts:13-14,32-33`) but never called from `skb-query.service.ts` |
| 5 | Provider hardcoded openai/gpt-4o | `skb-query.service.ts:216-217`; duplicated default `skb-schema-analyzer.service.ts:108-109` |

### Async/long-running resilience — 1 CRITICAL, 1 HIGH, 2 MEDIUM

See `cowork/ASYNC-RESILIENCE-AUDIT.md` for full detail. Headline: `agent-ai-service`'s NATS consumer runs multi-minute LLM handlers under the default 60s `ackWait` with no `msg.working()` — JetStream redelivers and duplicates in-flight LLM executions.

## Missing docs (new features with no doc home)

1. **API versioning `/api/v1`** — no ADR/decision-log entry, no architecture section, no gateway README coverage. Highest-priority gap.
2. **MCP security model** — new trust boundary (per-tenant outbound calls to external MCP servers; credentials as plaintext `headers` JSON on `mcp_servers`) absent from `security.md`.
3. **Token-streaming observability** — no SSE lifetime metrics/spans; `rt.` prefix absent from overview Key Constants.
4. **SDK capabilities** — DOCS/README.md (entry point) has zero mention of SDK, /api/v1, MCP, or streaming.
5. **Mock LLM provider** (`RUNTIME_ALLOW_MOCK_PROVIDER`) — wired into provider registry, no doc home.
6. **MCP design open questions (§8)** resolved silently by implementation; doc never records resolutions.
7. **Admin API-key guard** (`x-internal-api-key`, disabled when `ADMIN_API_KEY` unset) documented in jobs.md but absent from `security.md`.
8. **Gateway `VERSIONING_EXEMPT_PREFIXES`** — nothing tells a new-controller author whether/how to opt out of versioning.

## Locks — doc/code invariants verified TODAY, worth a cheap guard

The full VERIFIED tables (38 architecture/runbook rows + workflow/SDK/messaging rows) live in the audit agents' outputs; the highest-value locks to actually implement, in order:

| # | Lock | Type | What it pins |
| --- | --- | --- | --- |
| K1 | SDK namespace census: `Object.keys(createClient(...))` = documented 19-name list | unit test in `sdk/` | SDK/docs surface parity |
| K2 | `POST /workflows/:id/execute` → 202 in <200ms with a mocked slow activity | contract test | async workflow submit contract |
| K3 | Transport builds `/api/v1/...` by default and `/api/...` with `apiVersion: null`; gateway answers both, unversioned carries `Deprecation` header | contract test (SDK + gateway e2e) | versioning contract |
| K4 | Workflow action validator: accepted `activity` kinds == doc list; fabricated `channelSend` email shape rejected; `mcpCall` requires `serverId`/`toolName` | unit tests on `IsWorkflowActionArrayConstraint` | action schema truth |
| K5 | Constant snapshots: `WORKFLOW_DEFAULT_TIMEOUT_MS=600000`, `CLAIM_CHECK_THRESHOLD_BYTES=256KB`, `TENANT_HEADER`, `WEBHOOK_FORWARDED_HEADERS` (7), `rt.` stream prefix | snapshot test on `packages/shared` constants | doc'd literals |
| K6 | Doc-check script (CI): service inventory vs `services/*` dirs; Knative min/max-scale annotations vs overview table; alert names vs `alerts.yaml`; referenced script paths exist; archive runbooks keep historical banner; no `ScaledObject` anywhere | static doc guard (extends `DOCS/guides/doc-code-validation-tests.md`) | overview/runbook tables |
| K7 | NATS consumer config census: every durable consumer whose handler can exceed 60s must declare an explicit `ackWaitMs` (assert via a table-driven test over consumer configs) | unit/arch test in `packages/database` consumers | THE critical async invariant |
| K8 | Knative `timeoutSeconds` on ai-agent-gateway/api-gateway ≥ `AGENT_CALL_TIMEOUT_MS` (900s) with margin | CI yq assertion | streaming/long-call ceiling |
| K9 | `resolveTenant()` precedence host → header → query; `dev.local` falls through to header/query | unit test | tenant resolution |
| K10 | MCP DTO enums (`none/api-key/bearer/basic`; `http/sse`) match doc §0.4; tool namespacing `<serverName>:<toolName>` | unit tests | MCP contract |

## Repair order

1. **Flip the two "not implemented" design docs** (H1, H2) — worst reader damage per minute of fix.
2. **Gateway versioning docs** (H3, H7, missing-doc #1) — public API surface.
3. **Workflow docs** (H4, H5, H6) — the README fabrication survived one repair pass already.
4. **Implement locks K1-K7** — before more drift accrues; K7 belongs with the async CRITICAL fix.
5. Medium/low doc fixes in table order; commit the pending rewrite of the old `sdk/samples` tier's top-level `README.md` (see M7 — historical, superseded by the `integrations/`/`sdk/examples/` reorg).
6. Code fixes tracked separately: async findings (see ASYNC-RESILIENCE-AUDIT.md) and the 5 SKB defects.

---

## Appendix (added 2026-08-04, docs-truth-audit T10 — ruling D28): K→G crosswalk

**The rows above are NOT rewritten.** This audit is a RECORD; its K1–K10
numbering is what it proposed on 2026-07-07 and stays as written. The problem
that made this appendix necessary is that the guard script that grew out of it
independently used `K`-numbers too, and the two families collided: this file's
**K9** is tenant-resolution precedence while the script's `K9` was type-only DI
imports, and this file's **K10** is MCP DTO enums while the script's `K10` was
markdown-link resolution.

T10 resolved it by renaming the *implemented* family to a `G` (guard) prefix,
same numbers — `K6a-K6g→G6a-G6g`, `K7→G7`, `K8→G8`, `K9→G9`, `K9b→G9b`,
`K10→G10`, `K11→G11` — and leaving this record alone. The table below is the
only bridge between the two numbering systems.

| This audit's lock | Where it ended up |
| --- | --- |
| **K1** SDK namespace census | Implemented as a test, not a guard: `sdk/test/infrastructure/create-client.test.ts` (it still cites "Lock K1", i.e. this row) |
| **K2** `POST /workflows/:id/execute` → 202 in <200 ms | **Never implemented.** No contract test asserts the latency bound |
| **K3** `/api/v1` default + `Deprecation` header on unversioned | Implemented as a test: `sdk/test/core/versioning-contract.test.ts` ("Lock K3") |
| **K4** workflow action validator vs the doc list | **Never implemented** as a lock. The validator (`IsWorkflowActionArrayConstraint`) has unit tests, but nothing pins them to the doc list |
| **K5** constants snapshot | Implemented as a test: `packages/shared/src/__tests__/doc-locks.constants.test.ts` ("Lock K5") |
| **K6** doc-check script (6 sub-checks) | Implemented as the guard script itself, split into **`G6a`–`G6f`**; **`G6g`** (no per-component `AGENTS.md`) was added later and has no K6 ancestor |
| **K7** durable-consumer ackWait census | Implemented as **`G7`** — as a guard in `doc-code-guards.sh`, not as a `packages/database` arch test as proposed here |
| **K8** Knative `timeoutSeconds` ≥ `AGENT_CALL_TIMEOUT_MS` | Implemented as **`G8`** |
| **K9** `resolveTenant()` precedence | **Never implemented.** The script's `G9` is a DIFFERENT check (type-only constructor-injection imports) that reused the number — the collision this appendix exists for |
| **K10** MCP DTO enums + tool namespacing | **Never implemented.** The script's `G10` is a DIFFERENT check (relative markdown links resolve) that reused the number |

Guards with no K ancestor at all: **`G9b`** (numeric claims vs generated
reality), **`G11`** (dual-backend services document `DB_ENGINE`), **`G12`**
(doc class banner), **`G13`** (doc paths cited from source resolve), **`G14`**
(no new hard-coded hex colours). `G12`–`G14` were born in the T09 ruling round
and never carried a K-number.
