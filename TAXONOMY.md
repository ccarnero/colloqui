# Bus Event Taxonomy

**Status: APPROVED — user decisions incorporated 2026-07-09; pending implementation**
**Date: 2026-07-09**
**Scope:** classification rules a message-tracking ingester will use to tag every NATS bus event with two dimensions — `tech` (technology/channel) and `business_fn` (business function) — plus two orthogonal facets: `consumed_by` (multi-value, Postgres `text[]`) and `is_claim_check` (boolean). This document does not describe a new component; it derives rules purely from the existing subject taxonomy, envelope contract, and service map already implemented in this repo. All 7 open questions from the draft were resolved by the user on 2026-07-09 (see §7).

---

## 1. Evidence sources

| # | Source | What it gave us |
|---|--------|------------------|
| 1 | `docs/messaging/service-bus.md` | Stream topology, 8-token subject format, stream↔subject mapping, DLQ headers |
| 2 | `docs/messaging/envelope.md` | `EventEnvelope` schema, `type`/`source`/`producer`/`domain`/`channel`/`provider` semantics, D13 canonical-taxonomy decision |
| 3 | `docs/messaging/claim-check.md` | Claim-check trigger, `payload_inline`/`payload_ref` semantics |
| 4 | `docs/messaging/ingress.md` | Two-stage webhook bridge, agent lifecycle subjects, `MAX_DEPTH_BY_CATEGORY` |
| 5 | `docs/channels/channel-service.md` | Implemented channel/provider pairs, `buildChannelSubject` |
| 6 | `packages/shared/src/constants.ts` | Platform subject prefixes (`agent-admin-service`, `ai-agent-gateway`, `agent-scheduler-service`), `GATEWAY_AUDIT_SUBJECT`, `DLQ_STREAM_SUBJECTS`, `RUNTIME_STREAM_SUBJECT_PREFIX` |
| 7 | `packages/shared/src/channel.constants.ts` | `CHANNEL_STREAM_SUBJECTS_PATTERN`, `WEBHOOK_INGRESS_SUBJECT_FILTER`, `CHANNEL_SEND_SUBJECT_PATTERN`, `buildDlqSubjectPattern` |
| 8 | `packages/shared/src/channel.interfaces.ts` | `Channel` and `ChannelProvider` enums (`whatsapp\|instagram\|telegram\|http`, `meta\|telegram\|http`) |
| 9 | `packages/shared/src/tenant-events.ts` | `platform.tenant.>` Core-NATS/JetStream lifecycle subjects |
| 10 | `packages/shared/src/platform.utils.ts` | `buildRegistryPlatformSubject`, registry-service event types |
| 11 | `services/usage-aggregator-service/src/modules/aggregator/envelope-parser.ts` | Real subject markers used in production parsing (`.channel-service.messaging.`, `.connector-runtime.platform.endpoint.`), `KIND_TO_DIRECTION` map |
| 12 | `services/admin-console/src/app/features/processes/trace/domain/transport-topology.ts` | Hand-maintained durable-consumer registry (who subscribes to `received`/`send`/`sent`) |
| 13 | `grep -o 'io\.yoizen\.[a-zA-Z0-9_.-]+'` across `packages/` and `services/` | Full inventory of CloudEvents `type` values in use |
| 14 | `services/agent-memory-service/src/providers/nats.provider.ts` | Verified agent-memory subject prefix `AGENT_MEMORY_SUBJECT_PREFIX` and its publisher (`NatsPublisher.publishEvent`) — added during Q3 resolution |

---

## 2. `tech` dimension

`tech` identifies the technology/channel that produced or is intrinsically tied to the event. Derived from the `channel` token (5th subject token / envelope field) plus a few non-channel technology buckets that show up as distinct subject/stream families.

| `tech` value | Definition | Evidence |
|---|---|---|
| `whatsapp` | WhatsApp Business messaging via Meta | `Channel = "whatsapp"` (`packages/shared/src/channel.interfaces.ts:3`); subject `evt.<tenant>.channel-service.messaging.whatsapp.meta.<kind>.v1` (`docs/channels/channel-service.md:51`) |
| `instagram` | Instagram DM messaging via Meta | `Channel = "instagram"`; subject `evt.<tenant>.channel-service.messaging.instagram.meta.<kind>.v1` (`docs/channels/channel-service.md:52`) |
| `telegram` | Telegram Bot API messaging | `Channel = "telegram"`, `ChannelProvider = "telegram"`; subject `evt.<tenant>.channel-service.messaging.telegram.telegram.<kind>.v1` (`docs/channels/channel-service.md:53`) |
| `http-generic` | Generic HTTP-webhook channel, authenticated via `x-http-channel-token`. **Mapping:** the source-code value is `Channel = "http"`; the ingester's public `tech` column renames it to `http-generic` at classification time. The internal code value is NOT changed. | `Channel = "http"`, `ChannelProvider = "http"` (`channel.interfaces.ts:3-4`); provider dir `services/channel-service/src/providers/http/` (`docs/messaging/ingress.md:159-160`) |
| `platform` | Non-messaging, internal/platform-to-platform events — the `channel` token is the literal placeholder `platform` or `system` | `channel = "platform"`, `provider = "internal"` (envelope examples §10.3/10.4 in `docs/messaging/envelope.md`); `PLATFORM_CHANNEL = "platform"`, `PLATFORM_NON_CHANNEL_TOKEN = "system"` (`packages/shared/src/constants.ts:52,89`) |
| `runtime-stream` | Ephemeral per-execution token/tool-call streaming, deliberately outside the `evt.` taxonomy | `RUNTIME_STREAM_SUBJECT_PREFIX = "rt.{tenant}.exec.{executionId}"` (`packages/shared/src/constants.ts:198`); subject family `rt.<tenant>.exec.<executionId>.<kind>` |
| `connector` | Third-party/internal HTTP adapter call events (connector-runtime endpoint invocations) AND connector-runtime MCP tool-call events (rule 24, `manual-loops/connectors/connection-call-inspector.md` T03/T05) — MCP servers are one of the connector kinds surfaced on the connection-detail screens (decision 1) | `CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint."` (`services/usage-aggregator-service/.../envelope-parser.ts:204`); MCP family verified in `services/connector-runtime/src/activities/_shared/event-publisher.ts` `emitMcpCall` (producer `connector-runtime`, domain `platform`, channel `mcp`, provider `system`) |
| `tenant-lifecycle` | Tenant provisioning/ready/deletion control-plane messages (Core NATS + `PLATFORM_TENANTS`) | `platform.tenant.provision.requested` / `platform.tenant.ready` / `platform.tenant.deleted` (`packages/shared/src/tenant-events.ts:33-128`) |
| `gateway-audit` | Cross-tenant API-gateway request audit trail (not part of the tenant `evt.` taxonomy) | `GATEWAY_AUDIT_STREAM_SUBJECTS = ["audit.gateway.>"]`, `GATEWAY_AUDIT_SUBJECT = "audit.gateway.request"` (`packages/shared/src/constants.ts:82-84`) |
| `unknown` | Fallback — subject/envelope does not match any known channel or platform-technology family. Reserved exclusively for unrecognized traffic (see §7 D6). | n/a (deterministic fallback, see §4) |

