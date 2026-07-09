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
| `runtime-stream` | Ephemeral per-execution token/tool-call streaming, deliberately outside the `evt.` taxonomy | `RUNTIME_STREAM_SUBJECT_PREFIX = "rt.{tenant}.exec.{executionId}"` (`packages/shared/src/constants.ts:139`); subject family `rt.<tenant>.exec.<executionId>.<kind>` |
| `connector` | Third-party/internal HTTP adapter call events (connector-runtime endpoint invocations) | `CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint."` (`services/usage-aggregator-service/.../envelope-parser.ts:204`) |
| `tenant-lifecycle` | Tenant provisioning/ready/deletion control-plane messages (Core NATS + `PLATFORM_TENANTS`) | `platform.tenant.provision.requested` / `platform.tenant.ready` / `platform.tenant.deleted` (`packages/shared/src/tenant-events.ts:33-128`) |
| `gateway-audit` | Cross-tenant API-gateway request audit trail (not part of the tenant `evt.` taxonomy) | `GATEWAY_AUDIT_STREAM_SUBJECTS = ["audit.gateway.>"]`, `GATEWAY_AUDIT_SUBJECT = "audit.gateway.request"` (`packages/shared/src/constants.ts:82-83`) |
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
| `agent-execution` | AI agent execution lifecycle (request/start/complete/fail) orchestrated by `ai-agent-gateway` | `PLATFORM_EXECUTION_REQUESTED/STARTED/COMPLETED/FAILED`, prefix `evt.{tenant}.ai-agent-gateway.automation.platform.internal` (`packages/shared/src/constants.ts:109-114`); event types `io.yoizen.platform.runtime.execution_requested.v1` / `execution_completed.v1` |
| `agent-admin` | Agent publish/config lifecycle managed by `agent-admin-service` (config sync, job trigger, agent published/unpublished, chat respond, SKB ingestion) | `PLATFORM_SUBJECT_PREFIX = "evt.{tenant}.agent-admin-service.automation.platform.internal"` and its `config_sync`/`jobs_sync`/`job_trigger`/`chat_respond`/`agent_published`/`agent_unpublished`/`document_ingestion`/`skb_file_ingestion` subjects (`packages/shared/src/constants.ts:93-107`) |
| `agent-scheduling` | Scheduled/cron agent job heartbeat and triggering | `SCHEDULER_SUBJECT_PREFIX = "evt.{tenant}.agent-scheduler-service.automation.platform.internal"`, `PLATFORM_SCHEDULER_HEARTBEAT` (`packages/shared/src/constants.ts:116-118`); `services/agent-scheduler-service/src/modules/heartbeat/heartbeat.service.ts` |
| `agent-memory` | Agent memory lifecycle (proposed/published/rejected/expired) emitted by `agent-memory-service` | Subject prefix `AGENT_MEMORY_SUBJECT_PREFIX = "evt.{tenant}.agent-memory-service.agent-memory.platform.internal"` with kinds `memory_proposed`/`memory_published`/`memory_rejected`/`memory_expired` (`services/agent-memory-service/src/providers/nats.provider.ts:64-74`); published via `NatsPublisher.publishEvent` → `buildPlatformSubject` (`nats.provider.ts:319-324`); event types `io.yoizen.agent-memory.memory.*.v1` (`nats.provider.ts:57-62`) |
| `agent-runtime-streaming` | Ephemeral per-execution token/tool-call/cancel streaming (not persisted, not part of `evt.` taxonomy) | `RUNTIME_TOKEN/TOOL_CALL/TOOL_RESULT/CANCEL`, `RUNTIME_STREAM_SUBJECT_PREFIX` (`packages/shared/src/constants.ts:139-157`) |
| `connector-invocation` | HTTP adapter/connector call events (status, duration, cache result) emitted by `connector-runtime` | `CONNECTOR_SUBJECT_MARKER = ".connector-runtime.platform.endpoint."`, fields `adapterId/endpointId/status/durationMs/cacheResult` (`services/usage-aggregator-service/.../envelope-parser.ts:198-302`) |
| `registry-sync` | Service registry lifecycle (Knative service upserted/deleted) consumed by `connector-admin`'s internal-sync durable | `buildRegistryPlatformSubject`, `SERVICE_UPSERTED_EVENT_TYPE`/`SERVICE_DELETED_EVENT_TYPE` (`packages/shared/src/platform.utils.ts:19-69`); durable `adapter-internal-sync` (`services/connector-admin/src/modules/internal-sync/internal-sync.service.ts:109-155`) |
| `tenant-provisioning` | Tenant creation/readiness/deletion control-plane workflow | `platform.tenant.provision.requested` (durable `tenant-provisioner`), `platform.tenant.ready`, `platform.tenant.deleted` (`packages/shared/src/tenant-events.ts:39-128`) |
| `audit` | Events ORIGINATING in the cross-tenant `GATEWAY_AUDIT` stream only. Per-tenant channel events that `audit-service` merely reads keep their messaging `business_fn` (see Q4 decision note below). | `audit.gateway.>` / `audit.gateway.request` (`packages/shared/src/constants.ts:82-83`); durable `gateway-audit-writer` (`GATEWAY_AUDIT_CONSUMER_NAME`) |
| `dlq` | Dead-lettered message (delivery exhausted, claim-check failure, depth exceeded, etc.) | `dlq.<tenant>.>` / `dlq.webhook`; `X-Dlq-Reason`/`X-Dlq-Stage` headers (`docs/messaging/service-bus.md:216-235`); `buildDlqSubjectPattern`/`buildDlqMessageSubject` (`channel.constants.ts:89-102`) |
| `legacy` | Surviving traffic on the deprecated flat `EVENTS` (`events.>`) / `RESULTS` (`results.>`) streams (D13 deprecation) | `docs/messaging/envelope.md` §12 (D13); deprecation markers in `packages/shared/src/constants.ts` |
| `unknown` | Fallback — subject/envelope does not match any known business-function pattern. Reserved EXCLUSIVELY for unrecognized traffic — it is the alarm, never a catch-all for known-but-deprecated families. | n/a (deterministic fallback, see §4) |

