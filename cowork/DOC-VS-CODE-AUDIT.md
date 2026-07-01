# Doc-vs-Code Audit — Platform Cluster

> Goal: compare project documentation against the actual codebase and treat code as the source of truth.
> Date: 2026-07-01.
> Method: split the audit by domain across focused fresh-context agents, using `codebase-memory-mcp` for code discovery plus direct doc/config reads for Markdown, scripts, manifests, and literals.
> Repair status: findings below were fixed in the living docs during the 2026-07-01 repair pass. Keep this file as audit evidence, not as an open TODO list.

## Executive summary

The previous audit was too optimistic. The docs are useful, but several important areas drifted after code moved forward: workflow APIs, admin-console navigation, SKB endpoints, tenant provisioning, connector naming, webhook publish semantics, and agent scheduler config.

**Repair decision:** fixed the docs to match code. If product wants any documented behavior instead, that should become a code change with tests.

| Severity | Count | Main areas |
| --- | ---: | --- |
| High | 14 | Workflows, admin console, SKB, tenant provisioning, API gateway/auth, channel ingress, connector naming |
| Medium | 18 | Config/env names, payload shapes, stream names, storage engine wording, historical runbooks |
| Low | 4 | Inventory/table cleanup and examples |

## Repair order used

1. **Public/API docs first:** workflow-service, API gateway/auth, SKB, connector-admin/runtime.
2. **Runtime architecture docs next:** tenant provisioning, channel ingress/claim-check, messaging envelope examples.
3. **Operator docs after that:** README smoke test, storage/Temporal runbooks, service inventory.
4. **Agent-local docs last:** AGENTS/CLAUDE/CURSOR/GEMINI files and historical SDD notes.

## High-priority mismatches

| Area | Docs | Doc claim | Code source of truth | Correction |
| --- | --- | --- | --- | --- |
| Smoke tests | `README.md` | `scripts/smoke-test.sh` runs the e2e workflow suite. | `scripts/smoke-test.sh` checks Kubernetes service/deployment readiness only; Playwright uses `e2e/sales-agent-setup.spec.ts`; workflow HTTP smoke is `scripts/e2e-http-workflow.sh`. | Describe smoke test as readiness preflight; point workflow/browser e2e to the real commands. |
| Tenant host resolution | `DOCS/architecture/multi-tenancy.md` | Local host tenant source is `<tenant>.dev.local`. | API gateway host pattern is `<env>.<tenant>.yplatform.com`; fallback is `x-yoizen-tenant`, then `?tenant=`. | Document local dev as header/query-based unless `dev.local` support is added. |
| Tenant Postgres provisioning | `services/tenant-service/README.md`, `DOCS/runbooks/storage-engines.md` | Tenant creation deploys a dedicated PostgreSQL StatefulSet. | Shared tier creates logical DB + namespace Secret/ExternalName; dedicated tier creates StatefulSet; `POST /tenants` is async `202 Accepted`. | Document shared vs dedicated tiers explicitly. |
| Tenant-user scope | `services/api-gateway/README.md`, `services/auth-service/README.md` | `POST /auth/tenant-users` is platform-only. | Gateway route allows `@Scopes("platform", "tenant")`; internal auth controller is not platform-only. | Document actual gateway scope behavior. |
| Channel webhook response | `DOCS/channels/channel-service.md` | HTTP 200 is returned before NATS publish. | `WebhooksController.ingest()` awaits `publishWebhook()`; publish failures/backpressure can return 503. | Say 200 happens only after successful publish. |
| Webhook claim-check | `DOCS/channels/channel-service.md`, `DOCS/channels/telegram-sequence.md` | Large `WebhookIngressEnvelope` payloads use claim-check. | API gateway publishes webhook envelopes directly; claim-check is in channel-service canonical publish path. | Scope claim-check to canonical channel envelopes, not stage-1 webhook ingress. |
| Connector naming/API | `services/connector-admin/README.md`, `services/connector-runtime/README.md` | Uses `/adapters`, `adapter-service`, `ADAPTER_SERVICE_URL`. | Current surface is `/connectors` / `/api/connectors`; runtime uses `CONNECTOR_ADMIN_URL`. | Rename docs to connector-admin/connectors; keep adapter names only as legacy aliases where code still supports fallback. |
| SKB file APIs | `DOCS/skb/api.md`, `DOCS/skb/architecture.md` | File upload/list/delete/schema endpoints are implemented. | Agent-admin has container CRUD + query controllers; gateway proxies `POST /containers/:id/files` to a missing agent-admin route. | Mark file APIs pending/broken, or implement missing agent-admin routes later. |
| SKB rate limit | `DOCS/skb/api.md` | 60/min with rate-limit headers. | `SKBRateLimitGuard` is query-only, in-memory, `MAX_REQUESTS = 30`, no headers. | Document 30/min per tenant per process; no headers unless added. |
| Scheduler admin auth | `DOCS/agents/jobs.md` | Admin endpoints require `X-Admin-Api-Key`. | Guard reads `x-internal-api-key`; disabled when `ADMIN_API_KEY` is unset. | Replace header name and mention unset behavior. |
| Workflow lifecycle | `services/workflow-service/README.md`, workflow AGENTS/CLAUDE/CURSOR/GEMINI | `POST /workflows` starts a workflow; `GET /workflows/:id` reads execution status. | `POST /workflows` creates definition; execution is `POST /workflows/:id/execute`; status is `GET /workflows/:id/executions/:executionId`. | Document create/update definition separately from execute/query execution. |
| Workflow action schema | `DOCS/workflows/connector-vs-workflow.md`, `services/workflow-service/README.md` | Examples use `type: "endpointCall"`; README lists `sleep`. | Canonical action field is `activity`; `conditional` exists; `sleep` is not supported. | Replace examples with `activity`, remove `sleep`, add `conditional`. |
| Trace UI route/security | `services/admin-console/src/app/features/processes/trace/README.md`, `DOCS/guides/ui-flows.md` | Trace is under Diagnostics and gated by `diagnostics:read`. | Route is `/processes/trace` under `authGuard`; `MessageTraceComponent` gates data loading with `diagnostics:read`; not listed in Processes sub-nav. | Document direct route plus component-level permission gate, or add route/nav guard code. |
| Admin-console navigation | `services/admin-console/README.md` | Old sidebar sections: Identity & Access, Automation, Data & Integrations, Security, Notifications, Platform. | Current shell has top sections: Overview, Channels, Connections, AI, Processes, Settings. | Rewrite around current header tabs + section sub-nav. |