> **Decision note (Q5 — `http` → `http-generic`):** the public `tech` value is `http-generic` to avoid confusion with `transport.protocol: "https"` (wire protocol) and `EventTransport.method` values in Grafana dashboards. The rename lives ONLY in the ingester's classification layer; the source-code enum `Channel = "http"` stays untouched. Classifier implementers must map subject/envelope token `http` → output `http-generic`.

**Note on scope:** `whatsapp`/`instagram`/`telegram`/`http` are the only channels with a real `IChannelProvider` implementation (`docs/channels/channel-service.md:16-24`, `docs/messaging/ingress.md:154-162`). TikTok/Twitter mentioned in older design docs are explicitly **not implemented** (`docs/messaging/ingress.md:162`) — do not add them as `tech` values until code exists.

---

## 3. `business_fn` dimension

`business_fn` identifies what the event *represents* — **producer intent, never consumer role**. It is a pure function of the subject/payload. Which services read the event is captured separately in the `consumed_by` facet (§5).

> **Decision note (Q1 — producer intent only):** the user ruled that `business_fn` ALWAYS reflects what the event represents at publish time, so it stays deterministic and computable from `(subject, envelope)` alone. Consumer roles (usage aggregation, audit sinks) never change an event's `business_fn`; they are recorded in `consumed_by`. This keeps the classifier a pure function and lets Grafana pivot "what happened" independently from "who read it".