> **Decision note (Q4 — audit two-tier confirmed):** `audit-service` plays two roles. (a) Its `channel-events-audit` durable reads per-tenant `received`/`send`/`sent` events — those events KEEP their messaging `business_fn` (rules 2-5), and audit-service appears in their `consumed_by`. (b) Events on the cross-tenant `GATEWAY_AUDIT` stream get `business_fn: audit` (rule 13). This follows directly from the Q1 producer-intent rule: reading an event for audit purposes does not change what the event represents.

> **Decision note (Q3 — `agent-memory` added after code verification):** the subject shape was verified in the publisher code, not guessed. `services/agent-memory-service/src/providers/nats.provider.ts` defines `AGENT_MEMORY_SUBJECT_PREFIX` (line 64) and publishes through `NatsPublisher.publishEvent` (line 319) using the shared `buildPlatformSubject` helper. Caveat for implementers: this subject family's 4th token (domain) is `agent-memory`, NOT `automation` — while the envelope body sets `domain: "automation"` (via `PLATFORM_DOMAIN`, `nats.provider.ts:214`). Classify by SUBJECT (rule 9 below), not by `envelope.domain`. Note also the subject constants live locally in the service, not in `packages/shared/src/constants.ts` like every other internal producer's prefix — recorded as drift in `DRIFT.md` (discrepancy #9).

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
| 6 | subject matches `evt.*.ai-agent-gateway.automation.platform.internal.execution_{requested,started,completed,failed}.v1` | `platform` | `agent-execution` | `constants.ts:109-114`; `ingress.md:236-245` |
| 7 | subject matches `evt.*.agent-admin-service.automation.platform.internal.*.v1` | `platform` | `agent-admin` | `constants.ts:93-107` |
| 8 | subject matches `evt.*.agent-scheduler-service.automation.platform.internal.*.v1` | `platform` | `agent-scheduling` | `constants.ts:116-118` |
| 9 | subject matches `evt.*.agent-memory-service.agent-memory.platform.internal.memory_{proposed,published,rejected,expired}.v1` | `platform` | `agent-memory` | `AGENT_MEMORY_SUBJECT_PREFIX` and the four `AGENT_MEMORY_*` subject constants, `services/agent-memory-service/src/providers/nats.provider.ts:64-74`; publisher `NatsPublisher.publishEvent` (`nats.provider.ts:319-324`) |
| 10 | subject matches `evt.*.registry-service.platform.*.system.*.v1` | `platform` | `registry-sync` | `platform.utils.ts:19-35` |
| 11 | subject contains `.connector-runtime.platform.endpoint.` | `connector` | `connector-invocation` | `envelope-parser.ts:198-204` |
| 12 | subject matches `rt.*.exec.*.{token,tool_call,tool_result,cancel}` | `runtime-stream` | `agent-runtime-streaming` | `constants.ts:139-157` |
| 13 | subject matches `platform.tenant.{provision.requested,ready,deleted}` | `tenant-lifecycle` | `tenant-provisioning` | `tenant-events.ts:33-128` |
| 14 | subject matches `audit.gateway.>` (or == `audit.gateway.request`) | `gateway-audit` | `audit` | `constants.ts:82-83` |
| 15 | subject matches `events.>` OR `results.>` (deprecated flat streams, D13) | `unknown` | `legacy` | `docs/messaging/envelope.md` §12; deprecation markers in `packages/shared/src/constants.ts` |
| 16 | subject matches `evt.*.*.automation.platform.internal.*.v1` (any other producer not covered by rules 6-9) | `platform` | `unknown` — flag for manual review; new internal-agent producer not yet in this taxonomy | catch-all for the `automation`/`platform`/`internal` shape defined in `docs/messaging/envelope.md` §3 examples 10.3/10.4 |
| 17 | subject matches canonical 8-token shape `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.<version>` (any other combination) | 5th token (`<channel>`, mapped `http` → `http-generic`), or `unknown` if the token is not one of `whatsapp\|instagram\|telegram\|http\|platform` | `unknown` — flag for manual review | `service-bus.md:151-167` (generic 8-token grammar, fallback for shapes not enumerated above) |
| 18 | *(fallback — no pattern above matched)* | `unknown` | `unknown` | deterministic default |

**Design notes for the implementer:**
- Rules 2–5 rely on the literal 8-token subject grammar (`docs/messaging/envelope.md` §3), so they should be implemented as fixed-position token checks (split on `.`, check tokens 3–4 and the `<kind>` token), not full-string regex, to survive tenant-name variability.
- Rule 1 (DLQ) must run first because a DLQ subject *embeds* the original subject as a suffix (`dlq.<tenant>.evt.<tenant>...`) — a naive later-priority match would otherwise mis-tag DLQ'd channel/platform events with `channel-processing`/`agent-admin` instead of `dlq`.
- Rule 9 (agent-memory) matches on the subject's domain token `agent-memory` — do NOT classify by `envelope.domain`, which is `"automation"` for these events (subject/envelope mismatch, see §3 Q3 decision note and `DRIFT.md` #9).
- The `http` → `http-generic` mapping (Q5) is applied wherever the 5th subject token is read; it is a presentation-layer rename only.

---

## 5. `consumed_by` facet (multi-value)

> **Decision note (Q1 continued):** `consumed_by` is a separate multi-value column (Postgres `text[]`), NOT part of `business_fn`. It records which durable consumers read a given subject family. Values are grounded in the durable-consumer registry (`transport-topology.ts`) plus the durable inventory in `docs/messaging/service-bus.md:214` and per-service consumer code.

| Subject family | `consumed_by` values | Evidence |
|---|---|---|
| `evt.*.channel-service.messaging.*.*.received.v1` | `workflow-service` (durable `workflow-triggers`), `audit-service` (durable `channel-events-audit`), `usage-aggregator-service` (durable `usage-aggregator-service`), `agent-ai-service` (durable `agent-ai-service-consumer`) | `transport-topology.ts:14-17`; `service-bus.md:214`; `envelope-parser.ts` |
| `evt.*.channel-service.messaging.*.*.send.v1` | `channel-service` (durable `channel-egress`), `audit-service` (`channel-events-audit`) | `transport-topology.ts:19-22` |
| `evt.*.channel-service.messaging.*.*.sent.v1` (and `delivered`/`read`/`failed`) | `audit-service` (`channel-events-audit`), `usage-aggregator-service` | `transport-topology.ts:26-28`; `envelope-parser.ts` `KIND_TO_DIRECTION` |
| `evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` | `channel-service` (durable `channel-webhook-ingress`) | `docs/messaging/ingress.md:97-107` |
| `evt.*.registry-service.platform.service.system.*.v1` | `connector-admin` (durable `adapter-internal-sync`) | `internal-sync.service.ts:109-155` |
| `evt.*.{agent-admin-service,ai-agent-gateway}.automation.platform.internal.*.v1` | `agent-ai-service` (durable `agent-ai-service-consumer` via `MessageRouterService`), `agent-admin-service` (durable `skb-ingestion-worker` for SKB subjects) | `docs/messaging/ingress.md:241`; `service-bus.md:214,310` |
| `dlq.<tenant>.>` | `usage-aggregator-service` | `service-bus.md:93` |
| `audit.gateway.>` | `audit-service` (durable `gateway-audit-writer`) | `constants.ts:84` |
| `platform.tenant.provision.requested` | `tenant-service` (durable `tenant-provisioner`) | `tenant-events.ts:42` |

The full durable inventory (`audit-service`, `channel-service`, `connector-admin`, `usage-aggregator-service`, `workflow-triggers`, `agent-ai-service-consumer`, `skb-ingestion-worker`) is listed in `docs/messaging/service-bus.md:214`. The ingester should treat this table as the seed mapping and keep it updatable without a schema change (hence `text[]`).

---

## 6. `is_claim_check` facet (boolean)

> **Decision note (Q2 — transport concern, not classification):** claim-check is a transport detail, not a business classification. The ingester adds a boolean column `is_claim_check` alongside `tech`/`business_fn` — it is NOT a value of either dimension. A slim envelope keeps the `tech` and `business_fn` of the channel event that originated it.

Detection: `envelope.data.payload_inline === false` (with `payload_ref` populated and `payload: null`) — see `docs/messaging/claim-check.md` §5-7 and `packages/database/src/claim-check.ts` (`looksLikeClaimCheck` / `resolveClaimCheckEnvelope`).

---

## 7. Resolved decisions (2026-07-09)

All 7 open questions from the draft were answered by the user. One line each, with rationale:

1. **Q1 — usage-aggregation:** `business_fn` = producer intent only, pure function of payload/subject; consumer roles go in the new `consumed_by text[]` facet (§5). *Rationale: keeps the classifier deterministic and separates "what happened" from "who read it".*
2. **Q2 — claim-check:** boolean column `is_claim_check` (§6), not a classification value; slim events keep the originating event's `tech`/`business_fn`. *Rationale: transport concern, orthogonal to classification.*
3. **Q3 — agent-memory:** subject shape VERIFIED in publisher code (`AGENT_MEMORY_SUBJECT_PREFIX`, `services/agent-memory-service/src/providers/nats.provider.ts:64-74`); dedicated `business_fn: agent-memory` and rule 9 added. Local-only subject constants (missing from `packages/shared/src/constants.ts`) and the subject/envelope `domain` mismatch recorded in `DRIFT.md` #9. *Rationale: never guess subjects — ground every rule in code.*
4. **Q4 — audit two-tier:** confirmed; per-tenant channel events consumed by audit-service keep their messaging `business_fn` (rules 2-5 unchanged); only `GATEWAY_AUDIT`-origin events get `business_fn: audit` (rule 14). *Rationale: direct consequence of the Q1 producer-intent rule.*
5. **Q5 — http naming:** public `tech` value renamed to `http-generic`; source-code `Channel = "http"` untouched; mapping documented in §2. *Rationale: avoid collision with wire-protocol terminology in Grafana.*
6. **Q6 — legacy subjects:** explicit `business_fn: legacy` bucket for `events.>` / `results.>` traffic (rule 15); `unknown` reserved exclusively for unrecognized traffic. *Rationale: graph legacy trending to zero separately from genuine surprises — `unknown` is the alarm.*
7. **Q7 — agent-ingress:** confirmed; no pre-provisioned rules for unimplemented agent-ingress subjects — they will surface as `unknown` and rules get added against the real subject when implemented. *Rationale: rules must always match shipped code, never designs.*
