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
| DOCS/adr/agent-architecture-improvements.md | RECORD (ADR) | agent-ai-service context pipeline + skill routing | **TRUE** | Class holds — `status: proposed`, dated 2026-06-11, and **nothing shipped**, so no later code contradicts it. Verified absent: no `services/agent-ai-service/src/modules/context/` directory (the 20 module dirs are admin…tools, no `context`), no `USE_CONTEXT_PIPELINE` anywhere, no `ContextPipeline`/`*CollectorService`/`PromptComposerService`/`resolveByEmbedding`. Its problem statement is still literally true today: `SkillRouterService.resolveBySemantics` is the live token matcher, `MemoryContextBuilderService.formatForPrompt` still joins `- title: content`, both `createRagMiddleware` and `createKnowledgeBaseRagMiddleware` still swallow errors, and `LlmExecutorService` still has the manual `stopWhenToolLimit` beside `stepCountIs` (`stopWhen: [stepCountIs(maxSteps), stopWhenToolLimit]`). Its three `:NNN` pattern cites all still resolve exactly (`buildContext`, the `@Inject` constructor, `createKnowledgeBaseRagMiddleware`), and the dependency claims match `package.json` (`ai ^6.0.197`, `@ai-sdk/openai ^3.0.68`, `@nestjs/common ^11.0.0`). Body left verbatim per the RECORD rule. |
| DOCS/adr/connector-runtime-separation.md | RECORD (ADR) | connector-runtime; connector-admin | **FIXED** | Decision body untouched. Only the appended **Later observations** section (not part of the record) edited: (1) `worker.ts:35` → name-based `maxConcurrentActivityTaskExecutions: 400` in `services/connector-runtime/src/worker.ts` — ground rule 4; (2) added a second observation, because the record's "generic HTTP execution activities (`endpointCall`, `serviceCall`)" is now a set of three — `mcpCall` (`src/activities/mcp-call.activity.ts`) runs on the same `CONNECTOR_RUNTIME_TASK_QUEUE`. The KEDA observation re-verified TRUE (K6b in `doc-code-guards.sh` fails on any live `ScaledObject`; none exists). The decision itself is confirmed by the code: `connector-runtime.yaml` is a plain `apps/v1` Deployment separate from `connector-admin-api.yaml`'s Knative Service. |
| DOCS/adr/rag-system.md | RECORD (ADR) | agent-admin-service KB; agent-ai-service retrieval tools | **TRUE** | The only present-tense surface is the `**Status**` header, and every clause in it verifies. `createKnowledgeBaseRagMiddleware` (`rag-middleware.ts`) does pgvector cosine search over `document_chunks_embedding` via `KnowledgeBaseSearchService` and is imported + called by `llm-executor.service.ts`; the older `createRagMiddleware` is still in the same file. Async ingestion is inline in `agent-admin-service` (`ingestion-worker.service.ts`, `ingestion-watchdog.service.ts`, `job-tracking.service.ts`, `chunkers/`) with `pdf-parse ^2.4.5` in its `package.json`; `services/ingestion-service/` does not exist. `getInformation`/`addResource` really are absent — `rg 'getInformation|addResource' services` returns nothing and `src/modules/tools/builtin-tools/` holds exactly `communicate.tool.ts`, `load-skill.tool.ts`, `memory.tool.ts`. `document_chunks` + `document_chunks_embedding` exist in `schema-initializer.ts`. Design body is a dated record and stays. |
| DOCS/adr/temporal-and-nats.md | RECORD (ADR) | workflow-service Temporal; packages/database NATS providers | **TRUE** | Nothing to fix. Class holds (dated 2026-06-12, decision body preserved, appended section is pointers only and carries no `:NNN` cites). All four pointers resolve: `services/workflow-service/src/temporal/` exists (`activities/`, `worker.ts`, `temporal-worker-bootstrap.ts`, `workflow-interceptors.ts`), `connector-runtime` is the second Temporal worker, `packages/database` owns the durable-consumer machinery, and both cross-referenced READMEs plus `DOCS/messaging/service-bus.md` exist. The D2/D5 cross-reference matches `DOCS/architecture/decision-log.md`. |
| DOCS/adr/tenant-postgres-model.md | RECORD (ADR) | packages/database postgres engine; tenant-service | **FIXED** | Decision body untouched; the appended pointer section repaired. `platform-postgres.provider.ts:21` was **stale** — line 21 holds no tier text; the real declaration is `tier TEXT NOT NULL DEFAULT '${TenantDatabaseTier.Shared}'` with `CHECK (tier IN (Shared, Dedicated))` further down. Rewritten name-based, and `tenant-database-tier.ts:1-4` likewise. Added positive evidence that the two-tier decision is fully shipped, so the record is confirmed rather than merely pointed at: `PostgresProvider.provision` branches on `request.tier === TenantDatabaseTier.Shared` → `provisionShared` (`ensureSharedRole`/`ensureSharedDatabase`/`ensureSharedDatabaseGrants`/`createSharedSecret`/`createSharedExternalNameService`, bootstrapping from the `postgres-shared-superuser` CNPG secret), else the dedicated `createNamespacedStatefulSet` path. `TenantConnectionManager` + `SharedTenantDatabaseMode` both exist in `packages/database/src/tenant-connection-manager.ts`. |
| DOCS/adr/variable-system.md | RECORD (ADR) | agent-admin-service `system-variables`; workflow-service resolution | **TRUE** | Status header re-verified clause by clause and every one holds. `"variables"` is in `PROMPT_ALLOWED_NAMESPACES` (`template-renderer.service.ts`, alongside `agent`/`context`/`input`/`memory`/`skill`). `VariableResolutionContext` in `packages/shared/src/variable.interfaces.ts` declares exactly the five scopes `system`/`workflow`/`previous`/`node`/`request`, `workflow.interfaces.ts` carries it on both `WorkflowExecutionContext.variables` and the optional `AgentCallArgs.variables`, and `workflows.ts` builds all five at start and updates `variables.previous` + `variables.node[actions[i].name]` after each action. `variableBindings` really is absent (`rg` finds no match). The system-variables controller exposes exactly `@Get()`, `@Get(":id")`, `@Post()`, `@Patch(":id")`, `@Delete(":id")` — the claimed `PATCH :id` is there. Design body is a dated record and stays. |
| DOCS/agents/adapter-tools.md | descriptive | agent-ai-service adapter tools; packages/shared `adapter-*.ts` | **FIXED** | Four fixes. (1) **Auth table said "five authentication types"** — `injectAuthHeaders` has four `case`s (`api-key`/`bearer`/`basic`/`oauth2-client`); `none` is the absence of a case, so any unrecognized `authType` silently injects nothing. Restated, plus the `bearer` third alias `authConfig.bearer_token` the table missed, `btoa(user:pass)` for basic, and the no-clobber rule (`if (key && !(headerName in headers))` on every branch). (2) The env-var note correctly said `TOOL_RESPONSE_MAX_BYTES` is gone but implied no truncation survives — `truncateResponse(data, maxBytes = 100_000)` still clamps every result, just with no env override. (3) Error examples omitted `output: null`, which `ToolResult` always carries on the failure path; added, plus the earlier `"Missing tenant context"` short-circuit. (4) Security section never mentioned `validateUrl`, the SSRF guard that runs before the outbound `fetch` (rejects non-http(s), `localhost`/`127.0.0.1`/`::1`, `169.254.169.254`, and `169.254.`/`fe80:` link-local); added. Also named `GET /admin/adapters/:adapterId`, the second route on `AdaptersController`. Verified unchanged: `CONNECTOR_ADMIN_URL` default `http://connector-admin-api:3000` via `agentAiServiceConfig.connectorAdminUrl`; `X-Yoizen-Tenant` on both the resolve and the outbound call; timeout `endpoint.timeoutMs ?? adapter.timeoutMs ?? 5000` fed to `AbortSignal.timeout`; both error strings verbatim; `AdapterReference` = `{adapterId, endpointId}`; `ToolExecutorService` dispatches on `definition.adapterRef`; `validateAdapterRefs` called from `AgentsService` on create and update; all six file-reference paths exist. |
| DOCS/agents/execution.md | descriptive | agent-ai-service execution; ai-agent-gateway | **TRUE** | Nothing to fix — the densest all-numbers file in T03 and every value matches. The 9-subject consumer filter is byte-identical to `FILTER_SUBJECTS` in `multi-tenant-consumer.service.ts` (same order, same 8 `agent-admin-service` + 1 `ai-agent-gateway` entries), durable `agent-ai-service-consumer`. Redis key shape `${tenantId}:${RESULT_KEY_PREFIX}${executionId}` matches `buildStatusKey`/`buildPendingKey`. `execution_completed` top-level fields are exactly `response`/`usage`/`costUsd`/`toolCalls`/`toolResults`/`model`/`provider` and the failure path emits a top-level `error` (`ExecutionHandler`). Activity budget: `httpAgent` proxy = `startToCloseTimeout: "15m"` + `heartbeatTimeout: "30s"` + `maximumAttempts: 3`, no `taskQueue` so it inherits `workflow-orchestrator`; `AGENT_CALL_TIMEOUT_MS` defaults to `15 * 60 * 1000`; the activity's own `heartbeatMs = 15_000`. the four `AGENT_BREAKER_CONFIG` values the doc states all match — `failureThreshold: 10` / `windowMs: 120_000` / `cooldownMs: 60_000` / `successThreshold: 3` (the constant carries four further fields the doc does not mention and does not need to: `probeTimeoutMs: 300_000`, `l1CacheMs: 500`, `fallbackOnRedisError: "allow"` and `keyPrefix: "cb:workflow:agent"`); `REDIS_MAX_RETRIES_PER_REQUEST` = 3 with the `REDIS_UNAVAILABLE` and `CIRCUIT_OPEN` failure types. The core-NATS vs JetStream split is right: `execution-client.ts` uses `js.publish` to submit and `nc.subscribe` on `EXECUTION_RESULT_EVENT_SUBJECTS` to wait. |
| DOCS/agents/jobs.md | descriptive | agent-scheduler-service `scheduler` module | **FIXED** | One substantive fix plus a file-reference correction. **Seed-jobs table said `interval:3600` is "(1 h)"** — it is not: `parseSchedule` reads `interval:<digits>` as MINUTES (`intervalMs = minutes * 60_000`), so `interval:3600` is 3 600 min = 60 h. The doc contradicted its own Schedule Formats table two sections earlier. Replaced with an explicit do-not-copy warning covering all three fixture drifts: the `description` says "every hour" while the schedule means 60 h (bare `"3600"` would be the hourly form), the fixture uses `enabled` where `IJob` has `is_active`, and `payload.action` where `JobExecutorService` switches on `payload.action_type` — that payload lands in the `default` branch and publishes `execution_failed`. Also split the File Reference row that credited `job-trigger.service.ts` with publishing: it delegates to `publishJobTrigger` in `providers/nats.provider.ts` (`EVENT_TYPES` + `buildPlatformSubject(AGENT_ADMIN_JOB_TRIGGER, tenantId)`); added that row and the `leader-election.service.ts` row. Verified TRUE: all 4 `parseSchedule` classes incl. the `invalid` cases and the 2 147 483 647 ms ceiling; the 10 `/admin/jobs` routes with their exact status codes (201 create, 204 delete, 201 run/trigger); `IJob`'s 10 fields verbatim; the 5 `action_type` executors + `python_code` stub + default-error; scheduler admin routes `@Get("jobs"|"executions"|"tenants")` behind `AdminApiKeyGuard`; `scheduler:history:<tenantId>:<jobId>:<triggeredAt>` with `ttl = 7 * 24 * 60 * 60`; `RECONCILE_INTERVAL_MS` default `"30000"`; `pg_try_advisory_lock` + `LEADER_ELECTION_POSTGRES_URL` + the 10 s retry; envelope type `io.yoizen.agent-admin-service.job.triggered.v1`; all 5 admin-console component paths. |
| DOCS/agents/long-running-executions.md | descriptive | agent-ai-service long-running executions; workflow-service | **FIXED** | Every number verified TRUE; the fix is ground rule 4 — all **four** `:NNN` cites converted to name-based, and one of them was misleading. (1) `executions.controller.ts:29-37` → `@Post()` on `ExecutionsController` (`@Controller("runtime/executions")`) annotated `@HttpCode(HttpStatus.ACCEPTED)`. (2) `agent-call.activity.ts:88-99` → `executeAgentCall` driving `YoizenClawExecutionClient.executeAndWait` (`js.publish` to submit, `nc.subscribe` to wait) — the old span pointed at Redis-tunable code, not the no-HTTP-hop claim it was supporting. (3) the serial-path pair `multi-tenant-consumer-manager.ts:324-334 → nats-consumer-runner.ts:427-431` → the actual mechanism: the manager builds each `NatsConsumerRunner` from `config.runnerOptions`, agent-ai passes only `workingIntervalMs`, and the runner defaults `concurrency` to `1` and routes `1` to `runSerial` instead of `runConcurrent` (`concurrency` never appears in the manager at all, so the old cite implied a decision that file does not make). (4) `constants.ts:5` → `PROXY_TIMEOUT_MS`. Verified TRUE: 202 + `{executionId, status}`; `RESULT_TTL = 3600`; `consumerWorkingIntervalMs` 30 s against `consumerAckWaitMs` 900 s; 15 min/30 s/15 s Temporal triple; `AGENT_BUFFERED_EXECUTION_TIMEOUT_MS` 900 s; `PROXY_TIMEOUT_MS` 30 s; `scripts/e2e/long-agent-execution.sh` exists with `DELAY_MS="${E2E_LONG_DELAY_MS:-120000}"`; and the "13 budgets" claim about the service README is exact (rows 1–13). |
| DOCS/agents/memory.md | descriptive | agent-memory-service | **FIXED** | Four fixes. (1) **The proposal sequence diagram gated `memory.proposed` on TENANT scope** — false: `proposeMemory` calls `publishProposedAndPersist` on every successful create AND on every REPLACE-kind upsert, for all three scopes, whenever a publisher is wired. Only approve/reject are TENANT-specific, because only TENANT rows can be `PROPOSED`. (2) **Event names were wrong**: `EVENT_TYPES` (`agent-memory-service/src/providers/nats.provider.ts`) is `MEMORY_PROPOSED`/`MEMORY_PUBLISHED`/`MEMORY_REJECTED`/`MEMORY_EXPIRED` — the approve event is `memory_published`, not `memory.approved`; also documented that each type is projected from its subject by `buildEventTypeFromSubject`, that publishing is best-effort, that the returned envelope id is persisted to `metadata.proposedEventId` as the causation anchor, and the `skipApproval` override. (3) **"This block is prepended to the system prompt"** — it is APPENDED: `ContextBuilderService` sets `memoryContext` and `SessionChatService` does `parts.push("\n\n" + state.memoryContext)` after the instructions/skill/rules blocks. (4) The retrieval call is `GET {MEMORY_SERVICE_URL}/admin/memories?search=&limit=10&status=ACTIVE` — the ADMIN endpoint, not `/tools/*` — and failures degrade to an empty context; the tool-truncation note now describes all three steps (5 items, 500-char per-item clamp, drop-until-fits) instead of only the item cap. Also added the missing `memories_status_check` CONSTRAINT to the quoted DDL. Verified TRUE: the 3 scopes / 5 kinds / 4 statuses enums; `MERGE_STRATEGY_BY_KIND` (PREFERENCE/FACT/NOTICE = REPLACE, INCIDENT/PROMO = KEEP_BOTH); every route on all three controllers; `MAX_OUTPUT_CHARS = 16_384`; DTO limits 500/50 000; the PUBLISHED→ACTIVE / EXPIRED→ARCHIVED migration in `schema-initializer.ts` plus their survival in `memory.tool.ts`'s input schema; all 3 admin-console component paths. |
| DOCS/channels/channel-service.md | descriptive | channel-service | **FIXED** | Densest drift of the T03 set. (1) **The `http` channel was missing everywhere** — `Channel` is `"whatsapp" | "instagram" | "telegram" | "http"` and `ChannelProvider` is `"meta" | "telegram" | "http"`; added to the discriminator sentence, the Implemented-channels table (with the fact that `HttpProvider.sendMessage` always returns `{success:false, error:"outbound not supported for http channel"}` — inbound-only), the provider tree (`http/`, plus the omitted `telegram.module.ts`), and the account-lookup table (`x-http-channel-token`). (2) **Stage-2 example claimed `payload` is the "raw Meta body, untouched"** — it is the NORMALIZED `InboundMessage`: `createChannelEnvelope` puts `messageId`/`from`/`timestamp`/`type` + optional `text`/`media`/`conversationId` + `accountId` in `data.payload` and deliberately EXCLUDES the provider's `raw` (which feeds only `computeIdempotencyKey`). Both envelope examples were also missing `resource`/`time`/`traceid`/`causation_id`/`correlation_id`/`idempotencykey`/`transport` and the `data.received_at`/`payload_ref`/`payload_bytes`/`payload_checksum` block; both regenerated from `webhook-ingress-publisher.service.ts` and `envelope.factory.ts`, with the real causal values (`causation_id` = stage-1 id, `depth` = incoming + 1, from `webhook-ingress-consumer.service.ts`) and the truncated `source` corrected to the full `//channel-service/accounts/<accountId>`. (3) **Circuit breaker documented as "per account"** — the key is `computeBreakerKey({tenantId, kind:"egress", target:"<channel>:<provider>"})`, i.e. per tenant + channel/provider; and "messages go to the DLQ" only holds on the `send-command` consumer path, where the `PermanentError("egress.circuit_breaker")` is TERMed to `DLQ-<tenant>` — the direct HTTP path just returns the error. (4) **Shadow publish called "fire-and-forget — does not block the response"** — `EgressService.send()` `await`s `shadowPublish()` before returning; it is best-effort, not off-path: the whole body is wrapped in a try/catch that logs `egress.shadow_publish_failed` at warn and swallows, and it only runs when `result.success`. Both the egress sequence diagram and the four-phase diagram were re-ordered/re-labelled to match, so the file no longer contradicts itself. (5) `buildWebhookIngressSubject` credited to `channel.constants.ts` — it lives in `channel.utils.ts`; relevant-files table corrected and extended with `webhook-ingress-type.ts` and `envelope.factory.ts`. (6) The ingress-diagram note said the account is resolved "by phone_number_id + tenantId" — that is the tie-break only; rewritten to signature-verification-first. (7) Auto-reply routes: exactly `POST`/`GET`/`DELETE :id`, no update; the gateway proxies all three. (8) "Adding a new channel" checklist rewritten (registration goes to `ProviderRegistry` for Meta, `ChannelRouter` otherwise) and cross-linked. Verified TRUE: the 8-token subject format and all three examples; `WEBHOOK_FORWARDED_HEADERS` 7 items and `WEBHOOK_SECRET_HEADERS` 4 items verbatim; the publish-before-200 + 503/`Retry-After` behaviour (`WebhookPublishUnavailableError`, `publishInflightCap`, `publishWithTimeout`); durable `auto-reply` with filter `evt.*.channel-service.messaging.*.*.received.v1` and `setInterval(..., 30_000)`; `AutoReplyRule`'s 7 fields; the auto-reply module file list; `CLAIM_CHECK_THRESHOLD_BYTES = 256 * 1024`. |
| DOCS/channels/instagram.md | descriptive | channel-service Instagram provider | **FIXED** | Part 1 is Meta-API reference (not ours) and is left alone; Part 2 corrected. (1) **"Parse differences vs WhatsApp" attributed account-id extraction to `parseWebhook`** — neither provider's `parseWebhook` extracts an account identifier or reads status updates. Rewritten to name the real site: `WebhookIngressService.resolveAccount` → `extractMetaPhoneNumberId` (`entry[0].changes[0].value.metadata.phone_number_id`) / `extractInstagramBusinessIdHint` (`entry[].messaging[].recipient.id`), and only as a tie-break when more than one account verifies the signature. (2) Same table claimed WhatsApp parses `changes[].value.statuses[]` — `WhatsAppProvider.parseWebhook` reads only `value.messages`; `rg 'statuses' services/channel-service/src packages/shared/src` returns nothing. (3) `account.igUserId` "is … the `id` of `entry[]`" contradicted the Account-lookup section three paragraphs above; corrected to say the value is the same but only `recipient.id` is ever read. (4) Implementation-files table credited `channel-router.ts` as "provider registry by channel" — `ProviderRegistry` (`providers/meta/provider-registry.ts`) holds the Meta map and `ChannelRouter` aggregates it with the Telegram/HTTP providers; both rows added plus `webhook-ingress.service.ts`. (5) The `ChannelAccount` sample implied a complete object; annotated with the required fields it omits (`id`, `tenantId`, `name`, `externalId`, `isActive`, `createdAt`, `updatedAt`) and `externalId` added, since it is the instance-addressing key. Verified TRUE: `GRAPH_API_BASE = "https://graph.instagram.com/v21.0"` and the `/{account.igUserId}/messages` path; `isEchoMessage` on `message.is_echo === true`; the `verifySignature(rawBody: Uint8Array, …)` snippet is byte-accurate against `MetaChannelProviderBase`; `signatureHeader = "x-hub-signature-256"`; `timingSafeEqual`; both send-payload shapes; the emitted subject `evt.<tenant>.channel-service.messaging.instagram.meta.received.v1` matches `buildChannelSubject`. |
| DOCS/channels/meta-provider-pattern.md | descriptive | channel-service Meta providers (WhatsApp/Instagram) | **FIXED** | (1) **The `verifyWebhookSignature` snippet dropped a security-relevant guard** — the real function returns `false` when `signature.length !== expected.length` BEFORE calling `timingSafeEqual` (which throws on length mismatch). Snippet corrected verbatim and the `MetaChannelProviderBase` delegation spelled out. (2) **`parseWebhook` "Account ID" row** — same drift as `instagram.md`: neither parser extracts one; moved to a blockquote naming `WebhookIngressService.resolveAccount` + the two hint extractors, and the fact that an unresolved ambiguity is rejected as `signature_mismatch` rather than guessed. (3) **"Status updates | `changes[].value.statuses[]`"** — not parsed at all; corrected in both the Adapted and the New tables. (4) **"Image body | Requires `media_id` upload first" for WhatsApp is false** — `buildSendPayload` sends `{type:"image", image:{link: mediaUrl, caption?}}`, a public URL, exactly like Instagram; there is no upload step in the codebase. Added the `template`/`document` types the table omitted and Instagram's text-only fallback. (5) Added the biggest shared component the "Identical" section omitted: `sendMetaMessage` (Bearer auth, `Content-Type: application/json`, 10 s `AbortSignal.timeout`, uniform `SendMessageResult` shaping, per-channel `parseSuccessBody`). (6) `meta-token.ts` sharpened to `exchangeForLongLivedToken` on `graph.facebook.com/v22.0` — one version ahead of the send endpoints' `v21.0` — gated by `account.provider === "meta"` in `AccountsService` and explicitly admin-triggered, not a background timer. (7) `IngressService.processInbound` signature made concrete (`IProcessInboundOptions`) to support the channel-agnostic claim. (8) The new-channel checklist rewritten: registration is `ProviderRegistry` for Meta and the `ChannelRouter` constructor otherwise, `Channel`/`ChannelProvider` unions quoted, and the account-hint step added. |
| DOCS/channels/telegram-sequence.md | descriptive | channel-service Telegram provider; workflow-service trigger | **TRUE** | Nothing to fix. Both webhook routes exist (`@Post(":channel/:tenantId")` and `@Post(":channel/:tenantId/:instance")` on `@Controller("webhooks")` under the gateway's `api` prefix) and the doc already writes them with `/api`. All three durables are exact: `channel-webhook-ingress`, `workflow-triggers`, `agent-ai-service-consumer`. The four subjects match their builders (`buildWebhookIngressSubject`/`WEBHOOK_INGRESS_RECEIVED_KIND`, `buildChannelSubject`, `AI_AGENT_GATEWAY_*`). Path-B claims verified: the `httpAgent` proxy has no `taskQueue` so `agentCall` runs on `WORKFLOW_ORCHESTRATOR_TASK_QUEUE` = `"workflow-orchestrator"`, `startToCloseTimeout: "15m"`, `heartbeatTimeout: "30s"`; `YoizenClawExecutionClient` submits with `js.publish` and subscribes with `nc.subscribe` — no HTTP hop to `ai-agent-gateway`, and the `ai-agent-gateway` producer token in the subject is the pre-existing inconsistency already escalated as E3. Stage-1 200-after-publish and the claim-check note match `webhook-ingress-publisher.service.ts` and `MultiTenantConsumerManager.wrapHandler`. |
| DOCS/guides/dev-mode.md | prescriptive | dev-mode.sh; scripts/validate-dev-mode.sh; scripts/dev-poll-reload.sh | **TRUE** | Cheap re-check per the task's RECENTLY-VERIFIED list (updated 2026-07-30 for the validate-dev-mode barrier); nothing has moved. All six referenced scripts exist (`./rebuild-changed.sh`, `./bootstrap-orbstack-osx.sh`, `./dev-mode.sh`, `./rebuild-redeploy.sh`, `scripts/validate-dev-mode.sh`, `scripts/dev-poll-reload.sh`). The five Knative feature flags are patched by `bootstrap-orbstack-osx.sh` exactly as listed (`kubernetes.podspec-volumes-hostpath`, `-persistent-volume-claim`, `-persistent-volume-write`, `-securitycontext`, `-init-containers`). `validate-dev-mode.sh`'s header lists 7 numbered stages with the stage-4b readiness barrier, targets `workflow-service` as the hardcoded guinea pig, and the `BARRIER_*` knobs really do live at the top of the file (`BARRIER_TIMEOUT`, `BARRIER_CONSECUTIVE`, `BARRIER_INTERVAL`, `BARRIER_RELOAD_GRACE`, plus the API/tenant/credential set). `DEV_ANNOTATION="yoizen.io/dev-mode"` in `dev-mode.sh` is the annotation `rebuild-changed.sh` skips on. |
| DOCS/guides/doc-code-validation-tests.md | prescriptive | scripts/checks/doc-code-guards.sh; per-service doc-claim tests | **FIXED** | The plan half is a test proposal (nothing to verify against code); the "Implemented" half is descriptive and two rows had gone stale. (1) The SKB row said "File upload/list/delete/schema endpoints are pending until agent-admin implements matching routes" — upload shipped (`SKBContainersController.uploadFile`); rewritten so the assertion is now "upload works end to end; list/delete/schema must 404". (2) The K7 calibration finding said "9 registrations" omit `ackWaitMs`; the allowlist in `doc-code-guards.sh` now carries **11** — the nine plus tracking-ingester's `main.ts` and its `consume-events.ts` doc-comment mention. Verified TRUE against the script itself: K6a–K6g, K7, K8, K9, K9b, K10, K11 descriptions all match their implementations, including K10's exact corpus (`README.md`, `DOCS/**`, `services/*/README.md`, `packages/*/README.md`, fenced blocks and inline spans skipped, file part only for anchors, `manual-loops/`/`cowork/` excluded) and K11's "covers 10 services today" (the discovery `rg` returns exactly 10 service dirs). The `trigger-consumer` footnote is right too — it sets `ackWaitMs: 60_000` explicitly and is absent from the allowlist. Referenced paths spot-checked: `services.conf`, `NAV_SECTIONS` in `nav.config.ts`, `features/processes/trace/`, `PORT` default 3000 in the scheduler config. |
| DOCS/guides/onboarding.md | prescriptive | bootstrap-*.sh; scripts/{orbstack,minikube}/startup.sh | **FIXED** | Six fixes. (1) **"high concurrency (200 parallel)"** — `worker.ts` sets `maxConcurrentActivityTaskExecutions: 400`; corrected in the 30-second overview and again in the Scaling section, where the KEDA sentence ("KEDA can scale 1-20") was replaced since no ScaledObject exists (K6b enforces). (2) **"supports 8 action types … To add a 9th"** — the union has 9 (`mcpCall` missing); corrected to 9/10th, and the union snippet's "(6 existing types)" fixed to 8. (3) The multi-tenancy `curl` used `http://localhost:3000/workflows`, which is neither the gateway host nor prefixed; changed to `http://api-gateway.platform-services-dev.dev.local/api/workflows` with a note distinguishing gateway calls from the run-it-locally tasks below (whose unprefixed `localhost:3000` calls ARE correct — the services' own routes carry no `api` prefix). (4) The connector-runtime tree omitted `mcp-call.activity.ts` and `validate-outbound-url.ts` and implied completeness; annotated as abridged with a pointer to the README's "Three entrypoints, one deployable". (5) **"Manual Testing via REST" was false three ways** (caught in review): it labelled `POST /workflows` "Start workflow", read the id out of `.workflowId`, and polled `GET /workflows/:id` for the result. `POST /workflows` only persists the definition (201, `ICreateWorkflowResult` → `.id`); a run is `POST /workflows/:id/execute` (202, `IExecuteWorkflowResult` → `.executionId`/`definitionId`/`temporalWorkflowId`/`runId`); the result is `GET /workflows/:id/executions/:executionId` (`IExecutionStatusResult` → `{executionId, definitionId, temporalWorkflowId, status, result?, failure?, createdAt}`), while `GET /workflows/:id` returns the DEFINITION. No response in this service carries a `workflowId` field at all, so the `jq -r '.workflowId'` yielded null and every later step used an empty id. Rewritten as a working create→execute→poll recipe with the real interface names, plus a pointer to the paginated `GET /workflows/:id/executions`. **Second review round caught a further defect in that recipe AND in the pre-existing Task-2 example: `JsFunctionArgs.code` is an EXPRESSION that must evaluate to a function**, because `executeJsFunction` runs `new Function("return " + args.code)()` and then `await fn(context)`. Both sites carried a bare statement body (`"return { greeting: … }"`, `"return { message: 'Hello World' }"`), which constructs as `return return { … }` — a `SyntaxError: Unexpected token 'return'` thrown at `new Function` time, i.e. before the handler runs, failing the activity through all 3 attempts and ending the run FAILED, directly contradicting the same block's "RUNNING then COMPLETED". Both converted to the expression form already used by `DOCS/README.md`'s verified walkthrough and by the shipped `integrations/channels/telegram-transform-reply/manifest.yaml` (`code: | (context) => { … }`), and the contract is now stated inline at the first example so a new developer meets it before the first copy-paste. The adjacent Integration-Tests block was corrected in the same pass: `test:integration` is declared in `package.json` but `services/workflow-service/test/` contains only `unit/` and `make-mongo-mock.ts` — there is no `integration/` directory. (6) **Redis cache keys were wrong** — the prefix is `adapter:config:` (`ADAPTER_KEY_PREFIX`), so the key is `adapter:config:<tenantId>:<adapterId>`, not `adapter:acme:crm-connector`; the sibling prefixes `adapter:oauth:` and `adapter:internal-by-service:` named too. Verified TRUE: `start:dev`/`start:worker:dev` scripts exist in both services' `package.json`; all seven `packages/shared/src/*` files listed exist; the tenant DB host pattern `postgres.{tenantId}-{env}-ns.svc.cluster.local` matches `tenantKubernetesNamespaceName`; both task-queue constants; the three ADR links resolve. |
| DOCS/guides/trace-console.md | descriptive | admin-console trace feature; tracking-ingester-service | **FIXED** | One fix. The **Known limitation** said the bus event "published by `execution-completed-publisher.activity.ts` does not carry Temporal's real workflow/run identifiers" — half stale: `publishExecutionStartedEvent`, which now lives in that same file, DOES take `workflowId` (`<tenant>:<name>:<idempotencyKey|nanoid>`) and `runId` and puts them on the envelope; it is `publishExecutionCompletedEvent` whose payload is still only `{executionId, status, workflowName?}`. Rewritten to say which event carries what, so the reader knows the link resolves or not depending on the source row. Everything else verified TRUE: `./port-forward.sh` forwards `grafana`/`tempo`/`temporal-ui` (`SUPPORT_SERVICES=(nats temporal-ui grafana tempo)`) with defaults 3000/3200/8233; Grafana dashboard uids `message-traces` and `connector-detail` exist in `dashboards-message-tracking-configmap.yaml`; console routes `processes/trace`, `processes/trace/:correlationId` and `processes/runs/:workflowId/:runId` all exist in `app.routes.ts`; the ingester really serves `GET /chains/:correlationId`, `/chains/:correlationId/events/:eventId/payload` and `/runs/:workflowId/:runId` (`match-payload-route.ts`, `match-run-route.ts`, `handle-run-request.ts`); the gateway proxies them under `@Controller("tracking")` with `@RequirePermission("tracking:payload:read")`, the same constant the console gates on in `trace-detail.component.ts` and `run-view-popup.component.ts`; the payload status→HTTP mapping (404 unknown/`none`/`unresolved`, 410 `scrubbed`, 200 otherwise) matches `handle-payload-request.ts`; all five `.sdd`/`manual-loops` references resolve. |
| DOCS/guides/ui-flows.md | descriptive | admin-console features/* | **FIXED** | Three fixes. (1) Every gateway path was written unprefixed; added the reconciliation at the top — the console's `environment.apiUrl` is `"/api"` in BOTH `environment.ts` and `environment.prod.ts`, matching `app.setGlobalPrefix("api")`, so the paths below are `/api/<path>` on the wire. (2) **"polling … every ~1s, max wait ~5m"** was approximate hand-waving over real constants; replaced with the actual loop: `PlaygroundComponent.waitForExecution()` uses `Date.now() + 300_000` as the deadline and a fixed `setTimeout(resolve, 1000)`, returns on `completed`/`failed`, and throws ``Execution '<id>' timed out`` otherwise — no backoff, no SSE. (3) **The stream endpoint is `POST`, not a GET SSE URL** — `@Post("stream")` on `RuntimeController`; and its consumer today is the SDK's `runtime.stream()`, not the console, so "for future UI use" was narrowed. Verified TRUE: all five reference paths exist; `AgentRuntimeService.baseUrl` is `${environment.apiUrl}/runtime/executions` with `createExecution`/`getExecution`; the channel-account CRUD really is `POST/GET/GET :id/PATCH :id/POST :id/refresh-token/DELETE :id` under `@Controller("channels")`; `SOURCE_ACCOUNT_TEMPLATE = "{{request.envelope.accountId}}"` in `workflow-node-defaults.ts`; the trace warning is `code: "INVALID_VALUE"` on `field: "args.accountId"` in `workflow.validator.ts`, non-blocking, with the same two-readings rationale the doc gives; `/processes/trace` sits under the shell `authGuard` with a component-level `diagnostics:read` gate; the audit endpoints `@Controller("audit/channel-events")` and `@Controller("audit/events")` exist. |
| DOCS/reference/ai-sdk.md | descriptive | agent-ai-service Vercel AI SDK usage | **FIXED** | This is an upstream-SDK reference, so only its two repo-facing surfaces are auditable. (1) The version header listed 2 of the 4 provider packages; `services/agent-ai-service/package.json` also carries `@ai-sdk/google ^3.0.80` and `@ai-sdk/mcp ^1.0.46`, and `provider-registry.service.ts` imports `createGoogleGenerativeAI` — added, and a scope banner added so nobody reads the other 1 300 lines as as-built platform documentation. (2) §12's "Recommended module structure" is generic advice that happens to look like our tree; annotated that `agent-ai-service` nests one level deeper (`src/modules/llm/…`) and keeps middleware as `src/modules/llm/rag-middleware.ts`, not a `middleware/` dir. Verified TRUE: `ai ^6.0.197`, `@ai-sdk/openai ^3.0.68`, `@ai-sdk/anthropic ^3.0.81`; and every status cell in §13's migration table — `generateObject` is still used behind `as any` in `skb-schema-analyzer.service.ts` and `skb-query.service.ts` and imported in `llm-executor.service.ts` alongside `streamObject`/`streamStructuredOutput`; `stopWhen` + `stepCountIs` are used correctly; the three provider factories `createOpenAI`/`createAnthropic`/`createGoogleGenerativeAI` are all in `provider-registry.service.ts` and no gateway-string model id appears. |
| DOCS/runbooks/storage-engines.md | prescriptive | packages/database postgres/mongo engines | **FIXED** | **Executability: one command block was wrong and would mislead an operator mid-incident.** The Port-forward section claimed `STORAGE_ENGINE=postgres ./port-forward.sh dev` forwards "5432 shared postgres" and that "Temporal Postgres ports are forwarded in **both** modes" — `port-forward.sh` forwards NOTHING on Postgres in either mode. Its targets are `SERVICES=(api-gateway admin-console)` and `SUPPORT_SERVICES=(nats temporal-ui grafana tempo)`, and the only conditional additions are `mongo-platform`/`mongo-usage` under `STORAGE_ENGINE=mongo`; the string `5432` does not appear in the script. Replaced with the real target set and two working manual `kubectl port-forward` lines (`svc/postgres`, `svc/postgres-temporal-rw`). Also noted the positional env arg defaults to `dev`. Second fix: the `--reset` sentence now says the flag's absence was checked (`rg reset` matches only an unrelated comment). Everything else is executable as written and verified: `--storage-engine=mongo` and the optional `[GROUP]` positional both exist in `bootstrap-orbstack-osx.sh`'s usage and parser; `STORAGE_ENGINE`/`DB_ENGINE` semantics; `resolveStorageEngine()` from `@yoizen/database`; all four overlay paths exist; `tests/` and `experiments/` really are gone; `setup-tenant.sh` exists; the shared-vs-dedicated tier rows match `postgres.provider.ts`; the scheduler-leader and pgvector "Postgres-only" rows match `LeaderElectionService` (`pg_try_advisory_lock`) and the pgvector KB path. |
| DOCS/runbooks/temporal.md | prescriptive | workflow-service Temporal; knative temporal overlays | **FIXED** | **Executability: passes.** Every command in this runbook can be run as written — resource names, script flags, env vars, image tags and alert names all verified. Two pointer defects fixed instead. (1) §3.2 and §8.3 both pointed at `runbooks/temporal-visibility-split.md`, which does not exist at that path — the file is `runbooks/archive/temporal-visibility-split.md`; converted to working relative links. (2) §8.3 told the reader to use the workaround script `ensure-temporal-visibility-schema.sh`, which **was deleted from the repo** (the archive README says so explicitly and `fd` finds no such file); annotated so an operator following the escape hatch is not sent after a missing script. Verified executable/TRUE: `scripts/reset/purge-temporal.sh` exists and really accepts `--namespace=`, `--skip-restart`, `--yes` and the `counts` subcommand; `infrastructure/overlays/local/dev` exists for the `kubectl apply -k`; container name is `temporal` (so `exec deploy/temporal -c temporal` resolves); `job/temporal-namespace-bootstrap-1-28-4` is the exact Job name with `ttlSecondsAfterFinished: 600`; `cm/temporal-dynamic-config` is the exact ConfigMap name and its keys are exactly `frontend.workerHeartbeatsEnabled` + `frontend.listWorkersEnabled`; `svc/temporal-metrics` is the headless Service; `deploy/temporal-ui` + `svc/temporal-ui` exist under `infrastructure/base/temporal-ui/` with `app.kubernetes.io/name=temporal-ui` as the doc warns; images are `temporalio/auto-setup:1.28.4` and `temporalio/admin-tools:1.28.4-tctl-1.18.4-cli-1.6.2` verbatim; all 12 §4.1 env rows match `deployment-autosetup.yaml` including `NUM_HISTORY_SHARDS: "16"`; CNPG `instances: 2` in base vs `1` in the dev patch; and all 13 alert names in §9 match `alerts.yaml` exactly, with `TemporalHistoryShardImbalance` correctly reported as removed (K6e enforces both directions). |
| DOCS/runbooks/archive/README.md | RECORD | meta (archive index) | **FIXED** | Class holds (index of records; K6f enforces the banners on both files it indexes). Its Contents table's "Current state" column is present-tense and one cell was false: it said "The manifests under `infrastructure/base/temporal/` remain in the repo but the split topology is not applied." The split-role manifests were **deleted**, not merely unapplied — `infrastructure/base/temporal/` contains only `deployment-autosetup.yaml`, `job-namespace-bootstrap.yaml`, `configmap-dynamic-config.yaml`, `service-frontend.yaml`, `service-metrics.yaml`, `kustomization.yaml`, and `rg 'temporal-frontend|temporal-history|temporal-matching'` finds no manifest anywhere under `infrastructure/` or `knative/`. Corrected with the file list. The sibling cell was already right (`infrastructure/scripts/ensure-temporal-visibility-schema.sh` deleted, `postgres-temporal-visibility-cluster.yaml` still present but inactive — both re-verified). The dated 2026-05-22 narrative and the "Rules for this directory" section are historical and untouched. |
| DOCS/runbooks/archive/temporal-ha-migration.md | RECORD | knative temporal overlays (historical migration) | **TRUE** | Not audited for present-truth (ground rule 2) — RECORD class confirmed and correctly signposted. `Status: Historical` banner is in the first 10 lines (K6f green), it states the date (2026-05-22), that the 4-role topology is no longer active, and points day-2 readers at `DOCS/runbooks/temporal.md`. Its two relative links resolve (`./temporal-visibility-split.md` is a same-directory sibling; K10 green). The `post-mortem/POST-MORTEM.md` reference is already annotated "file deleted from repo", so the one dead pointer is self-declared. Body left verbatim per the archive's own rule that these are records, not procedures — its `ensure-temporal-visibility-schema.sh` steps describe what was run in May and stay as written; the LIVE runbook that pointed at that script was the one fixed (see `temporal.md`). |
| DOCS/runbooks/archive/temporal-visibility-split.md | RECORD | postgres-temporal overlays (historical migration) | **TRUE** | Not audited for present-truth (ground rule 2) — RECORD class confirmed. `**Status:** Historical` in the first 10 lines (K6f green), dated 2026-05-22, and its banner already reconciles itself with today: it says developer mode reverted to one `postgres-temporal` cluster holding both `temporal` and `temporal_visibility`, and that the `postgres-temporal-visibility` CNPG manifest still exists but is inactive — both re-verified (`infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml` present; `POSTGRES_SEEDS` and `VISIBILITY_POSTGRES_SEEDS` both `postgres-temporal-rw` in `deployment-autosetup.yaml`). Cross-reference to `DOCS/runbooks/temporal.md` §3.2 is accurate. Body untouched. |
| DOCS/skb/api.md | descriptive | agent-admin-service `structured-kb` controllers; api-gateway admin routes | **FIXED** | Five fixes; the file documented three routes that do not exist and one that does but was declared broken. (1) **Base URL dropped the gateway prefix** — `app.setGlobalPrefix("api")` plus `enableVersioning({type: URI, defaultVersion: ["1", VERSION_NEUTRAL]})` means `/api/admin/structured-kb` and `/api/v1/admin/structured-kb` both resolve; the doc advertised the bare path. (2) **The Files banner was stale in the dangerous direction**: upload is live end to end — `SKBContainersController.uploadFile` (`@Post(":id/files")`, `@HttpCode(ACCEPTED)`) validates the extension and base64, creates the `skb_files` row and calls `publishSkbFileIngestion`. Rewritten, and the whole live surface enumerated: exactly 7 routes. (3) **List-files, delete-file and get-file-schema have NO route at all** — not on `SKBContainersController`, not on `StructuredKBController`, and no gateway proxy (`AdminStructuredKBController` declares only `POST/GET containers`, `GET/PATCH/DELETE containers/:id`, `POST containers/:id/query`, `POST containers/:id/files`). Their sections now say DOES NOT EXIST / 404 instead of "not implemented", which read like a temporary gap. (4) **Create-container body was wrong**: `CreateSKBDto` declares only `name` + `description`, and the shared ValidationPipe runs `whitelist: true, forbidNonWhitelisted: true`, so sending `version`/`ingest_model`/`query_model`/`provider_config` is a 400, not a no-op; those four are DDL defaults only. Same class of error on upload: `UploadSKBFileDto` has no `file_id` (the controller generates it with `randomUUID()`) and the response is `{fileId, status}`, not the 4-field object shown. (5) **Query `limit` default is 10, not 100** — `StructuredKBController` applies `body.limit ?? 10`; `SKBQueryService`'s `options?.limit ?? 100` is dead on the HTTP path. Also replaced the "not wired end-to-end" ingestion note (the publish side exists) and the rate-limit row that blamed a missing route. Verified TRUE: `SKBRateLimitGuard` = `MAX_REQUESTS 30` / `WINDOW_MS 60_000` with the exact 429 message and no rate-limit headers; `ackWaitMs: 300_000`; `BATCH_SIZE = 5000`; `MAX_COLUMNS = 100` / `MAX_ROWS = 500_000`; the three literal 400 messages on the query path; `QueryResult` = `{results, sql, totalCount}`; the watchdog's 10-minute threshold; the first-5-rows sampling with `getSampleRows()` unused. |
| DOCS/skb/architecture.md | descriptive | agent-admin-service `structured-kb` modules | **FIXED** | Five fixes, all in the as-built sections (§3, §4.2, §8, §10); the design body stays. (1) **§3.2 said the gateway `POST .../files` target is "pending/broken"** — it is implemented; rewritten with the real chain and the 202 response. (2) **§11's Endpoint Summary listed `GET .../files`, `DELETE .../files/:fileId` and `GET .../files/:fileId/schema` as "api-gateway proxy | Pending"** — the gateway has no such routes; the rows were removed and replaced with the true 7-route surface plus an explicit "not implemented anywhere" note. (3) **§3.4's `IngestSKBFileDto` does not exist** — the class is `UploadSKBFileDto` (`dto/upload-skb-file.dto.ts`) and it has no `file_id`; replaced, and `QuerySKBDto` annotated with its real `@Min/@Max` decorators and the controller's default of 10. (4) **§4.2 said "The event publisher is not present in the current tree" and that content is fetched from `fileUrl` rather than carried inline** — both false: `publishSkbFileIngestion` exists in `providers/nats.provider.ts` and sets `fileUrl: payload.fileBase64`, i.e. the base64 rides INLINE under a misleading field name. Documented as a caveat, with the real `correlationId`/`source`, and the payload shape corrected (`categories`, `sheetName` were missing). (5) **§10's "Reality check" still called the pipeline not-wired-end-to-end**; updated — the 5 tracked wiring defects and the missing upload route are all closed; what remains is read-side surface and observability. Also corrected the §8.1 file tree (missing `skb-llm.config.ts` and `dto/upload-skb-file.dto.ts`), §8.2's `publishSKBFileIngestion` casing (shipped as `publishSkbFileIngestion`), and §6.3's "default of `100` when omitted" — the effective default is **10** (`body.limit ?? 10` in `StructuredKBController`), the same drift already fixed in `api.md`/`security.md`; §6.3 also now names `SKBRowsRepository.executeQuery()` as the statement that actually runs, since `SKBQueryService.buildSql()` builds a byte-identical string that is only returned and logged. Verified TRUE: §12's config table incl. the "stored `ingest_model`/`query_model` are never read; `SKB_LLM_PROVIDER`/`SKB_LLM_MODEL_ID` default `openai`/`gpt-4o` from `skb-llm.config.ts`" note; the subject constant `AGENT_ADMIN_SKB_FILE_INGESTION`; durable `skb-ingestion-worker`; `SKBContainersController`/`StructuredKBController` class names; the DDL in §2.1 against `schema-initializer.ts` incl. the `status` CHECK and the `gin (data jsonb_path_ops)` index. |
| DOCS/skb/runbook.md | prescriptive | agent-admin-service skb ingestion worker + watchdog | **FIXED** | **Executability: FAILED before this pass, salvaged.** Five fixes. (1) **Restart procedure targeted the wrong workload with the wrong selector in the wrong namespace.** SKB ingestion runs in `agent-admin-service-worker`, a plain `apps/v1` Deployment, in `platform-services-dev` — not `<tenant-ns>` (which holds only tenant datastores). `kubectl scale deployment agent-admin-service` was actively harmful advice: that one is a Knative Service whose Deployment the KPA owns and reverts. The selector `-l app=agent-admin-service` matches nothing — the manifests label `app.kubernetes.io/name`. Replaced with a workload table and a working `kubectl rollout restart deployment/agent-admin-service-worker -n platform-services-dev`. (2) **Re-ingest `curl` could not work**: no `/api` prefix, no `Authorization`, and a `file_id` field that `forbidNonWhitelisted` rejects with 400. Rewritten, with the real 202 body. (3) **The §1 "known limitations" banner was stale on 4 of 5 claims** — upload route, `skb_files` status updates, `insertRows` arity and `findProcessingFilesOlderThan` are all fixed, and query history IS recorded (`SKBQueryService.recordQueryHistory` calls `recordQuery` on both the success and the error path, fire-and-forget with a warn). Replaced with the two gaps that are real: the three missing file-read routes and the absent metrics. (4) **§5's history SQL used columns that do not exist** (`natural_query`, `sql_where`, `sql_sort`, `executed_at`); the DDL and `SKBQueryHistoryRepository.recordQuery`'s INSERT use `nl_query`, `generated_sql`, `created_at` — the query would have errored. Corrected, plus the note that `correlation_id`/`causation_id`/`execution_id` are always NULL today. (5) **§6's six `skb_*` metrics do not exist** — `rg` over `services packages` returns nothing; the table is now labelled as proposed, and the Grafana panel list likewise. Also softened the watchdog claim: it is not stubbed, but `findProcessingFilesOlderThan` only sweeps tenants whose pool this pod has opened (`getKnownTenantIds()`). Verified TRUE: durable name `skb-ingestion-worker`; `ackWaitMs: 300_000`; watchdog `DEFAULT_STUCK_THRESHOLD_MINUTES = 10` / `DEFAULT_CHECK_INTERVAL_MS = 5 min`; batch 5 000; the five `skb_*` table names; the `nats stream/consumer` commands and the `SKB-INGESTION` cleanup (no code creates that stream any more). |
| DOCS/skb/security.md | descriptive | agent-admin-service skb NL→SQL pipeline | **FIXED** | Four fixes; one of them is the doc half of escalation **E9**. (1) **Layer 2 was attributed to `validateSelectOnly()`, which has no production call site** — `rg 'validateSelectOnly' services` matches only its own definition and its spec. `SKBQueryService` imports exactly `isSafe` and `validateWhereClause`; the keyword protection is real but arrives through `isSafe`'s shared `hasBlockedKeyword()`. Re-titled with an implementation-status note in the same shape as Layer 5's existing `enforceLimit()` note. (2) The pipeline diagram implied the guards run on the WHERE clause only; both `isSafe` and `validateWhereClause` are applied to the ORDER BY clause too, in that order (`isSafe` returns boolean, `validateWhereClause` throws). (3) **`LIMIT` default is 10, not 100** — `StructuredKBController` applies `body.limit ?? 10` and re-checks the range by hand; corrected in the diagram, in Layer 5 and in the checklist. (4) Layer 3's table had a 3-column header over 2-cell rows; rebuilt with the per-pattern helper names (`hasSemicolon`, `hasUnion`, `hasLineComment`, `hasBlockComment`, `hasPgCatalog`, `hasInformationSchema`, `hasBlockedKeyword`). Layer 4's template annotated with the two conditional clauses (`whereClause` omitted when blank, `categories` only when requested). Verified TRUE: `BLOCKED_KEYWORDS`'s 11 entries verbatim with `\b` case-insensitive matching; `sanitizeIdentifier`'s five replacements; the `gin (data jsonb_path_ops)` index; `SKBRowIndexService`; `skb_query_history`; `SERVICE_MODE=api|worker`. **Left unedited and escalated (E9): Layer 4's claim that the LLM "never controls" the template is true, but the template itself interpolates `containerId`/`tenantId`/`categories` as raw string literals into `sql.unsafe()` — a hole none of the five layers covers.** |
| DOCS/workflows/connector-vs-workflow.md | descriptive | connector-runtime vs workflow-service | **FIXED** | Five fixes. (1) **The scaling table called connector-runtime a Knative-KPA workload** — it is a plain `apps/v1` Deployment (`knative/services/base/connector-runtime.yaml`, `replicas: 1`, RollingUpdate), as are its `connector-runtime-http`/`-invoke` siblings and `workflow-worker`: a Temporal/JetStream pull worker gives the KPA no signal. This also contradicted `engine.md`'s own note. Corrected, with the base Workflow-API values (`min-scale: 1`, `max-scale: 15` — the doc said max 5) and the dev-overlay `min = max = 1` pin. (2) **The SWR cache numbers were inverted**: `AdapterClient` uses `DEFAULT_CACHE_TTL_S = 60` as the SOFT TTL and `STALE_MULTIPLIER = 5` → 300 s hard TTL; the doc said "300s TTL, 60s stale window". Added `NEGATIVE_CACHE_TTL_S = 10`. (3) **"Workflow step timeout (30s per activity)"** is false for `agentCall` (15 min + 30 s heartbeat); the limitation now enumerates which activities the 30 s applies to. (4) **Both `agentCall` examples set `variables` in the args, which is silently discarded** — `runWorkflow` dispatches `{...resolvedArgs, variables: context.variables}`, so the engine's own five-scope `VariableResolutionContext` always wins; examples rewritten to fold data into `message` with an explicit warning. (5) The lifecycle note gained the real status codes (201 create / 202 execute / 204 delete) and the true pagination shape `{items, total, page, pageSize}` (it said `{items, total, page}`). (6) **Both `jsFunction` examples** (`generateReceipt`, `mergeData`) used bare `return { … }` statement bodies, which `SyntaxError` at `new Function` construction; converted to the `(context) => ({ … })` expression form the activity actually requires — same sweep as `patterns.md` and `onboarding.md`. (7) **Third review round: the Scenario-1 result example and its reader still used `body`** (`Return { status: 200, body: {...} }`, `console.log(result.body.email)`), a field `IHttpCallResult` (`{status, data, headers, cacheResult?}`) does not have — and the file had come to contradict itself, since its Scenario-2/5 examples already read `.data`. Both changed to `data`; the pseudocode framing kept. `rg '\.body\b|body:' DOCS/workflows/connector-vs-workflow.md` now returns nothing, so this file needs no result-shape disclaimer. Verified TRUE: 400 concurrent activities; workflow worker 200 activity / 150 workflow tasks (`worker.ts`); `HTTP_BREAKER_COOLDOWN_MS` 30 s and the 5-attempt / 1 s / ×2 / 30 s retry policy; the 9 `ConditionComparator` values; `ConditionalAction.default`; `BranchAction`'s index-signature shape; `ServiceCallArgs.serviceId`/`serviceSlug` semantics; `AgentCallArgs` required `agentId`+`message` and `AgentCallContextEntry` = `{sender: "customer"|"agent", content}`; all seven Further-Reading links. |
| DOCS/workflows/engine.md | descriptive | workflow-service engine | **FIXED** | Four fixes. (1) **The Action Types table was missing `mcpCall`** — the `WorkflowAction` union has 9 members and `runWorkflow`'s switch has one `case` each; added with its real queue (`connector-runtime`, it shares the `http` proxy) and the dispatch diagram updated. Local activities also gained their attempt count (`retry: {maximumAttempts: 3}`). (2) **The completion-publisher section documented one activity**; the `publisher` proxy actually carries a five-member family from the same file — `publishExecutionStartedEvent`, `publishExecutionCompletedEvent`, `publishActionStartedEvent`, `publishActionCompletedEvent`, `publishConditionEvaluatedEvent` — while only `execution_completed` is projected. Rewritten as a table, with `ExecutionProjectorService`'s exact `filterSubject` and its `MAX_BATCH_SIZE = 100`. (3) The trigger idempotency key was written `envelope.idempotencykey + def.id`; the real format is `` `${baseIdempotencyKey}:${def.id}` `` and the option is omitted entirely when the envelope has no `idempotencykey`. Verified TRUE: durable `workflow-triggers` on `INGRESS-*` with the `received.v1` filter; `trigger.type === "message_received"` and the four filters `accountIds`/`channels`/`providers`/`patterns`; exclusive-vs-shared mode; the claim-check inflation at `CLAIM_CHECK_THRESHOLD_BYTES` via `MultiTenantConsumerManager.wrapHandler`; the builder warning is a non-blocking `INVALID_VALUE` on `args.accountId` in `workflow.validator.ts` with `SOURCE_ACCOUNT_TEMPLATE = "{{request.envelope.accountId}}"` exempt and an empty `accountIds` selection skipping the check; `WORKFLOW_ORCHESTRATOR_TASK_QUEUE`/`CONNECTOR_RUNTIME_TASK_QUEUE`; 400 concurrent activities; the no-ScaledObject note (K6b). |
| DOCS/workflows/patterns.md | prescriptive | workflow-service step types; integrations samples | **FIXED** | The worst find of T03: **most recipes on this page used template variables that silently resolve to the empty string.** `WorkflowExecutionContext.workflow` carries only `{name, tenant, application}` (plus `agentTimeoutMs` when set) — there is no `workflow.id`, `workflow.tenantId`, `workflow.startTime`, `workflow.endTime` or `workflow.channelAccountId`, and `resolvePath` returns `""` for any missing segment, so a wrong path never fails a run, it just injects nothing. Nine such uses across Patterns 3, 5, 6 and 9 (four `{{workflow.startTime}}`, three `{{workflow.id}}`, one `{{workflow.endTime}}`, one `{{workflow.channelAccountId}}`) were rewritten to real paths (`{{workflow.name}}`, `{{workflow.tenant}}`, `{{executionId}}`, `{{request.*}}`, `{{results.*}}`), the "Template scopes" legend that explicitly blessed `{{workflow.id}}`/`{{workflow.tenantId}}`/`{{workflow.startTime}}` was rebuilt from the interface (adding the `variables.*` five-scope family it omitted), and a header note now states the empty-string failure mode. Three further fixes: the "Available action kinds" list was missing `mcpCall` (9, not 8); Pattern 8's comment said "Free-form data goes in `variables`" — the exact opposite of the code, which overwrites `args.variables` with `context.variables` at dispatch; and Pattern 8's "Timeout: 60s (configurable)" for `agentCall` is 15 min start-to-close / 30 s heartbeat with `AGENT_CALL_TIMEOUT_MS` (900 s, overridable per definition via `workflow.agentTimeoutMs`) as the activity's own wait. **Same-class defect swept in this file (found while fixing the onboarding blocker, not reported by review): all four `jsFunction` examples used bare statement bodies** (`mergeEnrichment`, `shouldApprove`, `checkSuccess`, `parseRequest`), every one of which `SyntaxError`s at `new Function("return " + args.code)` construction. All converted to `(context) => …` expression form; `checkSuccess` additionally read `result.body`, a field `IHttpCallResult` does not have — corrected to `result.data`, which this file's own header note already prescribed. All 8 `jsFunction` values across the T03 corpus were then executed through the activity's exact two lines (`new Function("return " + code)()` then `await fn(context)`): 8 pass, 0 fail. **Third review round: Pattern 1's and Pattern 2's response examples still showed `body`, and Pattern 1 also invented `duration: 145` / `retriesUsed: 0`** — none of the three exist on `IHttpCallResult`. Converted to `data`, phantom fields dropped, and Pattern 2's `...` closed out to the real `headers`. The header disclaimer was then shrunk to match: it no longer warns that "some recipes below use `body`" (none do), and now only flags the two request-side fields Pattern 1 still shows as pseudocode, `timeout`/`retries`. Deliberately left: the two surviving `.data.body` / `.data.duration` template reads (Patterns 6 and 9) are fields of the REMOTE service's payload nested under the correct `.data`, not the phantom top-level ones. Verified TRUE and left: the `activity`-not-`type` note; the `IHttpCallResult` `{status, data, headers}` shape and the "no `timeout`/`retries` on the args" note; the `serviceId`-is-a-UUID note; `BranchAction`'s every-other-key-is-a-branch shape; the 5-attempt retry policy and the 30 s breaker cooldown; `WORKFLOW_DEFAULT_TIMEOUT_MS = 600_000` = 10 minutes; `Channel` has no `email`/`sms`; `channelSend` requires `accountId`/`channel`/`provider`/`to`/`type`; there is no `sleep` action. |
| DOCS/README.md | descriptive | meta (DOCS tree index) | **FIXED** | Seven fixes. (1) **Workflow Orchestration table said "eight action types"** and was missing `mcpCall`; worse, it put `agentCall` on the `connector-runtime` queue as an "HTTP call to `agent-ai-service` chat endpoint" — it is a LOCAL activity on `workflow-orchestrator` that publishes `execution_requested.v1` to JetStream and waits on core NATS. Rebuilt to 9 rows with real queues. (2) **Event-flow step 1 said the gateway "authenticates the request, resolves the tenant" and returns `202 Accepted`** — the webhook route is `@Public()`/`@SkipTenant()`, performs no signature check, and answers `200 OK` `{status:"accepted"}` (`@HttpCode(HttpStatus.OK)`) only after the publish, with 503 + `Retry-After` on backpressure. (3) **Stream limits were stated as flat "7 days / 256 MB (free tier)"** — tier-dependent since 2026-08-01 (`TENANT_TIER_LIMITS`: free 7 d/1 GiB, pro 14 d/5 GiB, enterprise 30 d/20 GiB); the `CHANNEL_STREAM_*` constants are only the lazy-ensure fallback. (4) The `INGRESS-<tenant>` producer list named 5; the census is 11 (cross-linked to `envelope.md` §2.1). (5) **The topology box listed `workflow-worker` and `connector-runtime` as Knative Services** and omitted the workers entirely; split into a Knative block and a plain-Deployment block enumerated from `kind:` in `knative/services/base/*.yaml` (11 Deployments). (6) **`kubectl apply -k knative/services/overlays/local/dev`** contradicted the same file's other apply block; it still resolves (a one-line alias for `../postgres-dev`) but the explicit engine overlay is now the instruction. (7) The `docker build` loop's hand-written service list omitted `provisioning-service`, `tracking-ingester-service` and `admin-console`; replaced with a `ls services`-driven loop, and the Project Structure tree gained the two missing service dirs. Also added `/api` to the OrbStack `auth/token` curl. **Review fix:** the justification paragraph for (5) had landed INSIDE the diagram's fenced block, splitting the ASCII box in half between the worker list and the support-services block; moved below the closing fence, matching how the rest of the file annotates its diagrams. Fence parity re-checked across every file touched by this task. Verified TRUE: "13 static guards" (main() calls exactly 13); `--smoke` flag and `scripts/smoke-test.sh`; `Tiltfile`; `setup-tenant.sh`'s named flags; the tenant/workflow walkthrough's `/api`-prefixed curls and `{"status":"COMPLETED"}` claim; the `SKB-INGESTION` troubleshooting (no code creates that stream now); `test:unit`/`test:integration` scripts; all 20 service-README links and 5 package-README links; the samples/examples three-tier map. |
| DOCS/v_next/README.md | future | meta (v_next class + promotion rule) | **TRUE** | Rule-5 hygiene confirmed: `fd -H . DOCS/v_next` returns `README.md` and nothing else — `tenant-messaging-tiers.md` really did leave the folder when it shipped on 2026-08-01, and all three of the pointers its Contents row leaves behind resolve (`DOCS/messaging/tenant-messaging-tiers.md`, `manual-loops/messaging/tenant-messaging-tiers.md`, and the `docs-consistency.md` decision-5 citation, whose text — "DESCRIPTIVE docs are derived FROM the code … PRESCRIPTIVE docs are NOT rewritten from code" — matches the two-class table quoted here). Rule 3 ("guards do not validate this folder against today's code") holds: no guard in `doc-code-guards.sh` names `v_next`, and the only one whose corpus reaches it is K10, which checks link resolution, not code claims. Nothing to fix. |

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

### From T03 (2026-08-02) — DOCS/channels, agents, workflows, skb, reference, adr, guides, runbooks

One genuine CODE bug (E9 — security), plus three items that need a human ruling.

**E6 — six source files cite a documentation path that does not exist.**
`DOCS/cowork/METERING-FOUNDATION.md` is referenced from
`packages/shared/src/channel.interfaces.ts`, `packages/shared/src/audit-mongo-schema.ts`,
`services/audit-service/src/common/execution-audit-projection.ts`,
`services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts`,
`services/audit-service/src/modules/execution-audit/execution-audit.service.ts` and
`services/audit-service/test/unit/channel-audit-repo-correlation.spec.ts`.
The file is at `cowork/METERING-FOUNDATION.md` — there is no `DOCS/cowork/`
directory at all, so every one of those pointers is dead. Same class as **E4**
(code comments citing docs), pointing the other way: not a rotting line number
but a rotting path. No guard catches it, because `K10` scans markdown links in
docs, not doc paths inside source. T09 should rule with E4: one guard that
validates `DOCS/**`-shaped and `cowork/**`-shaped references found inside
`services/` and `packages/` against the filesystem. Out of scope here (runtime
source).

**E7 — a shipped fixture teaches three wrong things at once.**
`services/agent-admin-service/data/jobs.yaml` is the reference seed the jobs
documentation points at, and it disagrees with the code on every axis:
`schedule: "interval:3600"` with `description: "…every hour"` is really 3 600
MINUTES (60 h) under `parseSchedule` (the hourly form is the bare `"3600"`);
it uses `enabled:` where `IJob` declares `is_active`; and its
`payload.action: "collect_metrics"` never matches `JobExecutorService`'s
switch, which reads `payload.action_type`, so a job created from this payload
falls to the `default` branch and publishes `execution_failed`. `jobs.md` now
carries an explicit do-not-copy warning, which is the doc-side fix. The
fixture itself is data, not runtime code, but it is the thing a new developer
copies — T09 should rule: correct it, or delete it and let the doc's own
example be the reference.

**E8 — two SKB safety helpers are dead code with passing tests.**
`skb-sql-safety.ts` exports `validateSelectOnly()` and `enforceLimit()`.
Neither has a production call site: `rg 'validateSelectOnly|enforceLimit' services`
matches their definitions in `skb-sql-safety.ts`, the assertions in
`test/unit/structured-kb/skb-sql-safety.spec.ts`, and — since this task — the
documentation notes that deliberately name them as unwired (`DOCS/skb/security.md`
Layers 2 and 5 plus its Security Checklist, and `DOCS/skb/architecture.md` §6.3).
No call site in any service's runtime source; scoping the same `rg` to `services`
still returns only the definition and the spec. Yet `security.md` presented
them as Layers 2 and 5 of a five-layer defence. The protection they describe
does exist through other means — `isSafe()` shares `hasBlockedKeyword()`, and
the `LIMIT` cap is enforced by `QuerySKBDto` + a hand-written range check in
`StructuredKBController` — so this is not an open hole by itself; but a tested,
exported, uncalled guard is exactly the thing a future reader assumes is
running. The doc now says so; T09 rules on whether to wire them or delete them.

**E9 (genuine CODE bug — security; escalated, NOT fixed) — the SKB query
builder interpolates unvalidated request input into `sql.unsafe()`.**
`SKBRowsRepository.executeQuery` assembles the executed statement by string
concatenation:

```ts
const whereParts: string[] = [
  `container_id = '${containerId}'`,
  `tenant_id = '${tenantId}'`,
];
…
whereParts.push(`categories @> '${JSON.stringify(options.categories)}'::jsonb`);
…
await sql.unsafe(dataQuery);
```

`containerId` arrives as a bare `@Param("id")` on
`StructuredKBController.query` with **no `ParseUUIDPipe` and no format check**
anywhere on the path, and `categories` is typed only `@IsArray()` on
`QuerySKBDto` (no `@IsString({ each: true })`, no character restriction). The
SKB safety helpers do not cover either value — `isSafe()` and
`validateWhereClause()` are applied to the LLM-produced `whereClause` and
`orderBy` only, which is precisely what `security.md` §"Layer 4" describes as
the part the user "can never control".

A single quote in the path segment therefore breaks out of the literal. The
cheapest demonstration keeps the tenant filter intact and still defeats the
container filter, because `AND` binds tighter than `OR`:

```
POST /api/admin/structured-kb/containers/x' OR '1'='1/query
→ WHERE container_id = 'x' OR '1'='1' AND tenant_id = '<tenant>' …
→ every row of every container in the tenant
```

and the same hole accepts arbitrary trailing SQL. Note the ONE mitigating
fact: `getSql(tenantId)` returns the per-tenant connection, so the blast radius
observed here is cross-container within one tenant rather than cross-tenant —
but the injection point itself is unbounded, and `sql.unsafe` runs whatever it
is handed.

This is behaviour nobody could want, so per ground rule 1 this loop stops at
reporting it. The fix is a code loop, not a doc edit: parameterise the two
literals (postgres.js `sql.unsafe(text, params)` is already used elsewhere in
the same file), or validate `containerId` as a UUID at the controller and
constrain `categories` element-wise — ideally both. `security.md`'s Layer 4
section was left describing the template honestly and now carries a pointer to
this escalation.