| `business_fn` value | Definition | Evidence |
|---|---|---|
| `ingress` | Stage-1 raw webhook receipt from an external provider, not yet account-resolved | `kind = "webhook_received"`, subject `evt.<tenant>.api-gateway.messaging.<channel>.webhook.webhook_received.v1` (`docs/messaging/ingress.md:72-80`); `WEBHOOK_INGRESS_SUBJECT_FILTER` (`channel.constants.ts:51-52`) |
| `channel-processing` | Stage-2 canonical channel message processing — signature verification, account resolution, inbound message parsing, publish of canonical `ChannelEnvelope` | `kind = "received"`, producer `channel-service`, subject `evt.<tenant>.channel-service.messaging.<channel>.<provider>.received.v1` (`docs/messaging/ingress.md:123-143`); `CHANNEL_STREAM_SUBJECTS_PATTERN` (`channel.constants.ts:8-9`) |
| `channel-egress` | Outbound message send/delivery lifecycle (`send` intent, `sent`/`delivered`/`read`/`failed` confirmations) | `kind ∈ {send, sent, delivered, read, failed}`; `CHANNEL_SEND_SUBJECT_PATTERN = "evt.*.channel-service.messaging.*.*.send.v1"` (`channel.constants.ts:35-36`); egress shadow envelopes via `createChannelSentEnvelope` (`docs/messaging/ingress.md:145-152`); durable `channel-egress` consumes `send.v1` (`transport-topology.ts:20`) |
| `routing` | Downstream trigger routing of a received message into workflow/automation execution | durable `workflow-triggers` subscribes to `received.v1` (`transport-topology.ts:15`); `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts` |
| `agent-execution` | AI agent execution lifecycle (request/start/complete/fail) orchestrated by `ai-agent-gateway` | `AI_AGENT_GATEWAY_EXECUTION_REQUESTED/STARTED/COMPLETED/FAILED`, prefix `evt.{tenant}.ai-agent-gateway.automation.platform.internal` (`packages/shared/src/constants.ts:165-168`); event types `io.yoizen.platform.runtime.execution_requested.v1` / `execution_completed.v1` |
| `agent-admin` | Agent publish/config lifecycle managed by `agent-admin-service` (config sync, job trigger, agent published/unpublished, chat respond, SKB ingestion) | `AGENT_ADMIN_SUBJECT_PREFIX = "evt.{tenant}.agent-admin-service.automation.platform.internal"` and its `config_sync`/`jobs_sync`/`job_trigger`/`chat_respond`/`agent_published`/`agent_unpublished`/`document_ingestion`/`skb_file_ingestion` subjects (`packages/shared/src/constants.ts:119-133`) |
| `agent-scheduling` | Scheduled/cron agent job heartbeat and triggering | `SCHEDULER_SUBJECT_PREFIX = "evt.{tenant}.agent-scheduler-service.automation.platform.internal"`, `SCHEDULER_HEARTBEAT` (`packages/shared/src/constants.ts:175-177`); `services/agent-scheduler-service/src/modules/heartbeat/heartbeat.service.ts` |
| `agent-memory` | Agent memory lifecycle (proposed/published/rejected/expired) emitted by `agent-memory-service` | Subject prefix `AGENT_MEMORY_SUBJECT_PREFIX = "evt.{tenant}.agent-memory-service.agent-memory.platform.internal"` with kinds `memory_proposed`/`memory_published`/`memory_rejected`/`memory_expired` (`packages/shared/src/constants.ts:145-153`, moved there 2026-07-31 by envelope-drift T08); published via `NatsPublisher.publishEvent` → `buildPlatformSubject` (`services/agent-memory-service/src/providers/nats.provider.ts:332-337`); event types `io.yoizen.agent-memory.platform.internal.<kind>.v1` (`nats.provider.ts:69-74`, projected from the subject constants by `agent-memory-event-type.ts`; before 2026-07-31 they were `io.yoizen.agent-memory.memory.*.v1`) |
| `agent-runtime-streaming` | Ephemeral per-execution token/tool-call/cancel streaming (not persisted, not part of `evt.` taxonomy) | `RUNTIME_TOKEN/TOOL_CALL/TOOL_RESULT/CANCEL`, `RUNTIME_STREAM_SUBJECT_PREFIX` (`packages/shared/src/constants.ts:198-211`) |
| `connector-invocation` | HTTP adapter/connector call events (status, duration, cache result) emitted by `connector-runtime`. Also covers `connector-runtime`'s MCP tool-call audit events (rule 24, fields `serverName/mcpServerId/toolName/success/durationMs/error/arguments/result`) — REUSED, not split into a new value, because decision 1 of `manual-loops/connectors/connection-call-inspector.md` groups `mcpCall` alongside `endpointCall` as one of "every connector invocation type" on the same connection-detail surface | `CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint."`, fields `adapterId/endpointId/status/durationMs/cacheResult` (`services/usage-aggregator-service/.../envelope-parser.ts:198-302`); MCP family verified in `event-publisher.ts`'s `emitMcpCall` |
| `llm-invocation` | Standalone LLM call audit trail (model, provider, prompt/completion, token usage, cost, duration) emitted by `agent-ai-service` for LLM calls made OUTSIDE chat/agent executions (the job-executor `llm_call` action). A NEW, distinct `business_fn` from `agent-execution` (rule 6) and `connector-invocation` (rules 11/24) — producer-intent decision (§3 Q1): this event represents a standalone LLM invocation, not a full agent chat execution or a connector-runtime HTTP/tool call. Chat executions are NEVER double-captured here — they already carry their payload in `agent-execution`'s `execution_completed` and the emitter explicitly excludes the chat path | Human-approved subject naming (`manual-loops/connectors/connection-call-inspector.md` T04/T05, decision 7): `evt.<tenant>.agent-ai-service.platform.llm.system.llm_call_completed.v1`; producer `agent-ai-service`, domain `platform`, channel `llm`, provider `system`; verified in `services/agent-ai-service/src/modules/llm/llm-call-event-publisher.service.ts` |
| `workflow-execution` | Workflow execution lifecycle emitted by `workflow-service`: run-level (`execution_started`/`execution_completed`) AND step-level telemetry (`action_started`/`action_completed`/`condition_evaluated`) added by the `workflow-step-events` queue (`manual-loops/workflow-step-events.md`, T01). Subjects follow the same family `evt.<tenant>.workflow-service.workflow.internal.native.<kind>.v1` built by `buildExecutionCompletedSubject`'s pattern and the envelope `producer: "workflow-service"` / `domain: "workflow"` (`services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts:47,151-152`). tech is `platform` per §2 (Temporal is a runtime detail absent from the subject/envelope). Step-event payload contract (camelCase, matching the codebase's real payload convention — e.g. `execution-completed-publisher.activity.ts`'s `executionId`/`workflowName`): `action_started`/`action_completed` carry `actionIndex` (0-based position in the definition), `actionType` (`http_call\|agentCall\|sendMessage\|setVariable\|condition\|fork\|join\|...` from the definition), `actionName`, `branch` (label when inside a fork/condition branch, else absent), instance refs `connectorId`/`agentId` when the action targets a connector/agent, and `status` (`ok\|failed\|skipped`, `action_completed` only). `condition_evaluated` carries `{ expression, evaluatedValue, branchTaken, cases }` — `evaluatedValue` is the scalar/short evaluated value only (never the full variable scope, per SPEC decision 3), `branchTaken` is the matched case label (`null` for an if-without-else evaluating false), `cases` is the array of declared case labels. |
| `runtime-presence` | Agent-runtime liveness heartbeat — a per-tenant presence signal, NOT business traffic. Disposition `counted-not-persisted` (see §4 note): named so it stops alarming as `unknown`, but no row is persisted; an OTel counter + dashboard panel keep it visible (heartbeat rate → 0 with active tenants = agent runtime down). | Subject `evt.<tenant>.ai-agent-gateway.automation.platform.internal.online.v1` published every ~15s per active tenant by `agent-ai-service`'s `HeartbeatService` (`services/agent-ai-service/src/modules/heartbeat/heartbeat.service.ts:91`). The subject producer token is `ai-agent-gateway` but the real publisher is `agent-ai-service` — a known producer-token drift analogous to the agent-memory `envelope.producer` drift in `DRIFT.md` item 9; the heartbeat family's other non-canonical traits (UUID idempotencykey, `{name,version}` transport) are recorded in `DRIFT.md` item 5 and its trailing "Not part of the original 9 items" note. tech is `platform` per §2. |
| `registry-sync` | Service registry lifecycle (Knative service upserted/deleted) consumed by `connector-admin`'s internal-sync durable | `buildRegistryPlatformSubject`, `SERVICE_UPSERTED_EVENT_TYPE`/`SERVICE_DELETED_EVENT_TYPE` (`packages/shared/src/platform.utils.ts:19-69`); durable `adapter-internal-sync` (`services/connector-admin/src/modules/internal-sync/internal-sync.service.ts:109-155`) |
| `provisioning` | Declarative manifest apply-engine audit trail (`manual-loops/declarative-provisioning.md` T04): run-level lifecycle (`apply_started`/`apply_completed`/`apply_failed`) and per-resource action (`resource_applied`) emitted by the NEW `provisioning-service` while reconciling an `IntegrationManifest` against live platform state. | Human-approved subject naming (2026-07-14): `evt.<tenant>.provisioning-service.provisioning.platform.internal.{apply_started,resource_applied,apply_completed,apply_failed}.v1`; producer `provisioning-service`, domain `provisioning`, channel `platform`, provider `internal`. |
| `secrets-audit` | Secrets CRUD + broker resolve audit trail (`manual-loops/declarative-provisioning.md` T05): `secret_written` (a `PUT /secrets/:name` write), `secret_resolved` (a broker resolve granted), `secret_access_denied` (a broker resolve denied — binding mismatch or missing secret), emitted by `provisioning-service`. A SEPARATE `business_fn` from T04's `provisioning` (human decision, 2026-07-14) even though it is the SAME producer/domain/channel/provider family — secrets audit is a distinct business concern (who accessed which credential) from apply-run bookkeeping. NEVER carries a secret VALUE. | Human-approved subject naming (2026-07-14): `evt.<tenant>.provisioning-service.provisioning.platform.internal.{secret_written,secret_resolved,secret_access_denied}.v1`; producer `provisioning-service`, domain `provisioning`, channel `platform`, provider `internal`. |
| `tenant-provisioning` | Tenant creation/readiness/deletion control-plane workflow | `platform.tenant.provision.requested` (durable `tenant-provisioner`), `platform.tenant.ready`, `platform.tenant.deleted` (`packages/shared/src/tenant-events.ts:39-128`) |
| `audit` | Events ORIGINATING in the cross-tenant `GATEWAY_AUDIT` stream only. Per-tenant channel events that `audit-service` merely reads keep their messaging `business_fn` (see Q4 decision note below). | `audit.gateway.>` / `audit.gateway.request` (`packages/shared/src/constants.ts:82-84`); durable `gateway-audit-writer` (`GATEWAY_AUDIT_CONSUMER_NAME`) |
| `dlq` | Dead-lettered message (delivery exhausted, claim-check failure, depth exceeded, etc.) | `dlq.<tenant>.>` / `dlq.webhook`; `X-Dlq-Reason`/`X-Dlq-Stage` headers (`docs/messaging/service-bus.md:216-235`); `buildDlqSubjectPattern`/`buildDlqMessageSubject` (`channel.constants.ts:89-102`) |
| `legacy` | Surviving traffic on the deprecated flat `EVENTS` (`events.>`) / `RESULTS` (`results.>`) streams (D13 deprecation) | `docs/messaging/envelope.md` §12 (D13); deprecation markers in `packages/shared/src/constants.ts` |
| `unknown` | Fallback — subject/envelope does not match any known business-function pattern. Reserved EXCLUSIVELY for unrecognized traffic — it is the alarm, never a catch-all for known-but-deprecated families. | n/a (deterministic fallback, see §4) |

> **Decision note (Q4 — audit two-tier confirmed):** `audit-service` plays two roles. (a) Its `channel-events-audit` durable reads per-tenant `received`/`send`/`sent` events — those events KEEP their messaging `business_fn` (rules 2-5), and audit-service appears in their `consumed_by`. (b) Events on the cross-tenant `GATEWAY_AUDIT` stream get `business_fn: audit` (rule 13). This follows directly from the Q1 producer-intent rule: reading an event for audit purposes does not change what the event represents.
>
> [Verification note (T07, 2026-07-30) — the decision above is unchanged; two
> incidental references in it are stale. (a) The durable is named `channel-audit`,
> not `channel-events-audit` (`services/audit-service/src/modules/channel-audit/channel-audit.service.ts:49`);
> see the §5 note for the origin of the stale name. (b) `GATEWAY_AUDIT` events are
> classified by **rule 14**, not rule 13 — §4 assigns `audit.gateway.>` to rule 14
> (`TAXONOMY.md:115`) and the classifier agrees
> (`services/tracking-ingester-service/src/lib/classify.ts:475-480`); rule 13 is
> `platform.tenant.*` tenant-lifecycle (`TAXONOMY.md:114`).]

