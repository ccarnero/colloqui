# Documentation/code validation test plan

This plan adds automated checks that catch drift between living docs and the current platform code. It is a test plan only; no tests are implemented here.

## Goals

- Treat code and route config as the source of truth.
- Fail fast when docs describe removed endpoints, stale route guards, stale nav sections, or invalid workflow action schemas.
- Keep checks cheap enough to run in CI for docs-only PRs.

## Test categories

| Category | What it protects | Suggested location |
| --- | --- | --- |
| Workflow API contract tests | Definition CRUD vs execution lifecycle routes and response shapes | `services/workflow-service/test/contract/` |
| Workflow action schema tests | Valid `activity` values, rejected legacy `type`, no unsupported `sleep`, accepted `conditional` | `services/workflow-service/test/unit/` or `test/contract/` |
| Admin route/nav tests | Current top sections and direct authenticated trace route | `services/admin-console/src/app/**/__tests__/` |
| Metrics aggregation tests | Landing-page metrics behavior and repeated fetch semantics | `services/admin-console/src/app/core/services/metrics/**/__tests__/` |
| Documentation lint/fixtures | Markdown examples parse against contract fixtures, including generated agent docs | `test/docs/` or repo-level `scripts/` |
| Gateway/auth contract tests | `/api` prefix, downstream env mapping, tenant-user scopes | `services/api-gateway/test/contract/` |
| Tenant provisioning integration tests | Shared vs dedicated Postgres provisioning phases and async `202` create | `services/tenant-service/test/integration/` |
| Channel/messaging contract tests | Webhook publish-before-200, claim-check scope, envelope causality, stream casing | `services/channel-service/test/contract/`, `packages/database/test/unit/` |
| Connector contract tests | `/connectors` surface, `CONNECTOR_ADMIN_URL`, connector-admin split workload docs | `services/connector-admin/test/contract/`, `services/connector-runtime/test/unit/` |
| SKB contract tests | Implemented container/query APIs vs pending file APIs, query rate limit | `services/agent-admin-service/test/contract/` |
| Scheduler contract tests | `x-internal-api-key`, unset `ADMIN_API_KEY`, port/leader-election config | `services/agent-scheduler-service/test/unit/` |
| Agent execution contract tests | `execution_completed` / `execution_failed` payload shape | `services/agent-ai-service/test/contract/` |
| Config/docs static checks | Env var names, stale service aliases, stream casing, removed helper scripts | `scripts/docs-guard.*` or `test/docs/` |

## Candidate tests mapped to current mismatches