## Medium-priority mismatches

| Area | Docs | Doc claim | Code source of truth | Correction |
| --- | --- | --- | --- | --- |
| Gateway route prefixes/env | `services/api-gateway/README.md` | Routes omit `/api`; env includes `ADAPTER_SERVICE_URL`. | Gateway has global `/api` prefix; config uses `CONNECTOR_ADMIN_URL`, `PROXY_SERVICE_URL`, `agentMemory`. | Prefix external routes with `/api/*`; replace env names. |
| Connector-runtime concurrency | `DOCS/architecture/overview.md` | Connector runtime maximum activity concurrency is 200. | `services/connector-runtime/src/worker.ts` uses `maxConcurrentActivityTaskExecutions: 400`; workflow docs already say 400. | Update overview to 400. |
| Service inventory | `DOCS/README.md` | Manual Docker loop is service inventory. | `services.conf` also includes `agent-memory-service` and `agent-scheduler-service`; smoke script checks both. | Use `services.conf` or add missing services. |
| Temporal visibility archive | `DOCS/runbooks/archive/temporal-visibility-split.md` | Bootstrap invokes `ensure-temporal-visibility-schema.sh`. | Helper no longer exists; current Temporal config points visibility to `postgres-temporal-rw`; separate visibility cluster is unused in dev. | Mark as historical/non-runnable or update to current dev behavior. |
| Envelope causality example | `DOCS/messaging/envelope.md` | Stage-2 `ChannelEnvelope` has `causation_id: null`, self-correlation, `depth: 0`. | Webhook consumer passes original correlation, sets causation to webhook envelope id, increments depth. | Update example to `causation_id=<webhook-id>`, `depth=1`. |
| `correlation_id` default | `DOCS/messaging/envelope.md` | Broadly defaults to envelope id. | `createChannelEnvelope()` self-correlates; shared `buildEventEnvelope()` uses random UUID unless caller passes correlation id. | Make default producer-specific. |
| Channel storage wording | `DOCS/messaging/ingress.md`, `services/channel-service/AGENTS.md` | Active accounts and health are Mongo-only. | Storage engine defaults to Postgres with Mongo optional; health returns either `{postgres, nats}` or `{mongo, nats}`. | Say configured storage engine/repository. |
| Agent scheduler env | `services/agent-scheduler-service/README.md` | Default `PORT=3010`; leader election uses `POSTGRES_PASSWORD`. | Config defaults `PORT=3000`; leader election uses `LEADER_ELECTION_POSTGRES_URL`. | Fix env table. |
| Execution result payload | `DOCS/agents/execution.md` | Success emits `result.reply`; failure emits `result.errorCode` / `result.errorMessage`. | Handler emits `response`, `usage`, `toolCalls`; failure uses top-level `error`. | Document actual payload shape. |
| Agent-admin config-files routes | `services/agent-admin-service/AGENTS.md` | `GET/PUT /admin/config-files/:id`. | Actual routes: `GET /admin/config-files`, `GET /admin/config-files/file?path=...`, `PUT /admin/config-files`, `POST /deploy`. | Replace ID routes with path-based routes. |
| Agent-admin DB wording | `services/agent-admin-service/AGENTS.md` | Mongo-only DB/connection architecture. | `resolveStorageEngine()` defaults to Postgres; Mongo is optional via `DB_ENGINE=mongo`. | Make Postgres default explicit. |
| Agent-admin adapter wording | `services/agent-admin-service/AGENTS.md` | Proxies to `adapter-service`. | Config prefers `CONNECTOR_ADMIN_URL`, legacy `ADAPTER_SERVICE_URL` fallback. | Rename to connector-admin. |
| Landing aggregation idempotency | `services/admin-console/.sdd/changes/landing-page-aggregation/tasks.md` | `loadUsageTotals()` is guarded/idempotent. | Current service reloads usage totals each time; no guard. | Document repeated fetch or implement guard later. |
| Processes landing top workflows | `services/admin-console/.sdd/changes/landing-page-aggregation/tasks.md` | `topWorkflows()` returns empty/no data. | It now fetches workflow execution counts and renders top workflows. | Update historical/current-state note. |
| Workflow local agent docs | workflow AGENTS/CLAUDE/CURSOR/GEMINI | Queue is `http-adapter`; worker concurrency is 100/50; all activities retry 3 times. | Queue is `connector-runtime`; workflow worker is 200 activity / 150 workflow; HTTP retries are 5 while local activities are 3. | Normalize generated agent docs to current queue/retry/concurrency. |
| Claim-check config/consumer behavior | `DOCS/messaging/claim-check.md` | Per-tenant/per-agent threshold overrides, DLQ on store/resolve failure, and standard envelope reference behavior. | Code has hardcoded threshold copies; channel-service publishes custom claim-check reference object; no implemented per-tenant threshold config; consumer resolve path is not generally wired. | Rewrite claim-check doc around implemented behavior and mark planned behavior explicitly. |
| Stream tier state | `DOCS/messaging/service-bus.md` | Tier selection is not connected. | Some providers call `buildTenantStreamConfig(..., "free")`; shared helper still uses default 256 MB and reconciles. | Say tiers are partially wired with hardcoded fallback and inconsistent reconciliation. |
| Durable name | `DOCS/messaging/service-bus.md` | Agent AI durable shown as `agent-ai-service`. | Code uses `agent-ai-service-consumer`. | Correct durable name. |