> **Decision note (Q3 — `agent-memory` added after code verification):** the subject shape was verified in the publisher code, not guessed. `AGENT_MEMORY_SUBJECT_PREFIX` (`packages/shared/src/constants.ts:145-153`) is published through `NatsPublisher.publishEvent` (`services/agent-memory-service/src/providers/nats.provider.ts:332`) using the shared `buildPlatformSubject` helper. This subject family's 4th token (domain) is `agent-memory`, NOT `automation`. Classify by SUBJECT (rule 9 below) — that remains the rule for every family.
>
> **Updated 2026-07-31 (envelope-drift T08):** both halves of the original caveat are fixed. The constants moved from the service to `packages/shared/src/constants.ts`, beside every other internal producer's prefix; and the envelope body now sets `domain: AGENT_MEMORY_DOMAIN` (`agent-memory`, `nats.provider.ts:214`) instead of agent-admin's `PLATFORM_DOMAIN` (`automation`), so body and subject agree. Rows ingested before that date still carry `domain: "automation"` in `tracking.tracked_events` (the column copies the envelope field verbatim). `DRIFT.md` #9 records the original finding.
>
> **Updated 2026-07-31 (envelope-drift follow-up, producer half):** the same
> envelope also reported `producer: "agent-admin-service"` while its subject's
> producer token is `agent-memory-service`. It now sets
> `producer: AGENT_MEMORY_PRODUCER` (`nats.provider.ts:224`). Both fields were
> one leftover: `git log --follow` shows the publisher was renamed out of the
> admin service at 61% similarity (`R061` in `e9e3a94b`), where those values
> were correct — the extraction rewrote the subject and `transport.agent_id`
> but not the envelope identity fields. As with `domain`, rows ingested before
> this date keep `producer: "agent-admin-service"` in `tracking.tracked_events`,
> so that column spans the cutover; nothing filters on it (the classifier reads
> the subject, `classify.ts:258`), and the admin console only displays it
> (`causal-graph-geometry.ts:50-51`).
>
> [Citation correction, refreshed 2026-07-31 after the item-1 type fix: the
> T08 note above places `domain: AGENT_MEMORY_DOMAIN` at
> `nats.provider.ts:214`, and the producer note above originally said `:214`
> too. Both moved as later edits inserted lines. Current, verified against the
> file: `producer` is `:224`, `domain` is `:229`, `accountid` is `:232`, and
> `:214` now holds `time:`. The notes' text is otherwise unchanged and still
> accurate.]

> **Decision note (Q6 — `legacy` bucket):** the user wants deprecated `events.>` / `results.>` traffic graphed separately, trending to zero, instead of polluting the `unknown` alarm signal. `unknown` therefore means strictly "we have never seen this shape" — any non-zero `unknown` count is actionable.

---

## 4. Classification rules (ordered, deterministic)

Rules are evaluated top-to-bottom; the **first match wins**. A pure function should receive `(subject: string, envelope?: EventEnvelope, streamName?: string)` and return `{ tech, business_fn }`. Header-based DLQ detection (`X-Dlq-Reason` present) should be checked before subject-pattern DLQ detection when NATS headers are available, since the DLQ stream/subject already encodes it.