| Mismatch caught | Candidate test | Expected assertion |
| --- | --- | --- |
| `POST /workflows` documented as starting a run | Contract test calls `POST /workflows` with valid definition | Returns `201` with definition metadata (`id`, `name`, `actions`), not `executionId` |
| Execution/status route drift | Contract test calls `POST /workflows/:id/execute`, then `GET /workflows/:id/executions/:executionId` | Execute returns `202` and status route returns execution fields |
| Legacy action field `type` | DTO/contract validation sends action with `type: "endpointCall"` and no `activity` | Request is rejected |
| Unsupported `sleep` action | DTO/contract validation sends `activity: "sleep"` | Request is rejected |
| Missing `conditional` docs | DTO/contract validation sends a minimal `activity: "conditional"` with branch/default actions | Request is accepted |
| Trace UI permission drift | Angular route + component tests inspect `/processes/trace` and `MessageTraceComponent` | Route is under authenticated shell with no route-level permission guard; component-level `diagnostics:read` gate blocks data load when missing |
| Trace nav drift | Nav config test inspects `NAV_SECTIONS` | Processes sub-nav contains Workflows/Schedules only unless code intentionally exposes Trace |
| Admin-console old sidebar docs | Nav config snapshot test | Top sections equal Overview, Channels, Connections, AI, Processes, Settings |
| Landing aggregation idempotency drift | Metrics service test calls `loadUsageTotals()` twice with HTTP mocks | Current behavior issues 8 usage-total requests total (4 per call), unless code adds a guard |
| Processes top workflows drift | Metrics service/component test mocks `/workflows` and `/workflows/executions/counts` | `topWorkflows()` renders sorted joined counts, not always empty |
| Gateway `/api` prefix drift | Fastify/Nest contract test or route snapshot checks external paths | Public gateway routes are `/api/*`; docs never advertise bare `/connectors`, `/workflows`, etc. |
| Tenant-user scope drift | Gateway auth controller metadata/unit test | `POST /auth/tenant-users` allows `platform` and `tenant` scopes as implemented |
| Tenant provisioning tier drift | Tenant-service integration test with shared and dedicated tier fakes | Shared tier creates logical DB + Secret/ExternalName; dedicated tier creates StatefulSet; create returns `202` |
| Webhook publish-before-200 drift | Channel/api-gateway contract test mocks JetStream publish failure | Success response waits for publish; publish timeout/failure maps to error/503 behavior |
| Webhook claim-check drift | Contract test sends oversized stage-1 webhook envelope | Stage-1 publishes inline JSON; claim-check is only asserted for canonical channel publish path |
| Envelope causality drift | Unit/integration test for webhook-ingress consumer | Stage-2 envelope carries original `correlation_id`, `causation_id` = stage-1 envelope id, `depth = 1` |
| Stream casing drift | Unit test around `getTenantStreamName("acme")` and sample-doc static guard | Stream name is `INGRESS-ACME`; subject tenant remains `evt.acme...` |
| Connector route/env drift | Connector-admin route test + connector-runtime config test | Public/admin routes are `/connectors`; runtime reads `CONNECTOR_ADMIN_URL` / connector-admin default |
| SKB pending file endpoint drift | Gateway-to-agent-admin contract test or docs guard | File upload/list/delete/schema endpoints are pending until agent-admin implements matching routes |
| SKB rate-limit drift | Guard unit test drives 31 query requests for one tenant | Request 31 is rejected; limit is 30/min in-memory; no rate-limit headers are expected |
| Scheduler admin header drift | Guard unit test with `x-internal-api-key` and `X-Admin-Api-Key` | `x-internal-api-key` is accepted; stale header is rejected; unset `ADMIN_API_KEY` disables admin endpoints |
| Scheduler config drift | Config unit test with empty env and leader URL env | Defaults to `PORT=3000`; leader election reads `LEADER_ELECTION_POSTGRES_URL` |
| Agent execution payload drift | Handler contract test with successful and failing execution | Completed payload has `response`, `usage`, `toolCalls`; failure has top-level `error` |
| Temporal visibility runbook drift | Static docs guard checks referenced helper scripts exist | Archived runbook is marked historical when helper scripts are absent |
| Service inventory drift | Static docs guard compares documented service loop with `services.conf` | Docs either reference `services.conf` or list all services from it |
| Generated agent-doc drift | Static docs guard scans tracked and local mirror docs: `AGENTS`, `CLAUDE`, `CURSOR`, `GEMINI` | No stale `adapter-service`, `ADAPTER_SERVICE_URL`, `/adapters`, FastAPI, `bridge.py`, or Python runtime claims remain unless explicitly marked historical |
| Workflow patterns drift | Docs fixture validator parses `DOCS/workflows/patterns.md` examples | Examples use `activity`, not `type`; execution examples use `/workflows/:id/execute` |
| Agent runtime language drift | Static docs guard compares service package/runtime hints | `agent-ai-service` docs say Bun/TypeScript/Nest, not Python/FastAPI |
| Trace component permission drift | Angular component test mounts `MessageTraceComponent` with/without permission | Without `diagnostics:read`, denial renders and data is not loaded; with permission, data load is allowed |

## Documentation fixture strategy

1. Extract fenced JSON-like workflow examples from `DOCS/workflows/connector-vs-workflow.md` and `services/workflow-service/README.md`.
2. Normalize examples that use ellipses or placeholders into fixtures checked into `test/docs/fixtures/workflows/`.
3. Validate fixture actions with the same DTO/schema path used by the service.
4. Keep examples minimal: one endpoint call, one branch, one conditional, one execute request, one status response.

## Recommended implementation order

1. **Static docs guard** — cheapest: fail on stale aliases (`adapter-service`, `ADAPTER_SERVICE_URL`), generated agent-doc drift, removed helper scripts, bad stream casing, runtime-language claims, and service inventory drift.
2. **Workflow action schema unit tests** — catches `type`, `sleep`, and `conditional` drift.
3. **Workflow API and gateway/auth contract tests** — locks down create-definition vs execute/query, `/api` prefixes, and tenant-user scopes.
4. **Messaging/channel contract tests** — publish-before-200, claim-check scope, envelope causality, stream casing.
5. **Tenant/connector/SKB/scheduler config tests** — covers provisioning tiers, connector routes/env, SKB pending APIs/rate limit, scheduler admin guard/config.
6. **Admin nav/route and metrics tests** — top sections, trace route auth plus component permission behavior, repeated usage-total fetches, top workflows.
7. **Docs fixture validation** — validate markdown examples after stable fixtures exist.
8. **CI wiring for docs PRs** — run static guard plus focused contract/unit tests when owned docs or route/schema files change.

## CI trigger recommendation

Run the focused validation suite when any of these paths change:

- `DOCS/workflows/**`
- `DOCS/guides/ui-flows.md`
- `DOCS/guides/doc-code-validation-tests.md`
- `services/workflow-service/README.md`
- `services/workflow-service/{AGENTS,CLAUDE,CURSOR,GEMINI}.md`
- `services/workflow-service/src/modules/workflows/**`
- `services/workflow-service/src/temporal/workflows.ts`
- `services/admin-console/README.md`
- `services/admin-console/src/app/app.routes.ts`
- `services/admin-console/src/app/layout/nav/nav.config.ts`
- `services/admin-console/src/app/core/services/metrics/**`
- `services/admin-console/src/app/features/processes/trace/**`
- `services/api-gateway/**`
- `services/tenant-service/**`
- `services/channel-service/**`
- `services/connector-admin/**`
- `services/connector-runtime/**`
- `services/agent-admin-service/**`
- `services/agent-ai-service/**`
- `services/agent-scheduler-service/**`
- `packages/shared/src/*adapter*`
- `packages/shared/src/*tenant-stream*`
- `packages/database/src/nats-provider.ts`
- `services.conf`
- `DOCS/workflows/patterns.md`
- `packages/shared/{AGENTS,CLAUDE,CURSOR,GEMINI}.md`
- `services/*/{AGENTS,CLAUDE,CURSOR,GEMINI}.md`

## Implemented: static doc/code guard script (K6, K7, K8)

`scripts/checks/doc-code-guards.sh` implements locks K6, K7, K8 from
`cowork/DOC-VS-CODE-AUDIT.md` (see that file's "Locks" section for the full
rationale). It is a standalone bash script — this repo has no `lefthook.yml`
or CI pipeline yaml yet, so there was no existing aggregate to wire it into.
Run it manually or from a future CI job:

```bash
scripts/checks/doc-code-guards.sh       # quiet: only prints failures
scripts/checks/doc-code-guards.sh -v    # verbose: also prints PASS lines
```

It exits non-zero the moment any guard fails, naming the failing guard ID.

What it pins:

- **K6a** — every service documented in `DOCS/architecture/overview.md`'s
  Service Roles table has a matching `services/*` directory (and vice
  versa). `workflow-service-api` / `workflow-service-worker` are normalized
  to the single `workflow-service` directory.
- **K6b** — no `kind: ScaledObject` resource exists anywhere under
  `knative/` or `infrastructure/` (KEDA was removed).
- **K6c** — the min-scale/max-scale annotations on each
  `knative/services/base/*.yaml` match the "Knative Autoscaling" table in
  `overview.md`. Rows marked `—` (plain Deployment, not Knative-scaled) are
  skipped by design.
- **K6d** — every `scripts/...` and `e2e/...`-shaped path referenced in
  `README.md` / `DOCS/README.md` exists on disk.
- **K6e** — every alert name in `observability.md` §4 ("Implemented
  Alerts") has a matching `alert:` entry in
  `infrastructure/base/observability/prometheus/alerts.yaml`, and
  `TemporalHistoryShardImbalance` does NOT exist in that file (removed; see
  §4.7's note — the guard is careful to only read table rows, not that
  explanatory prose, when extracting "implemented" alert names).
- **K6f** — every runbook under `DOCS/runbooks/archive/` carries a
  "Status: Historical" banner in its first 10 lines.
- **K7** — NATS durable-consumer ackWait census: every registration via
  `MultiTenantConsumerManager`/`ensureDurableConsumer` under `services/`
  must declare an explicit `ackWaitMs`, OR be on an explicit allowlist (with
  a one-line justification) inside the script. A repo-wide scan also fails
  the guard if a brand-new registration site appears that isn't in the
  script's known-files census, forcing a conscious ackWait decision instead
  of silently inheriting the 60s package default (see
  `cowork/ASYNC-RESILIENCE-AUDIT.md` F1: long-running handlers under a
  60s ackWait cause JetStream redelivery and duplicate execution).
- **K8** — `knative/services/base/ai-agent-gateway.yaml` and
  `api-gateway.yaml` both set `spec.template.spec.timeoutSeconds >= 960`
  (900s `AGENT_CALL_TIMEOUT_MS` + margin), and
  `knative/serving/config-defaults.yaml`'s `max-revision-timeout-seconds`
  is at least the same.

**Genuine finding while calibrating K7**: the audit's lock description
assumed only `workflow-service`'s `trigger-consumer` needed allowlisting for
the 60s default. A full repo census found 9 registrations that omit
`ackWaitMs` entirely (auto-reply, both usage-aggregator managers,
webhook-ingress-consumer, execution-projector, ai-agent-gateway's
executions consumer, channel-egress, and both audit-service consumers).
None of their handlers do LLM/embedding calls or large-file processing, so
the implicit 60s default is safe for all 9 today — they are allowlisted
explicitly in the script with a one-line justification each, rather than
silently ignored, so a *future* consumer with a slow handler that forgets
`ackWaitMs` still fails this guard. `workflow-service`'s `trigger-consumer`
in fact already sets `ackWaitMs: 60_000` explicitly (it doesn't rely on the
implicit default) and needs no allowlist entry at all.
