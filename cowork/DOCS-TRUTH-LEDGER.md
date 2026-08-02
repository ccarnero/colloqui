# DOCS-TRUTH-LEDGER.md — one row per documentation artifact

Built by T01 of `manual-loops/architecture/docs-truth-audit.md` on **2026-08-02**.
Filled by T02–T08, adjudicated in T09, executed in T10.

## Purpose

Every documentation artifact in this repo gets exactly one row here, and every
row ends the loop with exactly one verdict. This file is the single place where
"is this document true?" is answered — no verdict lives anywhere else.

## Verdict vocabulary

| Verdict | Meaning |
| --- | --- |
| `pending` | not audited yet (T01 leaves every row here) |
| `TRUE` | verified against the code, kept where it is, unchanged |
| `FIXED` | drift corrected in place — the code won |
| `RECLASSIFIED` | class changed and/or moved/merged into the approved structure |
| `DELETED` | adds nothing; removed (T10 only, after the T09 human round) |

## Rules that bind this ledger

1. **The code is the source of truth.** A doc-vs-code difference is a DOC bug by
   default. If a difference reveals a genuine CODE bug, STOP and escalate as a
   decision — this loop never changes runtime code silently.
2. **No citation, no verdict.** Every `FIXED` row cites the code that
   contradicted the doc (name-based: constant/function/file names, never `:NNN`
   line cites — they rot within days). Every DELETE proposal states what, if
   anything, replaces it. A row with a verdict and an empty Evidence cell is
   invalid and must be sent back.
3. **RECORDS are not audited for present-truth.** `manual-loops/*`, `golden/*`,
   `DRIFT.md`, `cowork/INDEX.md` and friends describe their date. They get
   CLASSIFIED (and dead working notes proposed for deletion in T09), but their
   historical claims are never rewritten.
4. **Prescriptive docs keep their class.** Any clause the code has never honored
   is flagged in the Evidence cell for the T09 round instead of being silently
   "fixed" in either direction.
5. **TAXONOMY.md / SCHEMAS.md / AGENTS.md are read-only** except through an
   escalated decision.

## Class vocabulary