| Priority | Match (subject pattern / envelope.type / envelope.source / stream) | `tech` | `business_fn` | Evidence |
|---|---|---|---|---|
| 1 | `streamName` starts with `DLQ-` OR subject matches `dlq.<tenant>.>` OR subject == `dlq.webhook` | *(inherit from the original subject embedded after the `dlq.<tenant>.` prefix, or `unknown` if unparseable)* | `dlq` | `service-bus.md:144-145,216-235`; `channel.constants.ts:89-102`; `constants.ts:10` |
| 2 | subject matches `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` | 5th token (`<channel>`, mapped `http` → `http-generic`) | `ingress` | `channel.constants.ts:51-52`; `ingress.md:72-80` |
| 3 | subject matches `evt.*.channel-service.messaging.*.*.received.v1` | 5th token (`<channel>`, mapped `http` → `http-generic`) | `channel-processing` | `ingress.md:137-143`; `channel-service.md:45` |
| 4 | subject matches `evt.*.channel-service.messaging.*.*.{send,sent,delivered,read,failed}.v1` | 5th token (`<channel>`, mapped `http` → `http-generic`) | `channel-egress` | `channel.constants.ts:35-36`; `transport-topology.ts:20-28` |
| 5 | subject matches `evt.*.channel-service.messaging.>` (any other kind not covered above) | 5th token (`<channel>`, mapped `http` → `http-generic`) | `channel-processing` | `CHANNEL_STREAM_SUBJECTS_PATTERN`, `channel.constants.ts:8-9` (catch-all for the channel-service subject family) |
| 6 | subject matches `evt.*.ai-agent-gateway.automation.platform.internal.execution_{requested,started,completed,failed}.v1` | `platform` | `agent-execution` | `constants.ts:165-168`; `ingress.md:236-245` |
| 7 | subject matches `evt.*.agent-admin-service.automation.platform.internal.*.v1` | `platform` | `agent-admin` | `constants.ts:119-133` |
| 8 | subject matches `evt.*.agent-scheduler-service.automation.platform.internal.*.v1` | `platform` | `agent-scheduling` | `constants.ts:175-177` |
| 9 | subject matches `evt.*.agent-memory-service.agent-memory.platform.internal.memory_{proposed,published,rejected,expired}.v1` | `platform` | `agent-memory` | `AGENT_MEMORY_SUBJECT_PREFIX` and the four `AGENT_MEMORY_*` subject constants, `packages/shared/src/constants.ts:145-153`; publisher `NatsPublisher.publishEvent` (`services/agent-memory-service/src/providers/nats.provider.ts:332-337`) |
| 10 | subject matches `evt.*.registry-service.platform.*.system.*.v1` | `platform` | `registry-sync` | `platform.utils.ts:19-35` |
| 23 | subject matches `evt.*.provisioning-service.provisioning.platform.internal.{secret_written,secret_resolved,secret_access_denied}.v1` (producer `provisioning-service`, domain `provisioning`, channel `platform`, provider `internal`, kind ∈ the secrets-audit kind set) | `platform` | `secrets-audit` | Human-approved subject naming (`manual-loops/declarative-provisioning.md` T05, approved 2026-07-14). SAME producer/domain/channel/provider family as rule 22 but a DIFFERENT `business_fn` (a human decision — secrets audit is a distinct business concern from apply-run bookkeeping) — so rule 23 MUST be evaluated BEFORE rule 22 in `classify.ts`: rule 22 is kind-agnostic (matches producer+domain alone) and would otherwise swallow these three kinds under `business_fn: provisioning` instead of `secrets-audit`. Values NEVER appear in these events (SPEC.md hard rule) |
| 22 | subject matches `evt.*.provisioning-service.provisioning.platform.internal.{apply_started,resource_applied,apply_completed,apply_failed}.v1` (producer `provisioning-service`, domain `provisioning`, channel `platform`, provider `internal`) | `platform` | `provisioning` | Human-approved subject naming (`manual-loops/declarative-provisioning.md` T04, approved 2026-07-14). Kind-agnostic within the family (matches on producer+domain, same pattern as rule 19): covers the apply-run lifecycle (`apply_started`/`apply_completed`/`apply_failed`) and the per-resource action event (`resource_applied`). Evaluated BEFORE the 16/17/18 catch-alls — without a dedicated rule, `channel = "platform"` is in rule 17's whitelist so `tech` would already land on `platform`, but `business_fn` would fall to rule 17's `unknown` and alarm on every apply |
| 21 | subject matches `evt.*.connector-runtime.platform.endpoint.system.{invoke_requested,invoke_completed}.v1` (producer `connector-runtime`, domain `platform`, channel `endpoint`, provider `system`, kind ∈ the async-invoke transport pair) | `platform` | `connector-invocation` | Human-approved subject naming (`manual-loops/connector-invoke-api.md` T04, approved 2026-07-13): same 8-token family as rule 11's `endpoint_call_completed` audit event, mirroring the `ai-agent-gateway` requested/completed kind precedent (rule 6). Evaluated BEFORE rule 11 — same producer/domain/channel/provider prefix, so a kind-specific check must win first, otherwise these two kinds would fall to rule 11's broader subject-substring match and get `tech: connector` instead of the intended `tech: platform` (the invoke_requested/invoke_completed pair is transport/control-plane signaling, not the HTTP-call audit trail rule 11 covers) |
| 11 | subject contains `.connector-runtime.platform.endpoint.` (any OTHER kind in this family, e.g. `endpoint_call_completed`) | `connector` | `connector-invocation` | `envelope-parser.ts:198-204`. Also covers the T01/T02 `serviceCall` (resource `service/<name>`) and raw no-adapter (resource `raw/<host>`) branches, which reuse the SAME `connector.endpoint_call.completed.v1` kind/subject family with only the `resource` field differing (`manual-loops/connectors/connection-call-inspector.md` T01/T02, decision 7) — `classify` reads only the subject, so these classify identically to the pre-existing `adapter/<id>` resource shape, no code change required |
| 24 | subject matches `evt.*.connector-runtime.platform.mcp.system.mcp_call_completed.v1` (producer `connector-runtime`, domain `platform`, channel `mcp`, provider `system`, kind `mcp_call_completed`) | `connector` | `connector-invocation` | Human-approved subject naming (`manual-loops/connectors/connection-call-inspector.md` T03/T05, decision 7), verified in `event-publisher.ts`'s `emitMcpCall`. SAME producer as rule 11 but a DIFFERENT channel token (`mcp`, not `endpoint`), so rule 11's substring check never matches it — evaluated right after rule 11 so this family never falls through to the 16/17/18 catch-alls (channel `mcp` is not in the rule-17 `CHANNEL_WHITELIST`) |
| 25 | subject matches `evt.*.agent-ai-service.platform.llm.system.llm_call_completed.v1` (producer `agent-ai-service`, domain `platform`, channel `llm`, provider `system`, kind `llm_call_completed`) | `platform` | `llm-invocation` | Human-approved subject naming (`manual-loops/connectors/connection-call-inspector.md` T04/T05, decision 7), verified in `llm-call-event-publisher.service.ts`. Emitted ONLY for standalone (non-chat-execution) LLM calls — the job-executor `llm_call` action explicitly excludes the chat-execution path (`execution.handler.ts` never depends on this publisher), so there is no double-classification against rule 6's `execution_completed` |
| 12 | subject matches `rt.*.exec.*.{token,tool_call,tool_result,cancel}` | `runtime-stream` | `agent-runtime-streaming` | `constants.ts:198-211` |
| 13 | subject matches `platform.tenant.{provision.requested,ready,deleted}` | `tenant-lifecycle` | `tenant-provisioning` | `tenant-events.ts:33-128` |
| 14 | subject matches `audit.gateway.>` (or == `audit.gateway.request`) | `gateway-audit` | `audit` | `constants.ts:82-84` |
| 15 | subject matches `events.>` OR `results.>` (deprecated flat streams, D13) | `unknown` | `legacy` | `docs/messaging/envelope.md` §12; deprecation markers in `packages/shared/src/constants.ts` |
| 19 | subject matches `evt.*.workflow-service.workflow.*` (producer token `workflow-service` AND domain token `workflow`) — kind-agnostic, covers `execution_started`, `execution_completed`, `action_started`, `action_completed`, `condition_evaluated` and any future kind in this family | `platform` | `workflow-execution` | `buildExecutionCompletedSubject` → `evt.<tenant>.workflow-service.workflow.internal.native.execution_completed.v1`; envelope `producer: "workflow-service"` / `domain: "workflow"` (`services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts:47,151-152`). Evaluated BEFORE the catch-alls 16/17/18 (see design note). Step-event kinds added by `manual-loops/workflow-step-events.md` T01 match the SAME rule — no kind enum needed because the rule keys on producer+domain, not kind (see design note) |
| 20 | subject matches `evt.*.ai-agent-gateway.automation.platform.internal.online.v1` (producer token `ai-agent-gateway`, domain `automation`, channel `platform`, provider `internal`, kind `online`) | `platform` | `runtime-presence` | **Disposition: `counted-not-persisted`** (see §4 disposition note). Runtime-presence heartbeat published every ~15s per active tenant by `agent-ai-service`'s `HeartbeatService` (`services/agent-ai-service/src/modules/heartbeat/heartbeat.service.ts:91`). Evaluated BEFORE the catch-alls 16/17/18 (see design note), exactly like rule 19 — otherwise its `online` kind (not in rule 6's enum) would fall to rule 16 `unknown` and alarm. Producer-token drift: subject says `ai-agent-gateway`, publisher is `agent-ai-service` (`heartbeat.service.ts:91`) — analogous to `DRIFT.md` item 9; heartbeat non-canonical traits in `DRIFT.md` item 5 |
| 16 | subject matches `evt.*.*.automation.platform.internal.*.v1` (any other producer not covered by rules 6-9) | `platform` | `unknown` — flag for manual review; new internal-agent producer not yet in this taxonomy | catch-all for the `automation`/`platform`/`internal` shape defined in `docs/messaging/envelope.md` §3 examples 10.3/10.4 |
| 17 | subject matches canonical 8-token shape `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.<version>` (any other combination) | 5th token (`<channel>`, mapped `http` → `http-generic`), or `unknown` if the token is not one of `whatsapp\|instagram\|telegram\|http\|platform` | `unknown` — flag for manual review | `service-bus.md:151-167` (generic 8-token grammar, fallback for shapes not enumerated above) |
| 18 | *(fallback — no pattern above matched)* | `unknown` | `unknown` | deterministic default |