## Low-priority mismatches

| Area | Docs | Doc claim | Code source of truth | Correction |
| --- | --- | --- | --- | --- |
| Temporal inventory | `DOCS/runbooks/temporal.md` | Inventory query/table implies `temporal-ui` is included and omits `temporal-metrics`. | `temporal-ui` has different selector; `temporal-metrics` Service exists. | Adjust query/table. |
| Sample stream casing | `sdk/samples/http-fanout-telegram/README.md` | Stream is `INGRESS-acme`. | Stream names are `INGRESS-${tenant.toUpperCase()}`; subjects stay lowercase. | Use `INGRESS-ACME`. |
| Claim-check threshold duplication | `DOCS/messaging/claim-check.md` context | One canonical shared threshold implied. | Shared package has `CLAIM_CHECK_THRESHOLD_BYTES`; agent-ai-service has a local copy with same numeric value. | Mention current duplication or refactor later. |
| Archived/current-state SDD docs | `.sdd/**`, service-local `.sdd/**` | Some archived task docs describe intended current behavior. | Several are historical snapshots and drift from current code. | Add “historical change artifact” disclaimers or exclude them from current-state docs. |

## Verified important claims

- KEDA/ScaledObject removal is consistent with manifests; active dev Knative overlays pin KServices to min/max scale `1`.
- `DOCS/agents/adapter-tools.md` is mostly aligned: adapter execution calls connector-admin, injects `X-Yoizen-Tenant`, and has no cache layer.
- `DOCS/reference/ai-sdk.md` version claims match package manifests for AI SDK/OpenAI/Anthropic packages.
- `http-fanout-telegram` branch concurrency claim is correct: workflow branch arms run via `Promise.all`.
- Admin console Angular version claim is current.
- Message trace still assembles client-side from audit windows plus workflow executions.

## Notes on scope

Included: `DOCS/**`, root docs, service READMEs/agent docs where they make runtime claims, SDK sample READMEs, selected cowork docs, and current-state SDD docs that are easy to confuse with living docs.

Excluded: `node_modules`, installed skill reference libraries, and generated historical artifacts unless they make current-state claims.