`descriptive` (as-built) · `prescriptive` (contract/how-to the code must obey)
· `future` (design not yet built) · `RECORD` (dated, historical) · `skill`
(agent-facing SKILL.md and its assets) · `script-header` (a shell script's
header comment block, which is that script's document of record) · `fixture`
(sample content shipped as data, not a description of code).

## Reconciliation (T01)

Commands run at the repo root on 2026-08-02, **after** this ledger existed. `-H`
is mandatory: without it fd skips dotted directories and 68 tracked documents
(`.claude/`, `.agents/`, `.sdd/`) vanish from the census.

```
fd -H -e md --type f | wc -l              →  273
git ls-files '*.md' | wc -l               →  272   (= 273 − this ledger, untracked)
fd -e md --type f | wc -l                 →  205   (no -H: 68 hidden docs missing)
fd -H -e md --type f | rg '(^|/)\.' | wc -l → 68   (the hidden surfaces)
fd -H -e sh --type f | wc -l              →   47   (= git ls-files '*.sh')
fd -H -e sh --type f . scripts | wc -l    →   18
fd -H -e sh --type f --max-depth 1 | wc -l →  10
fd -H . skills/*/assets --type f | wc -l  →   12
```

Two files need manual handling and neither can be recovered by any `fd` census:

- `cowork/DOCS-TRUTH-LEDGER.md` (this file) is the audit's **instrument**, not
  one of its subjects: **−1**.
- `CLAUDE.md` is **gitignored** (`.gitignore` line 128, `git check-ignore -v
  CLAUDE.md` confirms) and untracked, so it appears in neither `fd -e md`,
  `fd -H -e md`, nor `git ls-files` — only `fd -I` would show it. It is
  nevertheless a real doc in every working tree and makes a checkable claim
  ("follow AGENTS.md"), so it is added by hand: **+1**.

Arithmetic to the row count:

```
  273  fd -H -e md --type f
-   1  this ledger (instrument, not subject)
+   1  CLAUDE.md (gitignored → invisible to fd/git, added by hand)
-----
  273  markdown rows
+  18  shell scripts under scripts/       (header comment = the document)
+  10  shell scripts at the repo root     (header comment = the document)
+   5  skill assets that make code claims (skills/*/assets/*.ts|json|css)
-----
  306  ledger rows
```

Excluded on purpose, with the reason:

- **19 `.sh` files** = `47 − 18 − 10`: the sample/demo/SDK runners
  (`integrations/*/*/run.sh`, `integrations/channels/telegram-onboard.sh`,
  `integrations/lib/resolve-env.sh`, `demos/crm-support-telegram/{bootstrap,run}.sh`,
  `demos/crm-support-telegram/lib/resolve-demo-env.sh`,
  `sdk/examples/reference-pattern/{run,setup}.sh`). These are the **code
  counterpart** the T06 rows are audited *against*, not documents in their own
  right. T07 owns only `scripts/**` + the root scripts.
- **7 of the 12 `skills/*/assets/*` files**: the brand SVGs and logos under
  `skills/yz-ui/assets/` (`icon.svg`, `logo*.svg`) carry no verifiable claim
  about the code.
- **Nothing else.** Every tracked hidden document is rowed, not excluded: the
  12 agent-facing docs under `.claude/` and `.agents/` are in section U, the 56
  `.sdd/**` change records are in section R.

### The 68 hidden documents (all tracked, all rowed)

| Surface | Files | Why it is tracked | Section |
| --- | --- | --- | --- |
| `.claude/commands/*.md` | 2 | `.gitignore` line 132 `!.claude/commands/` — the written loop is versioned on purpose | U |
| `.claude/agents/*.md` | 2 | `.gitignore` line 133 `!.claude/agents/` — same | U |
| `.agents/skills/adr-skill/**` | 8 | a **second skills root** parallel to `skills/`, prescribing ADR authoring conventions | U |
| `.sdd/changes/**` | 54 | spec-driven-development change records (adr/design/tasks/archive per change) | R |
| `services/admin-console/.sdd/changes/**` | 2 | same, scoped to the console | R |

`2 + 2 + 8 + 54 + 2 = 68`. The 12 `.claude`/`.agents` docs go to section U
rather than T08 so they do not silently inflate a task whose SPEC contract says
"the 11 skills"; T09 assigns their owner. Note the ledger already rowed the
**staged** copy `cowork/staging/manual-loop.command.md` — the **live**
`.claude/commands/manual-loop.md` is now rowed beside it, and T09 must decide
which of the two survives.

Markdown rows per section sum back to 273:
`13 + 35 + 23 + 13 + 30 + 3 + 41 + 101 + 14 = 273`
(section T07 additionally holds the 28 script-header rows and section T08 the 5
skill-asset rows: `273 + 28 + 5 = 306`).

Deltas found against the SPEC's estimates (T01 counted, the SPEC guessed):
`manual-loops` is 40 not 39 (this SPEC itself is new); integrations+demos is 30
not 28; `cowork` is 17 not 16 (`cowork/staging/manual-loop.command.md`); the
root shell surface is 10 scripts, not the 2 the SPEC names; the services tree
holds 3 docs beyond the 20 READMEs; 2 visible doc files (`fixtures/`,
`knative/`) belong to no SPEC task; and the SPEC never mentions the 68 tracked
hidden docs at all — the single biggest surface it missed. All parked per the
table above.

---

## Section T02 — DOCS/messaging + DOCS/architecture (13 rows)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| DOCS/messaging/claim-check.md | descriptive | packages/database `claim-check.ts` + NATS object store users | **FIXED** | §1–§10 re-verified true against `CLAIM_CHECK_THRESHOLD_BYTES`/`CLAIM_CHECK_BUCKET_TTL_NS`/`CLAIM_CHECK_BUCKET_MAX_BYTES` (`channel.constants.ts`), `buildClaimCheckBucket` (`channel.utils.ts`), `IngressService.getClaimCheckBucket`/`publishWithClaimCheck`, `resolveClaimCheckEnvelope` + the 4 `ClaimCheckErrorCode` values (`packages/database/src/claim-check.ts`), `MultiTenantConsumerManager.wrapHandler` + `resolveClaimChecks` flag, `nats.consumer.claimcheck.{resolved,resolve_failed}` (`nats-consumer-metrics.ts`), the 3 producer metrics (`ingress.metrics.ts`), and `ClaimCheckService` still registered-but-unwired (`agent-ai-service/src/app.module.ts` imports `ClaimCheckModule`; no handler calls it). ONE fix: **§4.5 tier sizing** said a "starter/growth/enterprise" table exists only "in the design" — stale since tiers shipped 2026-08-01. `TENANT_TIER_LIMITS` (`packages/shared/src/tenant-stream.constants.ts`) now carries a real `object_store_max_bytes` per `free`/`pro`/`enterprise`, but nothing reads it: `getClaimCheckBucket` still passes flat `CLAIM_CHECK_BUCKET_MAX_BYTES`/`_TTL_NS`. Rewrote to "declared but not wired" with the tier names the code uses. |
| DOCS/messaging/envelope.md | prescriptive | packages/shared `envelope.utils.ts`; SCHEMAS.md | **FIXED** | Contract clauses left intact per rule 4; four descriptive drifts corrected + five `:NNN` cites converted. (1) **§2.1 `producer`** listed 5 active producers; code has 11 — `CHANNEL_PRODUCER`, `REGISTRY_PRODUCER`, `AGENT_ADMIN_PRODUCER`, `AGENT_MEMORY_PRODUCER`, `AGENT_SCHEDULER_PRODUCER`, `AI_AGENT_GATEWAY_PRODUCER` (`constants.ts`) + literal `"api-gateway"`, `"agent-ai-service"`, `"connector-runtime"`, `"provisioning-service"`, `"workflow-service"`. (2) **§3.1** claimed `dlq.<tenant>.>` "does not use the canonical envelope" — false: `MultiTenantConsumerManager.buildTenantDlqHandler` republishes `msg.data` verbatim with `X-Dlq-*` headers, and `IngressService.publishWithClaimCheck` DLQs the full inlined envelope. `audit.gateway.>` claim is true (`publishGatewayAuditEvent` sends a `GatewayAuditEvent`). (3) **§10.3/§10.4** examples had invented `type`/`source`: real values are `EVENT_TYPES.AGENT_PUBLISHED` = `io.yoizen.platform.admin.agent.published.v1` with `source: "//agent-admin-service/admin/agents/publish"`, and `io.yoizen.platform.runtime.execution_requested.v1` with `source = ExecutionClient.serviceName` (`packages/shared/src/execution-client.ts`). (4) **§12** said `EVENTS`/`RESULTS` are "deprecated and marked in constants.ts" — they are **gone**: `rg '"EVENTS"\|events\.>' packages/shared` returns nothing; also corrected "shared DLQ" → global `DLQ` owns only `dlq.webhook` (`DLQ_STREAM_SUBJECTS`) while `dlq.<tenant>.>` belongs to per-tenant `DLQ-<tenant>` (`ensureTenantDlqStream`). Verified-unchanged: §4.1 secret strip (`WEBHOOK_SECRET_HEADERS` + `WebhookIngressService.stripSecretHeaders`), §6.3 `MAX_DEPTH_BY_CATEGORY`, §7 `duplicate_window` never configured, §8 audit chain routes. **FLAGGED for T09 (clauses the code has never honored, NOT edited):** §2.1 `type` prescribes `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` but `agent-admin-service`, `execution-client.ts` and `SCHEDULER_HEARTBEAT_TYPE` all emit `io.yoizen.platform.<area>.…`; §2.1 + §11 `source` says "`//channel-service/accounts/<id>` or `//api-gateway/webhooks` — do not invent new formats" while agent-admin emits `//agent-admin-service/admin/agents/publish` and agent-ai emits a bare `"agent-ai-service"`. |
| DOCS/messaging/ingress.md | descriptive | channel-service webhook bridge; agent-ai-service pipelines | **FIXED** | (1) **§1/§2.1/§4.4/§7 endpoint paths** dropped the `api` global prefix — `@Controller("webhooks")` under `app.setGlobalPrefix("api")` (`api-gateway/src/main.ts`), so it is `/api/webhooks/...` (§3.2 already said so — the doc contradicted itself). (2) **§5** said the execution lifecycle "is published by `ai-agent-gateway`" — false: `ai-agent-gateway` only SUBSCRIBES (`ExecutionsService.streamExecutionEvents`, `EXECUTION_RESULT_EVENT_SUBJECTS`); the publisher is `agent-ai-service`'s `ExecutionHandler.publishStatus`, which composes the `ai-agent-gateway` subject family by hand while its envelope's `producer` says `agent-ai-service`. Also added the second lifecycle family nobody documented (`workflow-service`'s `execution-completed-publisher.activity.ts`). (3) **§8.2 example** still showed `x-hub-signature-256` in stage-2 `data.headers`, contradicting the 2026-08-01 secret strip and §3.3 of the same file. (4) 4 `:NNN` cites → `WebhookIngressPublisherService.{publishWebhook,filterHeaders}`, `WebhookIngressConsumerService.normalizeHeaders`, `createChannelSentEnvelope`, `MAX_DEPTH_BY_CATEGORY`, `DepthTrackerService`. Verified-unchanged: durable `channel-webhook-ingress` + `WEBHOOK_INGRESS_SUBJECT_FILTER` + concurrency 32 (`WEBHOOK_INGRESS_HANDLER_CONCURRENCY`), inflight cap/timeout (`gatewayConfig.webhook`: `WEBHOOK_PUBLISH_INFLIGHT_CAP`=200, `WEBHOOK_PUBLISH_TIMEOUT_MS`=10000), `{status:"accepted"}`, `unknown_instance`/`signature_mismatch`, `kind: "webhook_received"` really is a field on `WebhookIngressEnvelope`. |
| DOCS/messaging/service-bus.md | descriptive | packages/database `nats-provider.ts`, `nats-durable-consumer.ts` | **FIXED** | (1) **Cluster topology** described a prod/staging/dev matrix and a `nats` namespace — neither exists. Overlays set `namespace: support-services-dev` (`overlays/{local,orbstack}/{dev,mongo-dev}`, `overlays/mongo-dev`), and all four dev bases pin `replicas: 1` + `data` PVC 2Gi over the base's 3 / 50Gi — `infrastructure/overlays/local/{local-base,mongo-local-base}/patches/nats-resources.yaml` and `infrastructure/overlays/orbstack/{orbstack-base,mongo-orbstack-base}/patches/nats.yaml` (the orbstack family names the file differently). Rewrote as base-vs-dev-overlay. (2) **"Core NATS is used only for … `platform.tenant.deleted`"** was false and the core-NATS subgraph named one subject: the shipped runtime-streaming pipeline is a second live core-NATS producing surface — `ExecutionHandler.publishToken` (`nc.publish` on `buildRuntimeStreamSubject(…, RUNTIME_TOKEN)`) and `YoizenClawExecutionClient.publishCancel` (`…RUNTIME_CANCEL`), with `RUNTIME_STREAM_SUBJECT_PREFIX` deliberately outside `evt.` so no stream binds it. Replaced with a two-row table naming both, plus the `rpc.channel-service.webhook.verify.v1` request/reply pattern and the subscribe-only SSE relays, cross-linked to `runtime-streaming.md` §1.1. Added the caveat that `platform.tenant.>` DOES fall inside `PLATFORM_TENANTS`'s Workqueue filter (`tenant-service/src/providers/nats.module.ts`), so `rt.*` and `rpc.*` are stream-free but `platform.tenant.deleted` is not — the mermaid subgraph is therefore labelled "Core NATS transport (nc.publish / nc.subscribe)", which is true of all three rows, with the bound/stream-free status annotated per row rather than asserted in the header. (3) **Stream Topology diagram** contradicted the doc's own durable table and the envelope.md producer census: regenerated the `INGRESS-<tenant>` producer list to the same 11 as `envelope.md` §2.1 (was 7 — missing agent-ai-service, agent-scheduler-service, connector-runtime, workflow-service) and the consumer list to the 10 services registering `TENANT_STREAM_PATTERN`/`INGRESS_STREAM_PATTERN` (was 6 — missing agent-admin-service, ai-agent-gateway, connector-runtime, tracking-ingester-service); DLQ-<tenant> producers/consumers named concretely. Added a note that the 7-name safety-net list is a deliberate subset (callers of the lazy ensure), not a contradiction. (4) 4 `:NNN` cites in the durable-name list → `TENANT_PROVISIONER_DURABLE`, `GATEWAY_AUDIT_CONSUMER_NAME`, `USAGE_INGRESS_DURABLE`/`USAGE_DLQ_DURABLE`, `TRK_DURABLE_PREFIX`. Verified-unchanged: server config is byte-identical to `infrastructure/base/nats/configmap.yaml` (`max_mem: 256MB`, `max_file: 50GB`, `max_payload: 1MB`, `max_pending: 64MB`, `write_deadline: 10s`); the 14 `DURABLE_NAME` constants match `rg -o 'DURABLE_NAME = "…"' services` exactly; `CHANNEL_STREAM_MAX_AGE_NS`/`CHANNEL_STREAM_MAX_BYTES`/`CHANNEL_MAX_DELIVER`; `PLATFORM_TENANTS_STREAM_NAME` + `msgID: params.tenantId`; DLQ header set matches `buildTenantDlqHandler`; tier + safety-net sections re-checked cheaply per the task's RECENTLY-VERIFIED list. |
| DOCS/messaging/tenant-messaging-tiers.md | descriptive | packages/shared `tenant-stream.constants.ts`; tenant-service tiers | **TRUE** | Cheap re-check (shipped 2026-08-01) — every number holds. `TENANT_TIER_LIMITS`: free 7d/1073741824/1048576/1, pro 14d/5368709120/1048576/1, enterprise 30d/21474836480/1048576/3. `clampTenantStreamLimits` caps only `max_bytes`/`num_replicas`; `readMessagingCeilingsFromEnv` throws on set-but-invalid. Dev overlay pins `MESSAGING_MAX_BYTES_CEILING=536870912` / `MESSAGING_MAX_REPLICAS_CEILING=1` (`overlays/local/{postgres,mongo}-dev/env-patches.yaml`) with the 2 GiB comment. The "(11) other lazy-ensure call sites" count is exact: 12 production `ensureTenantIngressStream(...)` call sites, minus `TenantProvisioningExecutor`'s `{ limits }` one. `checkJetStreamCapacity` uses `max(used, reserved)` via `sumReservedStreamBytes`; `object_store_max_bytes` present but unread. |
| DOCS/architecture/decision-log.md | RECORD | repo-wide (dated decisions) | **FIXED** | RECORD — dated rows untouched per ground rule 2. Two rotting POINTERS repaired (not claims): O3's `channel.constants.ts:55` → name-based `WEBHOOK_FORWARDED_HEADERS` in `packages/shared/src/channel.constants.ts`; O21's "messaging/service-bus §5" → "DLQ Lifecycle" (that document has named headings, no numbered sections, so §5 resolved to nothing). Structural claims verified: all 6 `DOCS/adr/*.md` files named in the ADR table exist; `setup-tenant.sh` exists at the repo root; `acme-dev-ns` matches `tenantKubernetesNamespaceName` (`{tenantId}-{environment}-ns`); `x-yoizen-tenant` = `TENANT_HEADER`. **T09 disposition note:** this file is classed RECORD but its own §"This log vs DOCS/adr" says "rows are amended in place as status changes" and D8 was amended 2026-08-01 — it is a live status register, not history. Propose RECLASSIFY to `hybrid (register)` or split the dated migration section out. |
| DOCS/architecture/infrastructure.md | descriptive | knative/ overlays; bootstrap-*.sh | **FIXED** | One fix: the support-services table said tenant-isolated DBs are provisioned "via CloudNativePG". They are not — `tenant-service`'s `postgres.provider.ts`/`postgres-usage.provider.ts` call `createNamespacedStatefulSet` with `TENANT_POSTGRES_IMAGE` (default `pgvector/pgvector:pg17`, `services/tenant-service/src/config.ts`); CNPG (`apiVersion: postgresql.cnpg.io`) backs only the shared/usage/temporal clusters under `infrastructure/base/postgres/`. Everything else verified TRUE: standalone Redis StatefulSet `replicas: 1` (`base/redis/statefulset.yaml`) + `REDIS_CLUSTER_MODE` in the env patches; single `temporalio/auto-setup:1.28.4` Deployment `replicas: 1` with `temporal.io/role: frontend` and both `POSTGRES_SEEDS`/`VISIBILITY_POSTGRES_SEEDS` = `postgres-temporal-rw`; `temporal` Service exposes 7233; no `ScaledObject` anywhere under `knative/`; `overlays/_components/` holds only `README.md`; the four named overlay dirs all exist. |
| DOCS/architecture/mcp-connections.md | descriptive | connector-admin + connector-runtime MCP; admin-console connections | **FIXED** | Status header re-checked cheaply per the task list. Only fix: one `:NNN` cite (`workflow.interfaces.ts:73-81` → name-based `EndpointCallArgs`), which still resolved but is the exact smell ground rule 4 names. Every as-implemented claim in the 2026-07-07 delta verified: controller routes are `@Get()`, `@Post("usage-events")`, `@Get(":id")`, `@Get(":id/tools")`, `@Get(":id/usage")`, `@Post(":id/test")`, `@Post()`, `@Patch(":id")` (PUT→PATCH did land), `@Delete(":id")`; `mcp_call_events` exists as a single shared table with no `source` column (`mcp-usage.postgres.repository.ts`); `sanitizeMcpToolKey` + `enabled_mcp_tools` + `AGENT_MCP_TOOL_FILTERING_ENABLED` + `MCP_INTERNAL_SCOPE_ENABLED` all present; `connector-runtime/src/activities/mcp-call.activity.ts` + `validate-outbound-url.ts` SSRF guard present; SDK ships `listTools`/`testConnection`/`getUsage` and `McpCallArgs`/`McpCallAction` in `sdk/src/resources/workflows/types.ts`. §0/§1–§8 stay a design RECORD as the header says. |
| DOCS/architecture/multi-tenancy.md | descriptive | tenant-service; packages/database multi-tenant providers | **FIXED** | (1) **§6.2** put the platform PostgreSQL "in the `platform-services-dev` namespace" — wrong layer: `POSTGRES_HOST` is `postgres.support-services-dev.svc.cluster.local` in `overlays/local/postgres-dev/env-patches.yaml`; `platform-services-dev` is the SERVICES namespace. (2) **§6.3** listed `INGRESS-<TENANT>` retention as a flat 7d/256 MB — tier-dependent since 2026-08-01; the flat pair is now only the lazy-ensure fallback. (3) 6 `:NNN` cites → name-based, two of which were already **stale** — the removed `tenant-stream.constants.ts:58-59` and `channel.constants.ts:80-82` no longer point at `getTenantStreamName` / `buildDlqStreamName` at all — direct proof of ground rule 4. (4) cosmetic: link label `../../messaging/claim-check.md` → `messaging/claim-check.md` (href was already right). Verified TRUE: `HOST_PATTERN = /^[^.]+\.([^.]+)\.yplatform\.com$/` and the host→header→query order in `resolveTenantIdFromHttpRequest`; `ChannelAccount` field list matches `channel.interfaces.ts` exactly; DLQ 30d/512 MB and PAYLOAD 7d/512 MB; `postgres-config` ConfigMap + `init.sql` + ExternalName Service in `postgres.provider.ts`. |
| DOCS/architecture/observability.md | descriptive | packages/observability; knative grafana/tempo overlays | **TRUE** | Nothing to fix. All 21 metric names match the emitters verbatim (`ingress.metrics.ts` 9, `egress.metrics.ts` 3, `nats-consumer-metrics.ts` 5, `http-metrics.ts` 3, `circuit-breaker-metrics.ts` 5). `IStructuredLogFields` = exactly the 12 fields §3.1/§8.3 list, with no `payload`. Every alert group and expression matches `infrastructure/base/observability/prometheus/alerts.yaml` (`api-gateway`, `services`, `nats`, `nats-dlq`, `temporal-postgres`, `temporal-server`, `nats-consumer-lag`), including the consumer_name regex and the removal of `TemporalHistoryShardImbalance`. §6 verified against `telemetry.ts` (`W3CTraceContextPropagator`, `AsyncLocalStorageContextManager`, `/v1/traces` + `/v1/metrics`, `OTEL_EXPORTER_OTLP_ENDPOINT`) and `nats-propagation.ts`. SSE + agent metrics correctly reported absent. **T09 note (config, not doc):** `alerts.yaml` monitors two durables that no longer exist anywhere in `services/` — `webhook-dispatcher` and `event-processor`. The doc faithfully reports the alert, so it stays TRUE; the *alert* is stale and needs an infra ticket. |
| DOCS/architecture/overview.md | descriptive | services/* topology | **FIXED** | Densest drift of the 13. (1) **Gateway endpoint table** advertised `POST /api/v1/events`, `GET /api/v1/results/:id`, `GET /api/v1/events/stream` — **none exist**; there is no events/results module under `services/api-gateway/src/modules/`. Rewrote from the 27 real `@Controller(...)` declarations, adding the 11 `admin/*` controllers, `dashboard`, `provisioning`, `proxy`, `tracking`, `audit/channel-events`, `connectors/:id/.../invoke`, `channels/stream` (SSE), `auth/tenant-{users,roles}`, and the unversioned `/api/webhooks/...`. (2) **Markdown corruption**: 3 Tech Stack rows (`IaC`/`Validation`/`K8s Client`) were stranded at EOF under the claim-check section — moved back into the table and corrected against `package.json` (`@kubernetes/client-node` = tenant/registry/provisioning/`@yoizen/database`; class-validator in 16 services). (3) `WORKFLOW_DEFAULT_TIMEOUT_MS` is `600_000`, not `60000`. (4) `STREAM_MAX_AGE_NS` and `MAX_DELIVER` were credited to "all stream provisioning"/"all durable consumers" — **neither has a production caller**; `nats-durable-consumer.ts` uses a local `DEFAULT_MAX_DELIVER`, channels use `CHANNEL_*`, connector-admin shadows `MAX_DELIVER` locally. (5) `EventData` was shown with a nonexistent `checksum` field and no `received_at`/`payload_bytes`/`payload_checksum`. (6) `WorkflowAction` listed 5 of 9 members (`workflow.interfaces.ts`); the Action Types table missed `channelSend` and `conditional`. (7) audit `events` DDL missed `correlation_id`/`causation_id`/`depth` + the 5 indexes (`audit.postgres.repository.ts`). (8) auth schema missed `tenants` and the per-tenant `tenant_users`/`tenant_roles`. (9) API-gateway autoscaling: `metric: rps`, `target: "500"`, not concurrency 100 — and the dev overlay pins every ksvc to `min=max=1`, which the table never said. (10) Support-services resources table was wrong on 3 of 5 rows (NATS 100m/256Mi/2Gi, Redis 150m req, tenant PG 50m/64Mi/1Gi from `postgres.provider.ts`). (11) `tracking-ingester-service` was in the roles table but absent from the topology diagram and unexplained in the autoscaling table (worker-only Deployment); `agent-admin-service-worker` was missing from the split-service note. (12) `main.ts:98-110` cite → `setGlobalPrefix`/`enableVersioning`. Verified TRUE: SDK's 21 resource namespaces match `sdk/src/resources/*` exactly; all other ksvc min/max/target values; `REGISTRY_DOMAIN` row (per the RECENTLY-VERIFIED list). |
| DOCS/architecture/runtime-streaming.md | descriptive | agent-ai-service token publish; ai-agent-gateway SSE relay; api-gateway passthrough; sdk `runtime.stream()` | **FIXED** | Status header re-checked cheaply per the task list; the pipeline is fully shipped (`RUNTIME_STREAM_SUBJECT_PREFIX`/`buildRuntimeStreamSubject`/`RUNTIME_TOKEN…` in `constants.ts`, `runtime-stream.interfaces.ts`, `pipe-upstream-sse-to-reply.util.ts`, `@Post("stream")` on both runtime controllers, `sdk/src/resources/runtime/client.ts` `stream()`, `STREAM_RELAY_MAX_BUFFERED_BYTES` 256 KiB, `timeoutSeconds: 3600` on both ksvc files, `MockLanguageModelV3` + `RUNTIME_ALLOW_MOCK_PROVIDER_ENV`). Fixes: (1) **§0 header said "As-built baseline (what exists today)"** while listing the SDK as having no `stream()` — the section is a 2026-07-05 PRE-implementation trace; re-titled and banner-marked as superseded RECORD. (2) **§8 "Open questions (need user input)"** — all four are answered by the code; rewrote as resolved with the deciding identifiers, incl. the real answer to Q1: **token-only shipped** — `ExecutionHandler` publishes `RUNTIME_TOKEN` only and never `RUNTIME_TOOL_CALL`/`RUNTIME_TOOL_RESULT`, even though the relay and the SDK types carry both end-to-end. (3) §5.2 named `MockLanguageModelV2`; code imports `MockLanguageModelV3` from `ai/test`. (4) §6 marked the ksvc timeout change as pending; it shipped. (5) `chat.service.ts:152` cite → the verbatim TODO text; the removed cite no longer points at that TODO — another stale `:NNN`. |
| DOCS/architecture/security.md | descriptive | auth-service; api-gateway guards; packages/shared `auth.constants.ts` | **FIXED** | (1) **§4.1** said stage 1 carries the signature headers "in `forwarded_headers`" — no such field exists on any envelope type; it is `data.headers` (`IWebhookIngressData`), and `EventTransport` has no header field at all. (2) **§6.2** listed in-transit TLS 1.3 as "Required in prod" — there is no prod and no TLS: `infrastructure/base/nats/configmap.yaml` has no `tls {}` block and every service connects over `nats://…:4222` (`NATS_URL`). Restated as "not configured", which is also the honest input to O16. (3) 2 `:NNN` cites → `WEBHOOK_FORWARDED_HEADERS`, Telegram provider's `signatureHeader`. Verified TRUE: single-account NATS with no accounts/users/authorization blocks; the 7 forwarded + 4 secret headers; `timingSafeEqual` in `telegram.provider.ts`; DLQ paths and headers; `ClaimCheckErrorCode` values; `envelopeLogFields`/`IStructuredLogFields` PII rule; `http.server.request.total`; `mcp_servers` auth types + plaintext `auth_config` risk + `validate-outbound-url.ts` SSRF guard; `AdminApiKeyGuard` fails closed on missing `ADMIN_API_KEY` with `x-internal-api-key`. |

Class notes (T01) — neither of these two is `future`, despite living beside
design docs and being titled "— Design":

- `mcp-connections.md` opens with `Status: Implemented (commit c4da71a)` and
  carries an "As-implemented delta (2026-07-07)" section → **descriptive**, with
  a design record embedded. T02 audits the as-built claims and the "known gap"
  list; the historical design body below the delta is RECORD and is not rewritten.
- `runtime-streaming.md` opens with `Status: Implemented (commit 4d77d0a; SDK
  e2e 61/61 passing)` → **descriptive**. T02 verifies the named path
  (`agent-ai-service` → NATS subject → `ai-agent-gateway` SSE → `api-gateway`
  passthrough → `runtime.stream()`), not whether the design is a good idea.

## Section T03 — remaining DOCS dirs (35 rows)

ADRs are parked as `RECORD (ADR)`; T03 confirms or re-classes each one per the
SPEC's "adr/v_next verify class rules" clause — an ADR that makes present-tense
claims about the code is descriptive and must be audited as such.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| DOCS/adr/agent-architecture-improvements.md | RECORD (ADR) | agent-ai-service context pipeline + skill routing | pending | |
| DOCS/adr/connector-runtime-separation.md | RECORD (ADR) | connector-runtime; connector-admin | pending | |
| DOCS/adr/rag-system.md | RECORD (ADR) | agent-admin-service KB; agent-ai-service retrieval tools | pending | |
| DOCS/adr/temporal-and-nats.md | RECORD (ADR) | workflow-service Temporal; packages/database NATS providers | pending | |
| DOCS/adr/tenant-postgres-model.md | RECORD (ADR) | packages/database postgres engine; tenant-service | pending | |
| DOCS/adr/variable-system.md | RECORD (ADR) | agent-admin-service `system-variables`; workflow-service resolution | pending | |
| DOCS/agents/adapter-tools.md | descriptive | agent-ai-service adapter tools; packages/shared `adapter-*.ts` | pending | |
| DOCS/agents/execution.md | descriptive | agent-ai-service execution; ai-agent-gateway | pending | |
| DOCS/agents/jobs.md | descriptive | agent-scheduler-service `scheduler` module | pending | |
| DOCS/agents/long-running-executions.md | descriptive | agent-ai-service long-running executions; workflow-service | pending | |
| DOCS/agents/memory.md | descriptive | agent-memory-service | pending | |
| DOCS/channels/channel-service.md | descriptive | channel-service | pending | |
| DOCS/channels/instagram.md | descriptive | channel-service Instagram provider | pending | |
| DOCS/channels/meta-provider-pattern.md | descriptive | channel-service Meta providers (WhatsApp/Instagram) | pending | |
| DOCS/channels/telegram-sequence.md | descriptive | channel-service Telegram provider; workflow-service trigger | pending | |
| DOCS/guides/dev-mode.md | prescriptive | dev-mode.sh; scripts/validate-dev-mode.sh; scripts/dev-poll-reload.sh | pending | |
| DOCS/guides/doc-code-validation-tests.md | prescriptive | scripts/checks/doc-code-guards.sh; per-service doc-claim tests | pending | |
| DOCS/guides/onboarding.md | prescriptive | bootstrap-*.sh; scripts/{orbstack,minikube}/startup.sh | pending | |
| DOCS/guides/trace-console.md | descriptive | admin-console trace feature; tracking-ingester-service | pending | |
| DOCS/guides/ui-flows.md | descriptive | admin-console features/* | pending | |
| DOCS/reference/ai-sdk.md | descriptive | agent-ai-service Vercel AI SDK usage | pending | |
| DOCS/runbooks/storage-engines.md | prescriptive | packages/database postgres/mongo engines | pending | |
| DOCS/runbooks/temporal.md | prescriptive | workflow-service Temporal; knative temporal overlays | pending | |
| DOCS/runbooks/archive/README.md | RECORD | meta (archive index) | pending | |
| DOCS/runbooks/archive/temporal-ha-migration.md | RECORD | knative temporal overlays (historical migration) | pending | |
| DOCS/runbooks/archive/temporal-visibility-split.md | RECORD | postgres-temporal overlays (historical migration) | pending | |
| DOCS/skb/api.md | descriptive | agent-admin-service `structured-kb` controllers; api-gateway admin routes | pending | |
| DOCS/skb/architecture.md | descriptive | agent-admin-service `structured-kb` modules | pending | |
| DOCS/skb/runbook.md | prescriptive | agent-admin-service skb ingestion worker + watchdog | pending | |
| DOCS/skb/security.md | descriptive | agent-admin-service skb NL→SQL pipeline | pending | |
| DOCS/workflows/connector-vs-workflow.md | descriptive | connector-runtime vs workflow-service | pending | |
| DOCS/workflows/engine.md | descriptive | workflow-service engine | pending | |
| DOCS/workflows/patterns.md | prescriptive | workflow-service step types; integrations samples | pending | |
| DOCS/README.md | descriptive | meta (DOCS tree index) | pending | |
| DOCS/v_next/README.md | future | meta (v_next class + promotion rule) | pending | |

## Section T04 — service docs (23 rows)

The SPEC names 20 service READMEs; T01 found 3 further docs inside the services
tree, listed at the end of this section.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| services/admin-console/README.md | descriptive | services/admin-console | pending | |
| services/agent-admin-service/README.md | descriptive | services/agent-admin-service | pending | |
| services/agent-ai-service/README.md | descriptive | services/agent-ai-service | pending | |
| services/agent-memory-service/README.md | descriptive | services/agent-memory-service | pending | |
| services/agent-scheduler-service/README.md | descriptive | services/agent-scheduler-service | pending | |
| services/ai-agent-gateway/README.md | descriptive | services/ai-agent-gateway | pending | |
| services/api-gateway/README.md | descriptive | services/api-gateway | pending | |
| services/audit-service/README.md | descriptive | services/audit-service | pending | |
| services/auth-service/README.md | descriptive | services/auth-service | pending | |
| services/cache-service/README.md | descriptive | services/cache-service | pending | |
| services/channel-service/README.md | descriptive | services/channel-service | pending | |
| services/connector-admin/README.md | descriptive | services/connector-admin | pending | |
| services/connector-runtime/README.md | descriptive | services/connector-runtime | pending | |
| services/provisioning-service/README.md | descriptive | services/provisioning-service | pending | |
| services/proxy-service/README.md | descriptive | services/proxy-service | pending | |
| services/registry-service/README.md | descriptive | services/registry-service | pending | |
| services/tenant-service/README.md | descriptive | services/tenant-service | pending | |
| services/tracking-ingester-service/README.md | descriptive | services/tracking-ingester-service | pending | |
| services/usage-aggregator-service/README.md | descriptive | services/usage-aggregator-service | pending | |
| services/workflow-service/README.md | descriptive | services/workflow-service | pending | |
| services/api-gateway/OPENAPI-TODO.md | future | api-gateway OpenAPI decorators (coverage gaps) | pending | |
| services/admin-console/src/app/features/processes/trace/README.md | descriptive | admin-console processes/trace feature | pending | |
| services/agent-ai-service/skills/code-review/SKILL.md | skill | agent-ai-service skill loading (shipped sample skill) | pending | |

## Section T05 — packages + SDK docs (13 rows)

`sdk/examples/*` rows are co-owned with T06 (its "how to run vs run.sh reality"
check); T05 owns the verdict, T06 supplies runner evidence.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| packages/angular-shared/README.md | descriptive | packages/angular-shared | pending | |
| packages/database/README.md | descriptive | packages/database | pending | |
| packages/observability/README.md | descriptive | packages/observability | pending | |
| packages/shared/README.md | descriptive | packages/shared | pending | |
| packages/testing/README.md | descriptive | packages/testing | pending | |
| sdk/README.md | descriptive | sdk/src (client + resources) | pending | |
| sdk/GROWTH-PLAN.md | future | sdk/src resource coverage ("verified YYYY-MM-DD" headers) | pending | |
| sdk/CHANGELOG.md | RECORD | sdk/package.json versions | pending | |
| sdk/ci-notes.md | future | sdk CI (proposal, no pipeline yet) | pending | |
| sdk/test/e2e/README.md | descriptive | sdk/test/e2e suites vs live cluster | pending | |
| sdk/examples/README.md | descriptive | sdk/examples/* | pending | |
| sdk/examples/reference-pattern/README.md | descriptive | sdk/examples/reference-pattern (src + run.sh + setup.sh) | pending | |
| sdk/examples/reference-pattern/README.es.md | descriptive | sdk/examples/reference-pattern (ES twin of the above) | pending | |

## Section T06 — integrations, demos, examples (30 rows)

Each sample README is audited against its own `manifest.yaml`, `src/`, `run.sh`
and `integrations/lib/resolve-env.sh` (demos: `lib/resolve-demo-env.sh`).

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| integrations/README.md | descriptive | integrations/* sample catalogue; integrations/lib/resolve-env.sh | pending | |
| integrations/ai/ai-agent-playground/README.md | descriptive | ai-agent-playground manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-agent-playground/README.es.md | descriptive | ai-agent-playground (ES twin) | pending | |
| integrations/ai/ai-agent-triage/README.md | descriptive | ai-agent-triage manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-agent-triage/README.es.md | descriptive | ai-agent-triage (ES twin) | pending | |
| integrations/ai/ai-call-center-supervisor/README.md | descriptive | ai-call-center-supervisor manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-call-center-supervisor/README.es.md | descriptive | ai-call-center-supervisor (ES twin) | pending | |
| integrations/ai/ai-knowledge-base-agent/README.md | descriptive | ai-knowledge-base-agent manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-knowledge-base-agent/README.es.md | descriptive | ai-knowledge-base-agent (ES twin) | pending | |
| integrations/ai/ai-knowledge-base-agent/docs/support-faq.md | fixture | KB ingestion payload for that sample | pending | |
| integrations/ai/ai-skill-support-agent/README.md | descriptive | ai-skill-support-agent manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-skill-support-agent/README.es.md | descriptive | ai-skill-support-agent (ES twin) | pending | |
| integrations/ai/ai-skill-support-agent/policy/acme-telco-policy.md | fixture | skill content ingested by that sample | pending | |
| integrations/ai/ai-system-variables/README.md | descriptive | ai-system-variables manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-system-variables/README.es.md | descriptive | ai-system-variables (ES twin) | pending | |
| integrations/channels/http-fanout-telegram/README.md | descriptive | http-fanout-telegram manifest.yaml + run.sh; telegram-onboard.sh | pending | |
| integrations/channels/http-fanout-telegram/README.es.md | descriptive | http-fanout-telegram (ES twin) | pending | |
| integrations/channels/telegram-transform-reply/README.md | descriptive | telegram-transform-reply manifest.yaml + run.sh | pending | |
| integrations/channels/telegram-transform-reply/README.es.md | descriptive | telegram-transform-reply (ES twin) | pending | |
| integrations/http/hosted-services-api/README.md | descriptive | hosted-services-api manifest.yaml + src + run.sh | pending | |
| integrations/http/hosted-services-api/README.es.md | descriptive | hosted-services-api (ES twin) | pending | |
| integrations/http/http-connectors/README.md | descriptive | http-connectors manifest.yaml + src + run.sh | pending | |
| integrations/http/http-connectors/README.es.md | descriptive | http-connectors (ES twin) | pending | |
| integrations/mcp/mcp-connections/README.md | descriptive | mcp-connections manifest.yaml + env.example + run.sh | pending | |
| integrations/mcp/mcp-connections/README.es.md | descriptive | mcp-connections (ES twin) | pending | |
| integrations/mcp/mcp-repo-support-bot/README.md | descriptive | mcp-repo-support-bot manifest.yaml + src + run.sh | pending | |
| integrations/mcp/mcp-repo-support-bot/README.es.md | descriptive | mcp-repo-support-bot (ES twin) | pending | |
| demos/README.md | descriptive | demos/* catalogue | pending | |
| demos/crm-support-telegram/README.md | descriptive | crm-support-telegram manifest.yaml + src + bootstrap.sh + run.sh | pending | |
| demos/crm-support-telegram/GUION-DEMO.md | prescriptive | crm-support-telegram run.sh flow (demo script) | pending | |

## Section T07 — scripts: docs and header contracts (31 rows)

3 markdown + 28 shell headers. The SPEC names only `rebuild-redeploy.sh` and
`dev-mode.sh` at the root; T01 found 10 root scripts and lists all of them —
their headers are the only document those entry points have.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| scripts/e2e/README.md | prescriptive | scripts/e2e/*.sh vs the live dev cluster | pending | |
| scripts/reset/README.md | prescriptive | scripts/reset/*.sh; reset-dev.ts | pending | |
| scripts/reset/INVENTORY.md | descriptive | scripts/reset/*.sh data-wipe surface; reset-dev.ts | pending | |
| scripts/cbm-reindex.sh | script-header | codebase-memory-mcp index for this repo | pending | |
| scripts/checks/doc-code-guards.sh | script-header | the K6/K7/K8 doc claims it guards (cowork/DOC-VS-CODE-AUDIT.md) | pending | |
| scripts/claude-hook-lint-test.sh | script-header | Claude Code PostToolUse hook: lint + test the edited file | pending | |
| scripts/dev-poll-reload.sh | script-header | minikube 9p source-mount reload loop; dev-mode-minikube.sh | pending | |
| scripts/e2e/connector-invoke.sh | script-header | connector-runtime + connector-admin invoke API (sync/async) | pending | |
| scripts/e2e/http-workflow.sh | script-header | channel-service http channel → workflow-service trigger → jsFunction | pending | |
| scripts/e2e/long-agent-execution.sh | script-header | agent-ai-service long-running executions | pending | |
| scripts/e2e/manifest-apply.sh | script-header | provisioning-service manifest apply | pending | |
| scripts/e2e/run-all.sh | script-header | orchestrates scripts/e2e/*.sh | pending | |
| scripts/e2e/teardown-regression.sh | script-header | mid-run driver-death teardown path (workflow-service) | pending | |
| scripts/minikube/startup.sh | script-header | minikube dev startup orchestration | pending | |
| scripts/orbstack/startup.sh | script-header | OrbStack dev startup orchestration | pending | |
| scripts/reset/purge-circuit-breakers.sh | script-header | packages/shared `circuit-breaker.ts` distributed state | pending | |
| scripts/reset/purge-temporal.sh | script-header | postgres-temporal workflow state | pending | |
| scripts/reset/reset-all.sh | script-header | orchestrates scripts/reset/*.sh + reset-dev.ts | pending | |
| scripts/reset/reset-tenant.sh | script-header | tenant-service + provisioning-service tenant resources | pending | |
| scripts/smoke-test.sh | script-header | knative/deployment workload health in dev mode | pending | |
| scripts/validate-dev-mode.sh | script-header | dev-mode.sh round-trip against the live cluster | pending | |
| bootstrap-minikube-linux.sh | script-header | full minikube cluster bootstrap (Linux) | pending | |
| bootstrap-orbstack-osx.sh | script-header | full OrbStack cluster bootstrap (macOS) | pending | |
| dev-mode-minikube.sh | script-header | source-mounted dev mode (minikube variant) | pending | |
| dev-mode.sh | script-header | source-mounted dev mode (OrbStack); DOCS/guides/dev-mode.md | pending | |
| kustomize-safe-apply.sh | script-header | knative/ overlay apply path ($patch:delete workaround) | pending | |
| port-forward.sh | script-header | dev port-forwards incl. grafana/tempo for trace console | pending | |
| rebuild-all.sh | script-header | build+deploy of every services/* image | pending | |
| rebuild-changed.sh | script-header | git-diff → service mapping → rebuild+redeploy | pending | |
| rebuild-redeploy.sh | script-header | logical-service → image/deployment mapping | pending | |
| setup-tenant.sh | script-header | tenant-service tenant + auth-service admin user creation | pending | |

## Section T08 — root docs, cowork notes, skills (46 rows)

41 markdown + 5 skill assets that make code claims.

### Root docs (8)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| README.md | descriptive | repo entry point: services/*, scripts/*, DOCS/ | pending | |
| CLAUDE.md | prescriptive | meta — pointer to AGENTS.md (gitignored, untracked; see reconciliation) | pending | |
| AGENTS.md | prescriptive | meta (repo constitution) — flag-only, read-only per ground rule 5 | pending | |
| TAXONOMY.md | prescriptive | packages/shared bus subjects; fixtures/bus-events — read-only | pending | |
| SCHEMAS.md | prescriptive | packages/shared `envelope.utils.ts` + schemas — read-only | pending | |
| DRIFT.md | RECORD | packages/shared envelope (dated three-way cross-check) | pending | |
| backlog.md | future | meta (product/idea backlog, no code counterpart) | pending | |
| bootstrap-from-scratch.md | prescriptive | bootstrap-*.sh; integrations/demos run.sh chain | pending | |

### cowork notes (17)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| cowork/INDEX.md | RECORD | meta (cowork index) | pending | |
| cowork/ARCHITECTURE-ANALYSIS.md | RECORD | services/* topology (dated analysis) | pending | |
| cowork/ASYNC-RESILIENCE-AUDIT.md | RECORD | workflow-service + agent-ai-service long-running paths | pending | |
| cowork/CACHE-architecture.md | descriptive | cache-service; packages/shared cache clients | pending | |
| cowork/CHANGES-for-dev.md | RECORD | tracking-ingester-service traceability handoff | pending | |
| cowork/CHECKPOINT.md | RECORD | meta (session state) | pending | |
| cowork/codebase-memory-mcp-setup.md | prescriptive | scripts/cbm-reindex.sh; codebase-memory-mcp config | pending | |
| cowork/DEBUG-fanout-telegram.md | RECORD | integrations/channels/http-fanout-telegram (dated debug) | pending | |
| cowork/DESIGN-http-channel-instances.md | RECORD | channel-service HTTP channel instances (Option B shipped) | pending | |
| cowork/DESIGN-run-view.md | prescriptive (RECORD) | admin-console workflow run view; manual-loops/run-view.md | pending | |
| cowork/DOC-VS-CODE-AUDIT.md | RECORD | scripts/checks/doc-code-guards.sh (source of the K-guards) | pending | |
| cowork/LOOP-PLAYBOOK.md | prescriptive | meta (manual-loop discipline) | pending | |
| cowork/METERING-FOUNDATION.md | RECORD | usage-aggregator-service (audit + plan) | pending | |
| cowork/SDK-http-sdk.md | descriptive | sdk/src HTTP client + resources | pending | |
| cowork/SESSION-HANDOFF.md | RECORD | meta (session handoff) | pending | |
| cowork/TRACEABILITY-audit.md | RECORD | tracking-ingester-service + packages/shared correlation | pending | |
| cowork/staging/manual-loop.command.md | prescriptive | meta — staged copy of `.claude/commands/manual-loop.md` (rowed in section U) | pending | |

Class notes (T01) — the two `DESIGN-*` notes are not `future`:

- `DESIGN-run-view.md` is dated 2026-07-11 and declares itself the **BINDING**
  visual contract for the (completed) `manual-loops/run-view.md` loop →
  `prescriptive (RECORD)`: reviewers judged the implementation against it, and
  ground rule 3 keeps its dated claims intact. T08 checks only that it still
  matches the shipped run view, or proposes archiving it.
- `DESIGN-http-channel-instances.md` weighs "Option A vs Option B", but Option B
  shipped: `/api/webhooks/http/<tenant>/<instance>` exists in sdk
  `ingest-adapter.ts`, admin-console `channels.component.ts` and
  `sdk/examples/reference-pattern`, and `.sdd/changes/http-channel-instances/adr.md`
  records "the per-instance URL redeploy is complete" → **RECORD** (superseded
  decision note), not a pending design.

### skills (16 markdown)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| skills/_shared/skill-resolver.md | skill | meta (skill activation protocol) | pending | |
| skills/angular/architecture/SKILL.md | skill | services/admin-console app structure; packages/angular-shared | pending | |
| skills/angular/core/SKILL.md | skill | services/admin-console standalone components/signals | pending | |
| skills/angular/forms/SKILL.md | skill | services/admin-console forms | pending | |
| skills/angular/performance/SKILL.md | skill | services/admin-console performance patterns | pending | |
| skills/envelope-messages/SKILL.md | skill | packages/shared `envelope.utils.ts`; SCHEMAS.md; TAXONOMY.md | pending | |
| skills/envelope-messages/references/diseno-mensajes.md | skill | packages/shared envelope + DOCS/messaging/* as-built sources | pending | |
| skills/git-commit/SKILL.md | skill | meta (git workflow for this repo) | pending | |
| skills/git-commit/references/BRANCHING.md | skill | meta (branching strategy) | pending | |
| skills/git-commit/references/COMMIT-MESSAGE-FORMAT.md | skill | meta (commit conventions) | pending | |
| skills/git-commit/references/GIT-HOOKS.md | skill | repo git hooks; scripts/claude-hook-lint-test.sh | pending | |
| skills/judgment-day/SKILL.md | skill | meta (adversarial review discipline) | pending | |
| skills/multi-tenant/SKILL.md | skill | tenant-service; packages/database tenant scoping | pending | |
| skills/playwright/SKILL.md | skill | services/admin-console Playwright e2e setup | pending | |
| skills/skill-registry/SKILL.md | skill | meta (skills/ registry) | pending | |
| skills/yz-ui/SKILL.md | skill | services/admin-console UI; packages/angular-shared | pending | |

### skill assets that make code claims (5)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| skills/envelope-messages/assets/envelope-builder.ts | skill (asset) | packages/shared `envelope.utils.ts` | pending | |
| skills/envelope-messages/assets/envelope-schema.json | skill (asset) | packages/shared envelope schema; SCHEMAS.md | pending | |
| skills/envelope-messages/assets/subject-builder.ts | skill (asset) | packages/shared bus subject helpers; TAXONOMY.md | pending | |
| skills/yz-ui/assets/component-template.angular.ts | skill (asset) | services/admin-console component conventions | pending | |
| skills/yz-ui/assets/admin-console-snippets.css | skill (asset) | services/admin-console styles | pending | |

## Section R — RECORDS and meta (101 rows) — classified, NOT audited

Ground rule 2: these describe their date. No present-truth verdict; T09 may
propose archiving or deleting dead ones, nothing more.

### manual-loops (40)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| manual-loops/agent-mcp-tool-naming.md | RECORD | RECORD | pending | |
| manual-loops/connector-invoke-api.md | RECORD | RECORD | pending | |
| manual-loops/connector-trace-linking.md | RECORD | RECORD | pending | |
| manual-loops/declarative-provisioning.md | RECORD | RECORD | pending | |
| manual-loops/payload-capture.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-2.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-3.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-4.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-5.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-skills-section.md | RECORD | RECORD | pending | |
| manual-loops/run-view.md | RECORD | RECORD | pending | |
| manual-loops/samples-reorg.md | RECORD | RECORD | pending | |
| manual-loops/trace-console.md | RECORD | RECORD | pending | |
| manual-loops/workflow-step-events.md | RECORD | RECORD | pending | |
| manual-loops/workflow-toggle.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/README-migracion.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-ai.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-builder-v2.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-channels.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-connections.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-dashboard.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-foundation.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-polish.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-processes-builder.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-trace.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-users-analytics-settings.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/design/builder-v2-reference/NOTES.md | RECORD | RECORD | pending | |
| manual-loops/agents/long-running-agent-executions.md | RECORD | RECORD | pending | |
| manual-loops/architecture/dev-mode-validator-fix.md | RECORD | RECORD | pending | |
| manual-loops/architecture/docs-consistency.md | RECORD | RECORD | pending | |
| manual-loops/architecture/docs-truth-audit.md | RECORD | RECORD (this loop's SPEC) | pending | |
| manual-loops/architecture/phase0-rules-inventory.md | RECORD | RECORD | pending | |
| manual-loops/architecture/skills-cleanup.md | RECORD | RECORD | pending | |
| manual-loops/architecture/system-validation.md | RECORD | RECORD | pending | |
| manual-loops/connectors/connection-call-inspector.md | RECORD | RECORD | pending | |
| manual-loops/connectors/endpoint-scoped-recent-calls.md | RECORD | RECORD | pending | |
| manual-loops/demos/crm-support-telegram.md | RECORD | RECORD | pending | |
| manual-loops/messaging/envelope-drift.md | RECORD | RECORD | pending | |
| manual-loops/messaging/tenant-messaging-tiers.md | RECORD | RECORD | pending | |

### golden (2)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| golden/README.md | RECORD | RECORD (dated bus-event classification sample) | pending | |
| golden/REVIEW.md | RECORD | RECORD (dated post-fix correlation review) | pending | |

### manual-loop templates (3)

Not RECORDS and owned by no T02–T08 task; parked here as meta. T09 rules on
where they live.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| manual-loops-templates/README.md | prescriptive | meta (manual-loop template guide) | pending | |
| manual-loops-templates/spec-canonical-template.md | prescriptive | meta (canonical SPEC template) | pending | |
| manual-loops-templates/spec-simple-template.md | prescriptive | meta (simple SPEC template) | pending | |

### .sdd spec-driven-development change records (56)

Tracked but hidden from a bare `fd`. Same status as `manual-loops/*`: dated
per-change `adr`/`design`/`tasks`/`explore`/`archive`/`apply-progress` files.
RECORD class, never rewritten. T09 rules on whether this second record system
lives on beside `manual-loops/`.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/apply-progress.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/design.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/design.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/design.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/design.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/design.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/design.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/design.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/design.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/design.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/apply-progress.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/design.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/explore.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/explore.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/design.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/tasks.md | RECORD | RECORD | pending | |
| services/admin-console/.sdd/changes/landing-page-aggregation/design.md | RECORD | RECORD | pending | |
| services/admin-console/.sdd/changes/landing-page-aggregation/tasks.md | RECORD | RECORD | pending | |

## Section U — unassigned surfaces (14 rows)

Real docs describing real code or prescribing real process, named by no SPEC
task. T09 assigns an owner or folds them into the target tree; they must not
silently escape the audit.

### Visible (2)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| fixtures/bus-events/README.md | descriptive | fixtures/bus-events/*.json provenance; TAXONOMY.md | pending | |
| knative/services/overlays/_components/README.md | descriptive | knative/services/overlays/_components/* kustomize components | pending | |

### Agent-facing, tracked but hidden (12)

The loop's own executable prose. `.claude/commands/manual-loop.md` is the LIVE
command this SPEC runs under; `cowork/staging/manual-loop.command.md` (rowed in
T08) is a staged copy of it — T09 must rule on the duplicate.
`.agents/skills/adr-skill/` is a **second skills root** beside `skills/`,
prescribing ADR authoring conventions that `DOCS/adr/` is subject to.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| .claude/commands/manual-loop.md | prescriptive | meta — live `/manual-loop` command (this loop's own runner) | pending | |
| .claude/commands/build-console.md | prescriptive | meta — `/build-console` command | pending | |
| .claude/agents/implementer.md | prescriptive | meta — loop implementer role contract | pending | |
| .claude/agents/reviewer.md | prescriptive | meta — loop reviewer role contract | pending | |
| .agents/skills/adr-skill/SKILL.md | skill | meta — ADR authoring conventions; DOCS/adr/* is subject to them | pending | |
| .agents/skills/adr-skill/references/adr-conventions.md | skill | meta — ADR conventions reference | pending | |
| .agents/skills/adr-skill/references/examples.md | skill | meta — ADR examples | pending | |
| .agents/skills/adr-skill/references/review-checklist.md | skill | meta — ADR review checklist | pending | |
| .agents/skills/adr-skill/references/template-variants.md | skill | meta — ADR template variants | pending | |
| .agents/skills/adr-skill/assets/templates/adr-madr.md | skill (asset) | meta — MADR template | pending | |
| .agents/skills/adr-skill/assets/templates/adr-readme.md | skill (asset) | meta — adr/ index template | pending | |
| .agents/skills/adr-skill/assets/templates/adr-simple.md | skill (asset) | meta — minimal ADR template | pending | |

---

## Escalations

Raised by an audit task, never fixed by it. Ground rule 1: this loop does not
change runtime code, and prescriptive clauses the code has never honored are
adjudicated in T09, not "fixed" in either direction.

### From T02 (2026-08-02) — DOCS/messaging + DOCS/architecture

No genuine CODE bug was found. Four things need a human ruling, plus one
infra-config item.

**E1 — `envelope.md` §2.1 `type` format: a contract clause nothing honors.**
The envelope contract prescribes
`type = io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`. Only the
channel/webhook path obeys it (`buildWebhookIngressType`,
`createChannelEnvelope`). Every internal producer emits
`io.yoizen.platform.<area>.<kind>.v1` instead:
`EVENT_TYPES.AGENT_PUBLISHED` = `io.yoizen.platform.admin.agent.published.v1`
(`agent-admin-service/src/providers/nats.provider.ts`),
`io.yoizen.platform.runtime.execution_requested.v1`
(`packages/shared/src/execution-client.ts`),
`io.yoizen.platform.runtime.<kind>.v1`
(`agent-ai-service/src/nats-handlers/execution.handler.ts`),
`SCHEDULER_HEARTBEAT_TYPE` = `io.yoizen.platform.scheduler.heartbeat.v1`
(whose own comment admits it "predates the convention"),
`RUNTIME_TOKEN_EVENT_TYPE` = `io.yoizen.platform.runtime.token.v1`.
T09 must rule: narrow the clause to the channel domain, bless the
`io.yoizen.platform.…` family as a second legal shape, or open a code loop to
migrate the wire values (a breaking change — `SCHEDULER_HEARTBEAT_TYPE` is
already pinned by `heartbeat.service.spec.ts` precisely because changing it is
a wire change). Left unedited in the doc.

**E2 — `envelope.md` §2.1 + §11 `source` format: same shape of problem.**
"Format: `//channel-service/accounts/{id}` or `//api-gateway/webhooks`. Do not
invent new formats." Real values in the tree include
`//agent-admin-service/admin/agents/publish` (arguably conformant to an
unstated `//service/path` rule) and a bare `"agent-ai-service"` /
`ExecutionClient.serviceName` (not a URI at all). T09 rules on whether the
clause becomes `//<service>/<path>` or the offenders get a code fix. Left
unedited.

**E3 — producer/subject mismatch on the execution lifecycle (documented, not
fixed).** `agent-ai-service`'s `ExecutionHandler.publishStatus` publishes to
`evt.<tenant>.ai-agent-gateway.automation.platform.internal.<kind>.v1` — a
subject whose producer token names a DIFFERENT service than the envelope's own
`producer: "agent-ai-service"`. `runtime-streaming.md` §1.2 already calls this
"a pre-existing inconsistency in the `evt.` path". It is a live taxonomy
violation (the subject's producer token is supposed to be the publisher), but
changing either side is a wire change with consumers on it
(`ai-agent-gateway`'s `streamExecutionEvents`, `YoizenClawExecutionClient`,
`tracking-ingester`'s `classify.ts`, `consumed-by.ts`). T02 documented the
as-built truth in `ingress.md` §5 and escalates the fix.

**E4 — code comments cite doc LINE numbers, which this task just invalidated.**
Six source files pin `DOCS/messaging/envelope.md:77` and one pins
`:402` (`api-gateway/src/modules/channels/webhook-ingress-type.ts`,
`agent-memory-service/src/providers/agent-memory-event-type.ts`, plus their
specs). `:77` survived T02's edits by luck; `:402` (the §10.1 worked example)
is now stale because §3.1/§4.1 grew. Ground rule 4 says line cites rot — these
are the same smell pointing the other way, and no guard catches them. T02 could
not fix them (runtime source, out of scope; the closest owner is T07's
comment-fixing mandate). T09 should rule: convert to section anchors
(`envelope.md §2.1`) and add a `doc-code-guards.sh` check that fails on
`DOCS/**.md:NNN` inside `services/` and `packages/`.

**E5 (infra config, not a doc bug) — two Prometheus alerts watch durables that
no longer exist.** `infrastructure/base/observability/prometheus/alerts.yaml`
group `nats-consumer-lag` filters
`consumer_name=~"…|webhook-dispatcher|event-processor"`. Neither name appears
in any `DURABLE_NAME` in `services/**`. `observability.md` reports the alert
accurately, so the DOC is TRUE; the ALERT is dead weight and its two live
siblings hide it. Needs an infra ticket, not a doc edit.