**Disposition note (`counted-not-persisted`) — introduced by rule 20:**
Most rules have an implicit disposition of *counted-and-persisted*: the ingester
classifies the event AND writes one `tracking.tracked_events` row. Rule 20 is the
FIRST rule with an explicit, different disposition — **`counted-not-persisted`**:
the event IS classified and counted (via the OTel counter
`tracking_ingester_skipped_total{family,tenant}`, Prometheus name
`tracking_ingester_skipped_total`) but NO row is inserted. This exists for
high-volume, low-value presence signals (agent-runtime heartbeats, ~4 events/min
per active tenant) that would only bloat the table while adding no analytical
value — yet must stop alarming as `unknown`. Visibility is preserved by the metric
plus a Grafana panel: a heartbeat rate dropping to 0 while a tenant is active means
the agent runtime is down. The disposition is enforced by a single source of truth
in code (`SKIP_PERSIST_RULES` in `classify.ts`), mirroring how `UNKNOWN_RULES`
encodes the alarm set — a rule number's membership there is authoritative, not a
`rule === 20` test scattered across the pipeline.

**Design notes for the implementer:**
- Rule 20 (`runtime-presence` heartbeat) MUST evaluate before the catch-alls
  16/17/18 for the same reason as rule 19: its kind `online` is not in rule 6's
  execution enum, so it would otherwise fall to rule 16 `unknown` and alarm. It is
  numbered 20 for stable identity but placed at its true evaluation position (above
  16) in the table and in `classify.ts`.
- Rule 19 is deliberately **kind-agnostic**: unlike rule 6 (`AGENT_EXECUTION_KINDS`
  enum) or rule 9 (`AGENT_MEMORY_KINDS` enum), it matches on `(producer, domain)`
  alone with no kind whitelist, because every kind ever published under
  `workflow-service`/`workflow` represents the same `workflow-execution` business
  function. This means the `workflow-step-events` queue's four new kinds
  (`execution_started`, `action_started`, `action_completed`,
  `condition_evaluated` — see `manual-loops/workflow-step-events.md` T01) require
  NO new rule and NO change to rule 19's matching logic in `classify.ts`; they were
  already reachable the moment the family's subject shape was classified. The
  golden set (§ below) still carries labeled rows for all four new kinds per golden
  rule 3, to guard against a future kind-narrowing regression that would silently
  break this design.
- **Causal contract for step events (workflow-step-events T03/T04, authoritative
  home):** `action_started`, `action_completed`, and `condition_evaluated` are
  SIBLING hops off the run's `execution_started` event — `causation_id` is
  ALWAYS the run's `execution_started` envelope id, NEVER the preceding step
  event (e.g. `action_completed` does not chain off its matching
  `action_started`, and `condition_evaluated` does not chain off the preceding
  action's `action_completed`). `transport.depth` is therefore CONSTANT across
  every step event of a run, equal to `execution_started.depth + 1`, regardless
  of `action_index` or how many actions/conditions precede it. This is
  deliberate: a chained step-to-step design would grow depth linearly with
  action count and exceed `MAX_DEPTH_BY_CATEGORY.internal_service` (ceiling 5,
  `envelope.utils.ts`) for any workflow with more than a handful of actions,
  which the sibling design avoids entirely. `golden/labeled.tsv` rows
  seq1312-1319 and the `fixtures/bus-events/workflow-service-*-envelope-01.json`
  fixtures encode this contract; the `golden/raw` synthetic events for those
  rows and the fixtures must stay consistent with it.
- Rules 2–5 rely on the literal 8-token subject grammar (`docs/messaging/envelope.md` §3), so they should be implemented as fixed-position token checks (split on `.`, check tokens 3–4 and the `<kind>` token), not full-string regex, to survive tenant-name variability.
- Rule 1 (DLQ) must run first because a DLQ subject *embeds* the original subject as a suffix (`dlq.<tenant>.evt.<tenant>...`) — a naive later-priority match would otherwise mis-tag DLQ'd channel/platform events with `channel-processing`/`agent-admin` instead of `dlq`.
- Rule 9 (agent-memory) matches on the subject's domain token `agent-memory` — do NOT classify by `envelope.domain`, which is `"automation"` for these events (subject/envelope mismatch, see §3 Q3 decision note and `DRIFT.md` #9).
- The `http` → `http-generic` mapping (Q5) is applied wherever the 5th subject token is read; it is a presentation-layer rename only.
- **Numbering vs evaluation order:** the first column is a *stable rule identity*, not always its evaluation priority. Evaluation follows the table's top-to-bottom row order (first match wins), so a rule added after the original `1–18` set keeps a higher identity number but is placed in the table at its true evaluation position. Rule 19 (`workflow-service`) was added later and is numbered 19 for identity, but it MUST evaluate before the catch-alls 16/17/18 — otherwise it would be unreachable — so it appears above them here and is implemented before them in `classify.ts`.
- Rule 22 (`provisioning-service` apply-engine audit trail, `manual-loops/declarative-provisioning.md` T04) is numbered 22 for identity but is placed and evaluated BEFORE the 16/17/18 catch-alls (same placement pattern as rules 19/20/21) — its `channel` token is the literal `platform`, which rule 17's channel whitelist already recognizes, so without a dedicated rule these four kinds would still get `tech: platform` by accident but `business_fn: unknown` via rule 17, alarming on every manifest apply.
- Rule 23 (`provisioning-service` secrets audit trail, `manual-loops/declarative-provisioning.md` T05) is numbered 23 for identity but MUST be evaluated BEFORE rule 22 in `classify.ts` — both rules match the SAME producer/domain/channel/provider prefix (`provisioning-service`/`provisioning`/`platform`/`internal`), and rule 22 is deliberately kind-agnostic, so a kind-specific check for the three secrets-audit kinds must win first or they would silently get `business_fn: provisioning` instead of the human-approved `secrets-audit`.
- Rule 21 (`connector-runtime` async invoke transport pair, `manual-loops/connector-invoke-api.md` T04) is numbered 21 for identity but MUST evaluate BEFORE rule 11 in `classify.ts` — both rules match the same `.connector-runtime.platform.endpoint.` subject family, and rule 11's check is a broad subject-substring match with no kind whitelist, so it would otherwise shadow rule 21 for the `invoke_requested`/`invoke_completed` kinds and mis-tag them `tech: connector` instead of `tech: platform`. This mirrors rules 19/20's placement pattern above the older catch-alls: newer, more specific rules are added later (higher identity number) but placed ahead of the broader rule they'd otherwise be swallowed by.

---

## 5. `consumed_by` facet (multi-value)

> **Verification note (T07, 2026-07-30):** the durable names in parentheses
> below were corrected against the declaring services. `transport-topology.ts`
> (`:15`, `:20`, `:26`) still names the audit durable `channel-events-audit`,
> but the durable actually declared by audit-service is `channel-audit`
> (`services/audit-service/src/modules/channel-audit/channel-audit.service.ts:49`).
> The registry is the stale side — recorded as a T07 finding, not corrected
> here (no source changes in this loop).
>
> **Code fixed 2026-07-31 (envelope-drift T03):** `transport-topology.ts`
> (`:16`, `:21`, `:27`) now names the audit sink `channel-audit`, matching
> `channel-audit.service.ts:49`. The stale name is gone from `services/`
> (registry, its spec, `assemble-trace.spec.ts`, the trace README and the
> `consumed-by.ts` comments), and the corrected names are pinned with their
> declaring `file:line` in
> `services/admin-console/src/app/features/processes/trace/domain/__tests__/transport-topology.spec.ts`.
> The other two registry durables were swept in the same task and were already
> correct: `workflow-triggers` (`trigger-consumer.service.ts:45`) and
> `channel-egress` (`send-command-consumer.service.ts:38`).

> **Decision note (Q1 continued):** `consumed_by` is a separate multi-value column (Postgres `text[]`), NOT part of `business_fn`. It records which durable consumers read a given subject family. Values are grounded in the durable-consumer registry (`transport-topology.ts`) plus the durable inventory in `docs/messaging/service-bus.md:214` and per-service consumer code.

| Subject family | `consumed_by` values | Evidence |
|---|---|---|
| `evt.*.channel-service.messaging.*.*.received.v1` | `workflow-service` (durable `workflow-triggers`), `audit-service` (durable `channel-audit`), `usage-aggregator-service` (durable `agg-INGRESS`), `agent-ai-service` (durable `agent-ai-service-consumer`) | `transport-topology.ts:14-17`; `channel-audit.service.ts:49`; `usage-aggregator-service/src/config.ts:46-48`; `envelope-parser.ts` |
| `evt.*.channel-service.messaging.*.*.send.v1` | `channel-service` (durable `channel-egress`), `audit-service` (durable `channel-audit`) | `transport-topology.ts:19-22`; `send-command-consumer.service.ts:38`; `channel-audit.service.ts:49` |
| `evt.*.channel-service.messaging.*.*.sent.v1` (and `delivered`/`read`/`failed`) | `audit-service` (durable `channel-audit`), `usage-aggregator-service` (durable `agg-INGRESS`) | `transport-topology.ts:26-28`; `channel-audit.service.ts:49`; `envelope-parser.ts` `KIND_TO_DIRECTION` |
| `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` | `channel-service` (durable `channel-webhook-ingress`) | `docs/messaging/ingress.md:97-107` |
| `evt.*.registry-service.platform.service.system.*.v1` | `connector-admin` (durable `adapter-internal-sync`) | `internal-sync.service.ts:109-155` |
| `evt.*.{agent-admin-service,ai-agent-gateway}.automation.platform.internal.*.v1` | `agent-ai-service` (durable `agent-ai-service-consumer` via `MessageRouterService`), `agent-admin-service` (durable `skb-ingestion-worker` for SKB subjects) | `docs/messaging/ingress.md:241`; `service-bus.md:214,310` |
| `dlq.<tenant>.>` | `usage-aggregator-service` | `service-bus.md:93` |
| `audit.gateway.>` | `audit-service` (durable `gateway-audit-writer`) | `constants.ts:84` |
| `platform.tenant.provision.requested` | `tenant-service` (durable `tenant-provisioner`) | `tenant-events.ts:42` |

The full durable inventory is listed in `DOCS/messaging/service-bus.md` ("Durable names, as declared in code"). Note that the persisted `consumed_by` values are SERVICE names, not durable names (`services/tracking-ingester-service/src/lib/consumed-by.ts:33-38`); the durables in parentheses above are evidence annotations only. The ingester should treat this table as the seed mapping and keep it updatable without a schema change (hence `text[]`).

---

## 6. `is_claim_check` facet (boolean)

> **Decision note (Q2 — transport concern, not classification):** claim-check is a transport detail, not a business classification. The ingester adds a boolean column `is_claim_check` alongside `tech`/`business_fn` — it is NOT a value of either dimension. A slim envelope keeps the `tech` and `business_fn` of the channel event that originated it.

Detection: `envelope.data.payload_inline === false` (with `payload_ref` populated and `payload: null`) — see `docs/messaging/claim-check.md` §5-7 and `packages/database/src/claim-check.ts` (`looksLikeClaimCheck` / `resolveClaimCheckEnvelope`).

---

## 7. Resolved decisions (2026-07-09)

All 7 open questions from the draft were answered by the user. One line each, with rationale:

1. **Q1 — usage-aggregation:** `business_fn` = producer intent only, pure function of payload/subject; consumer roles go in the new `consumed_by text[]` facet (§5). *Rationale: keeps the classifier deterministic and separates "what happened" from "who read it".*
2. **Q2 — claim-check:** boolean column `is_claim_check` (§6), not a classification value; slim events keep the originating event's `tech`/`business_fn`. *Rationale: transport concern, orthogonal to classification.*
3. **Q3 — agent-memory:** subject shape VERIFIED in publisher code (`AGENT_MEMORY_SUBJECT_PREFIX`, now `packages/shared/src/constants.ts:145-153`); dedicated `business_fn: agent-memory` and rule 9 added. The local-only constants and the subject/envelope `domain` mismatch recorded in `DRIFT.md` #9 were both fixed on 2026-07-31 (envelope-drift T08). *Rationale: never guess subjects — ground every rule in code.*
4. **Q4 — audit two-tier:** confirmed; per-tenant channel events consumed by audit-service keep their messaging `business_fn` (rules 2-5 unchanged); only `GATEWAY_AUDIT`-origin events get `business_fn: audit` (rule 14). *Rationale: direct consequence of the Q1 producer-intent rule.*
5. **Q5 — http naming:** public `tech` value renamed to `http-generic`; source-code `Channel = "http"` untouched; mapping documented in §2. *Rationale: avoid collision with wire-protocol terminology in Grafana.*
6. **Q6 — legacy subjects:** explicit `business_fn: legacy` bucket for `events.>` / `results.>` traffic (rule 15); `unknown` reserved exclusively for unrecognized traffic. *Rationale: graph legacy trending to zero separately from genuine surprises — `unknown` is the alarm.*
7. **Q7 — agent-ingress:** confirmed; no pre-provisioned rules for unimplemented agent-ingress subjects — they will surface as `unknown` and rules get added against the real subject when implemented. *Rationale: rules must always match shipped code, never designs.*

### Phase-0 open decisions — resolved (2026-07-10)

2. **Open decision #2 — `online.v1` heartbeats (RESOLVED 2026-07-10):** the family `evt.*.ai-agent-gateway.automation.platform.internal.online.v1` (published every ~15s per active tenant by `agent-ai-service`'s `HeartbeatService`, `services/agent-ai-service/src/modules/heartbeat/heartbeat.service.ts:91`) previously fell through to the rule-16 catch-all as `platform`/`unknown` and alarmed, because its kind `online` is not in rule 6's execution enum. The user added **rule 20** → `tech: platform`, `business_fn: runtime-presence`, evaluated before the 16/17/18 catch-alls, with disposition **`counted-not-persisted`**. *Rationale:* these are runtime-presence signals, not business traffic — they have no durable consumer and would add ~4 events/min/tenant of pure table bloat with no analytical value. Persisting them buys nothing; dropping them silently would hide an outage. So they are counted (OTel counter `tracking_ingester_skipped_total{family,tenant}`) and surfaced on a Grafana panel — a heartbeat rate → 0 while a tenant is active means the agent runtime is down — but no row is written. Known **producer-token drift**: the subject's producer token is `ai-agent-gateway` while the actual publisher is `agent-ai-service` (`heartbeat.service.ts:91`) — tracked as `DRIFT.md` item 10 (a dedicated numbered item added 2026-07-10), directly analogous to the agent-memory `envelope.producer` drift in `DRIFT.md` item 9, and the heartbeat family's other non-canonical traits are recorded in `DRIFT.md` item 5 + its trailing note. Classification is subject-driven and unaffected, but attribution by `envelope.producer` would misattribute. The 24 affected golden rows (seq 1249, 1255, 1256, 1267, 1288–1307) were relabeled from rule 16 `platform/unknown` to rule 20 `platform/runtime-presence`.
1. **Open decision #1 — `workflow-service` execution family (RESOLVED 2026-07-10):** the family `evt.*.workflow-service.workflow.*` (verified live as `evt.acme.workflow-service.workflow.internal.native.execution_completed.v1`) previously fell through to rule 17 as `unknown/unknown` because its 5th token `internal` is not in the channel whitelist. The user added **rule 19** → `tech: platform`, `business_fn: workflow-execution`, evaluated before the 16/17/18 catch-alls. *Rationale:* (a) `tech = platform` for consistency with the `agent-*` family and §2 — `tech` derives from the subject token, not the runtime, so Temporal is an implementation detail that never appears in the subject or envelope; (b) `business_fn = workflow-execution` grounded in the Phase-0-verified publisher `services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts` (`producer: "workflow-service"`, `domain: "workflow"`). The 8 affected golden rows (seq 1247, 1253, 1261, 1265, 1272, 1276, 1281, 1286) were relabeled from rule 17 `unknown/unknown` to rule 19 `platform/workflow-execution`.

### Declarative-provisioning secrets audit trail — added 2026-07-14 (`manual-loops/declarative-provisioning.md` T05)

**Rule 23 added (golden rule 3: rule + golden + classifier land together, WITH the emitter — same pattern as rule 22):** the T05 secrets CRUD API + broker publish three kinds on the SAME subject family rule 22 already recognizes (`provisioning-service`/`provisioning`/`platform`/`internal`): `secret_written` (a `PUT /secrets/:name` write: secret name, scope kind/owner), `secret_resolved` (a broker resolve GRANTED: secret name, scope, consumer service), `secret_access_denied` (a broker resolve DENIED: secret name, scope, consumer service, reason — never a value). Human-approved subject naming (2026-07-14): `evt.<tenant>.provisioning-service.provisioning.platform.internal.{secret_written,secret_resolved,secret_access_denied}.v1`. `business_fn: secrets-audit` is a NEW value, kept SEPARATE from T04's `provisioning` (human decision — secrets audit is a distinct business concern: who accessed which credential, not apply-run bookkeeping). Because rule 22 is kind-agnostic (matches producer+domain alone), rule 23 MUST be evaluated BEFORE it in `classify.ts`, or these three kinds would silently land on `business_fn: provisioning` instead.

**Causal design (documented per SPEC.md's "document the choice consistent with what the emitter actually does"):** `secret_written` is its OWN root — `PUT /secrets/:name` is an operator/admin action, not a step inside an existing apply-run chain, so it gets a fresh generated id used as both its own envelope id and its `correlation_id`, `causation_id: null`, depth 0 (same standalone-root shape as `apply_started`). `secret_resolved`/`secret_access_denied` are SIBLING hops off the caller-supplied `correlationId` (e.g. the apply run that needed the secret): `causation_id` is set to that SAME `correlationId` — mirroring this codebase's convention that a chain root's own envelope id equals its `correlation_id` (see rule 22's `apply_started`) — and depth is 1, exactly like `resource_applied`'s sibling hop off `apply_started`.

Three synthetic golden rows (seq 1327-1329, `golden/labeled.tsv` + matching `golden/raw/*.json`) cover all three kinds: seq1327 is a standalone `secret_written` root; seq1328 is a `secret_resolved` sibling reusing an existing apply-run correlation id (demonstrating the broker resolving mid-apply); seq1329 is a `secret_access_denied` sibling under its own fresh correlation (a denied resolve attempt). All three classify as rule 23 `platform`/`secrets-audit`. See `TAXONOMY.md` §4 rule 23 design note above.

### Declarative-provisioning apply engine — added 2026-07-14 (`manual-loops/declarative-provisioning.md` T04)

**Rule 22 added (golden rule 3: rule + golden + classifier land together, ahead of/with the emitter — same pattern as rules 19 and 21):** the NEW `provisioning-service`'s apply engine (T04) publishes four kinds on a NEW subject family: `apply_started` (run start: manifest name, revision, resource count), `resource_applied` (per-resource action: kind, name, verdict `create`/`update`, downstream id), `apply_completed` (run summary: applied/noop counts, duration), `apply_failed` (failed resource + applied-so-far). Human-approved subject naming (2026-07-14): `evt.<tenant>.provisioning-service.provisioning.platform.internal.<kind>.v1`; producer `provisioning-service`, domain `provisioning`, channel `platform`, provider `internal`. `business_fn: provisioning` is a NEW value (§3); `tech: platform` follows §2 (channel token is the literal `platform` placeholder, same convention as the `agent-*`/`workflow-service` platform families). Rule 22 is kind-agnostic (matches on producer+domain, same design as rule 19) and evaluated BEFORE the 16/17/18 catch-alls: rule 17's channel whitelist already contains `platform`, so without rule 22 these events would silently get the right `tech` but the wrong `business_fn` (`unknown`, alarming on every apply). Five synthetic golden rows (seq 1322-1326, two correlation chains — a successful 3-event run and a failed 2-event run, `golden/labeled.tsv` + matching `golden/raw/*.json`) cover all four kinds, landed WITH the emitter in this same task (not ahead of it, since T04 ships the publisher too), following the exact addendum pattern documented in `golden/README.md`'s synthetic-rows section.

### Connector-invoke async transport pair — added 2026-07-13 (`manual-loops/connector-invoke-api.md` T04)

**Rule 21 added (golden rule 3: rule + golden + classifier land together, ahead of the emitter — same pattern as rule 19's workflow-step-events T01 addendum):** the async invoke facade (T04) publishes two new kinds on the EXISTING `connector-runtime`/`platform`/`endpoint`/`system` subject family that rule 11 already recognizes: `invoke_requested` (client → connector-runtime, publish-time) and `invoke_completed` (connector-runtime → client, T05 — not implemented yet). Human-approved subject naming (2026-07-13): `evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_requested.v1` / `...invoke_completed.v1`, mirroring the `ai-agent-gateway` execution_requested/execution_completed kind precedent (rule 6). Without a dedicated rule these two kinds would still match rule 11's broad `.connector-runtime.platform.endpoint.` substring check and get `tech: connector`/`business_fn: connector-invocation` — the SAME `business_fn` this decision keeps, but the WRONG `tech`: rule 21 asserts `tech: platform` because `invoke_requested`/`invoke_completed` are transport/control-plane signaling (analogous to the `ai-agent-gateway` execution lifecycle, rule 6's `tech: platform`), not the HTTP-call audit trail (`endpoint_call_completed`, resolved URL/status/duration/cache fields) rule 11 was built for. Rule 21 is evaluated BEFORE rule 11 (same placement pattern as rules 19/20 ahead of their broader catch-alls) so the two invoke-transport kinds are never shadowed. Two synthetic golden rows (seq 1320-1321, `golden/labeled.tsv` + matching `golden/raw/*.json`) cover `invoke_requested` and `invoke_completed` ahead of the T05 emitter, following the exact addendum pattern documented in `golden/README.md`'s "workflow-step-events T01 synthetic rows" section.
