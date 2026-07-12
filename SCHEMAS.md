# SCHEMAS.md — NATS Bus Envelope & Event Schema Inventory

**Phase 0 of the message-tracking-system effort — READ-ONLY analysis.**
Generated: 2026-07-09. Method: codegraph MCP tools (`codegraph_search`, `codegraph_explore`,
`codegraph_callers`, `codegraph_node`) as primary exploration, with `Read` used only for
non-code reference material (`docs/messaging/envelope.md`, the informational JSON Schema
asset). No schema was created, copied, or modified as part of producing this document.

---

## 1. Envelope core (`packages/shared`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `EventEnvelope` | `packages/shared/src/interfaces.ts:29` | Full envelope — every mandatory header field (§2.1 of envelope.md) plus optional pipeline extensions (`callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`) | 44+ callers across `packages/database/src/claim-check.ts`, `packages/shared/src/envelope.utils.ts`, `packages/shared/src/webhook.interfaces.ts`, `services/agent-ai-service/.../job-executor.service.ts`, `services/connector-admin/.../internal-sync.service.ts`, etc. | TS interface (compile-time only) |
| `EventTransport` | `packages/shared/src/interfaces.ts:13` | Envelope `transport` object — `method`, `protocol`, `agent_id`, `depth` | `EventEnvelope`, `envelope.utils.ts`, `nats.provider.ts` (agent-memory-service, agent-admin-service) | TS interface (compile-time only) |
| `EventData` | `packages/shared/src/interfaces.ts:20` | Envelope `data` object — `received_at`, `payload_inline`, `payload_ref`, `payload_bytes`, `payload_checksum`, `payload` | `EventEnvelope`, `IWebhookIngressData` (extends it), `nats.provider.ts` | TS interface (compile-time only) |
| `JsonValue` | `packages/shared/src/interfaces.ts:5` | Recursive JSON-safe value type used for envelope/payload fields | `tenant-events.ts`, `tenant.dto.ts`, `envelope.factory.ts` | TS type alias |
| `isCompliantEnvelope` | `packages/shared/src/envelope.utils.ts:354` | Shallow runtime check that every mandatory top-level field of `EventEnvelope` is present with the right primitive `typeof` (does **not** validate `transport`/`data` sub-shapes deeply) | `isClaimCheckEnvelope` (claim-check.ts:175), `wrapHandler` (multi-tenant-consumer-manager.ts:330) | Hand-written type guard (runtime, shallow) |
| `deriveEnvelope` | `packages/shared/src/envelope.utils.ts:163` | Builds a derived envelope from an incoming one; enforces `MAX_DEPTH_BY_CATEGORY` at construction time | `publishStatus` (agent-ai-service job-executor), others | Factory function (construction-time validation only) |
| `buildEventEnvelope` | `packages/shared/src/envelope.utils.ts:291` | Builds a fresh root envelope; enforces `MAX_DEPTH_BY_CATEGORY` at construction time | `submitExecution`, `publishCancel` (ai-agent-gateway-adjacent code) | Factory function (construction-time validation only) |
| `DeriveEnvelopeOverrides` / `BuildEventEnvelopeOptions` | `envelope.utils.ts:133` / `envelope.utils.ts:245` | Input option shapes for the two factories above | `deriveEnvelope`, `buildEventEnvelope` | TS interface (compile-time only) |
| `ProducerCategory` / `MAX_DEPTH_BY_CATEGORY` | `envelope.utils.ts:8` / `envelope.utils.ts:15` | Anti-loop depth ceiling per producer category (§6.3) | `deriveEnvelope`, `buildEventEnvelope`, `DepthExceededError` | TS type + constant (compile-time / construction-time only) |
| `DepthExceededError` | `envelope.utils.ts:226` | Thrown when derived/built envelope would exceed `MAX_DEPTH` | `deriveEnvelope`, `buildEventEnvelope` | Error class |
| `canonicalJson` / `computeIdempotencyKey` / `computePayloadChecksum` / `canonicalByteLength` | `envelope.utils.ts` | Deterministic serialization + `idempotencykey`/`payload_checksum`/`payload_bytes` derivation (§7) | `deriveEnvelope`, `buildEventEnvelope`, `envelope.factory.ts`, claim-check resolver | Pure functions (runtime, but only compute — no schema validation) |

## 2. Channel messaging envelope (`packages/shared`, `services/channel-service`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `ChannelEnvelope` | `packages/shared/src/channel.interfaces.ts:22` | `EventEnvelope` + channel taxonomy (`channel`, `provider`, `kind`) | `services/audit-service/.../channel-audit.mongo.repository.ts`, `channel-audit.postgres.repository.ts`, `channel-audit.repository.interface.ts`, `envelope.factory.ts`; test: `channel-audit-repo-correlation.spec.ts` | TS interface (compile-time only) |
| `Channel` / `ChannelProvider` / `MessageKind` | `channel.interfaces.ts:3-11` | Enumerated literal unions for the channel taxonomy | `ChannelEnvelope`, `ChannelAccount`, `AutoReplyRule`, `envelope.factory.ts` | TS type aliases (compile-time only — not a runtime enum check beyond TS narrowing) |
| `InboundMessage` / `OutboundMessage` / `MessageMedia` | `channel.interfaces.ts:48-91` | Pre-envelope message payload shape that becomes `data.payload` | `envelope.factory.ts`, provider adapters | TS interface (compile-time only) |
| `createChannelEnvelope` | `services/channel-service/src/domain/envelope.factory.ts:43` | Builds a compliant inbound `ChannelEnvelope` (`kind: received` etc.) — canonical shape + legacy camelCase compatibility fields | Channel providers on ingress (webhook consumer) | Factory function (construction-time only; no post-hoc validator) |
| `createChannelSentEnvelope` | `envelope.factory.ts:138` | Builds a compliant outbound `ChannelEnvelope` (`sent`/`delivered`/`send` shadow events) | Outbound send-path code | Factory function (construction-time only) |
| `ICreateChannelEnvelopeOptions` | `envelope.factory.ts:18` | Options for `createChannelEnvelope` | `createChannelEnvelope` | TS interface (compile-time only) |

## 3. Webhook ingress (stage 1) envelope (`packages/shared`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `WebhookIngressEnvelope` | `packages/shared/src/webhook.interfaces.ts:44` | `Omit<EventEnvelope, "accountid">` narrowed to `producer:"api-gateway"`, `domain:"messaging"`, `provider:"webhook"`, `kind:"webhook_received"` — the pre-signature-verification envelope | `services/channel-service/src/modules/webhooks/webhook-ingress-consumer.service.ts` | TS discriminated type alias (compile-time only) |
| `IWebhookIngressData` | `webhook.interfaces.ts:15` | Extends `EventData` with `raw_body_b64`, filtered `headers`, optional `instance` | `WebhookIngressEnvelope` | TS interface (compile-time only) |
| `IWebhookVerifyRequest` / `IWebhookVerifyResponse` | `webhook.interfaces.ts:4-13` | RPC request/response for webhook token verification (NATS request/reply, not a bus envelope) | `WebhookVerifyRpcClient` (api-gateway), `webhook-verify-rpc.server.ts` (channel-service) | TS interface/type (compile-time only) |

## 4. Claim-check (`packages/database`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `isClaimCheckEnvelope` | `packages/database/src/claim-check.ts:175` | Runtime guard: compliant envelope AND `data.payload_inline === false` | `wrapHandler` (multi-tenant-consumer-manager.ts) | Runtime type guard (shallow — reuses `isCompliantEnvelope`) |
| `resolveClaimCheckEnvelope` | `claim-check.ts:83` | Resolves `data.payload_ref` from the NATS Object Store, verifies `sha256` checksum against raw fetched bytes, inflates `payload` | `MultiTenantConsumerManager` | Runtime resolver with a deep, but narrow, checksum-only validation |
| `parseClaimCheckRef` / `ClaimCheckRef` | `claim-check.ts:35` / `26` | Parses `nats://objstore/<bucket>/<key>` URI format for `payload_ref` | `resolveClaimCheckEnvelope` | Runtime parser (regex-based) |
| `looksLikeClaimCheck` | `claim-check.ts:16` | Byte-level pre-check for `"payload_inline":false` marker | (fast-path pre-filter, not itself schema validation) | Runtime heuristic |

## 5. Usage-aggregator hand-rolled parsers (`services/usage-aggregator-service`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `parseEnvelope` | `services/usage-aggregator-service/src/modules/aggregator/envelope-parser.ts:81` | Field-presence/type checks on a subset of `ChannelEnvelope` (`idempotencykey`, `accountid`, `channel`, `time`, `kind`) to build an `IChannelEventRow`; tolerant of unknown/extra fields | `aggregator.engine.ts` `handleMessage` | Hand-written runtime parser (partial — checks only the fields it consumes, not the full envelope) |
| `IChannelEventRow` / `ParseOutcome` | `envelope-parser.ts:7-24` | Normalized usage row + discriminated parse-result union | `parseEnvelope` | TS interface/type (compile-time) |
| `parseConnectorCallEnvelope` | `envelope-parser.ts:236` | Field-presence/type checks for connector-call usage events (`idempotencykey`, `time`, `data.payload.{adapterId,status,durationMs}`) | `aggregator.engine.ts` `handleMessage` | Hand-written runtime parser (partial) |
| `IConnectorCallEventRow` / `ConnectorParseOutcome` | `envelope-parser.ts:207-222` | Normalized connector-call usage row + result union | `parseConnectorCallEnvelope` | TS interface/type (compile-time) |

## 6. Internal-sync consumer (`services/connector-admin`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `parseEnvelope` (private) | `services/connector-admin/src/modules/internal-sync/internal-sync.service.ts:292` | Naive `JSON.parse` cast to `EventEnvelope` — **no field validation at all** beyond catching JSON syntax errors | `dispatchEnvelope` (same file) | Unsafe cast (no runtime schema validation) |

## 7. Observability projection (`packages/observability`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `IEnvelopeLogContext` | `packages/observability/src/envelope-logging.ts:10` | Minimal read-only subset of envelope identity/causal fields needed for structured logging | `envelopeLogFields`, `logWithEnvelope` | TS interface (compile-time only) |
| `IStructuredLogFields` | `envelope-logging.ts:25` | Structured log field names per `DOCS/architecture/observability.md` §3.1 | `envelopeLogFields` | TS interface (compile-time only) |
| `envelopeLogFields` / `logWithEnvelope` | `envelope-logging.ts:45` / `97` | Extracts/logs the above fields from any envelope-shaped object | Used platform-wide (internal-sync.service.ts, job-executor.service.ts, etc.) | Runtime function (projection, not validation) |

## 8. Audit-service event shapes (`packages/shared`, `services/audit-service`)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `GatewayAuditEvent` | `packages/shared/src/audit.interfaces.ts:1` | Gateway audit event published to the `audit.gateway.>` control channel (not the canonical `EventEnvelope` shape — its own format per envelope.md §3.1) | `publishGatewayAuditEvent` (api-gateway), `GatewayAuditMongoRepository`/`GatewayAuditPostgresRepository` (audit-service) | TS interface (compile-time only) |
| `AUDIT_MONGO_SCHEMA` and subsets (`EVENTS_AUDIT_MONGO_SCHEMA`, `GATEWAY_AUDIT_MONGO_SCHEMA`, `CHANNEL_AUDIT_EVENTS_MONGO_SCHEMA`, `EXECUTION_AUDIT_EVENTS_MONGO_SCHEMA`) | `packages/shared/src/audit-mongo-schema.ts` | MongoDB collection/index descriptors for the four audit collections (`events`, `gateway_audit_events`, `channel_events`, `execution_events`) — storage-side projection of the bus messages, not the wire schema itself | `ChannelAuditMongoRepository`, `GatewayAuditMongoRepository`, `ExecutionAuditMongoRepository` | Declarative index descriptor (applied via `applyMongoSchema`, not a payload validator) |
| `IMongoCollectionSchema` / `IMongoIndexSpec` | `packages/shared/src/mongo-schema.types.ts` | Generic Mongo collection/index descriptor type (not envelope-specific) | All `*_MONGO_SCHEMA` constants | TS interface (compile-time only) |

## 9. Other bus-adjacent message types (not the canonical envelope)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `TenantReadyMessageV1` / `isTenantReadyMessageV1` | `packages/shared/src/tenant-events.ts:94/101` | Small control message on `TENANT_READY_SUBJECT` (Core NATS, non-JetStream) — `schemaVersion`, `tenantId`, `name`, `tier` | `TenantReadySchemaListener` (packages/database) | TS type + **full runtime type guard** (checks every field's type — the most complete runtime validator found in this inventory) |
| `IMcpUsageEvent` | `packages/shared/src/mcp-usage.interfaces.ts:11` | MCP tool-call usage event shape reported by `mcp-usage-client.ts` (delivered over HTTP to agent-admin-service, not over the NATS bus) | `mcp-usage-client.ts` (`reportMcpUsageEvent`, `sendWithRetry`); test: `mcp-usage-client.spec.ts` | TS interface (compile-time only) — **out of scope for the bus envelope inventory**, included for completeness since it's adjacent usage-event plumbing |

## 10. Documentation / informational (non-code)

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `envelope-schema.json` | `skills/envelope-messages/assets/envelope-schema.json` | Draft-07 JSON Schema mirroring `EventEnvelope`/`EventTransport`/`EventData`. File's own `$comment` states: *"canonical source is packages/shared/src/interfaces.ts... Do not use as validation authority."* | IDE tooling / documentation only — **no code loads or validates against this file** (confirmed: no references found via codegraph) | JSON Schema (informational only, not wired into any runtime path) |
| `envelope-builder.ts` | `skills/envelope-messages/assets/envelope-builder.ts` | Not a builder — a pointer/comment-only module (`export {}`) documenting where the real factories live (`envelope.factory.ts`, `envelope.utils.ts`) | None (no runtime exports) | Documentation stub |
| `docs/messaging/envelope.md` | `docs/messaging/envelope.md` | Prose spec of the envelope contract, subject format, transport, causal chain, idempotency, and two-stage ingress — explicitly states the canonical source of truth is `packages/shared/src/interfaces.ts` | N/A (reference doc) | Documentation |

## 11. Message-tracking store (`tracking.tracked_events`)

Owner: **`tracking-ingester-service`** (bus→Postgres tracking ingester). Source of truth for the schema: `services/tracking-ingester-service/src/sql/tracked-events.sql` (raw idempotent DDL — no migration framework, mirroring `packages/database/src/postgres-provider.ts`). Row shape is binding on `TrackedEventRow` in `src/lib/to-tracked-event-row.ts`.

| Column | Type | Notes |
|---|---|---|
| `event_id` | `text PRIMARY KEY` | Canonical rows use `envelope.id`; non-envelope rows (rule 1/12/13/14/15) and rule-18 drift rows synthesize `"<stream>:<seq>"`. Upserts use `ON CONFLICT (event_id) DO NOTHING`. |
| `subject` | `text NOT NULL` | NATS delivery subject (authoritative routing key). |
| `tenant` | `text` | Nullable — null for cross-tenant families (e.g. `audit.gateway.>`). |
| `producer` | `text NOT NULL` | Envelope `producer` field. |
| `domain` | `text NOT NULL` | Envelope `domain` field. |
| `kind` | `text` | From subject `<kind>` token; null when non-canonical. |
| `version` | `text` | From subject `<version>` token; null when non-canonical. |
| `correlation_id` | `text` | Copied verbatim; null on non-envelope/drift rows. |
| `causation_id` | `text` | Copied verbatim; null on non-envelope/drift rows. |
| `causation_depth` | `integer` | `transport.depth`; nullable. |
| `occurred_at` | `timestamptz NOT NULL` | Envelope `time`. |
| `tech` | `text NOT NULL` | Classification (`TAXONOMY.md` §2), pure function of subject. |
| `business_fn` | `text NOT NULL` | Classification (`TAXONOMY.md` §3), producer intent. |
| `rule` | `integer NOT NULL` | First-matching `TAXONOMY.md` §4 rule. Stored values are 1–19: rule 20 is counted-not-persisted, so it never lands in the table. |
| `consumed_by` | `text[] NOT NULL` | Durable consumers of the subject family (`TAXONOMY.md` §5). |
| `is_claim_check` | `boolean NOT NULL` | `data.payload_inline === false` transport flag (`TAXONOMY.md` §6). |
| `envelope` | `jsonb NOT NULL` | Raw body stored verbatim. |
| `compliance` | `text NOT NULL DEFAULT 'full'` | `full` \| `partial` \| `none` — see item 7 above / mapper docs. |
| `ingested_at` | `timestamptz NOT NULL DEFAULT now()` | DB-side, never part of the mapper. |

18 mapper-set columns + `ingested_at` (DB-side default). Indexes: `correlation_id`, `occurred_at`, `business_fn`.

**Dispositions:** most rules are *counted-and-persisted* (one row per event). Rule 20 (`runtime-presence` heartbeats) is `counted-not-persisted` — classified and counted via the OTel counter `tracking_ingester_skipped_total{family,tenant}` but **no row is written** (`SKIP_PERSIST_RULES` in `src/lib/classify.ts` is the single source of truth). See `TAXONOMY.md` §4 disposition note.

## 12. Workflow-service step-event kinds (`services/workflow-service`)

Owner: **`workflow-service`**. Ride the SAME canonical `EventEnvelope` shape
and subject family as `execution_completed` (`evt.<tenant>.workflow-service.workflow.internal.native.<kind>.v1`,
`producer: "workflow-service"`, `domain: "workflow"`) — classified by
`TAXONOMY.md` rule 19, which is deliberately kind-agnostic (matches on
producer+domain, not a kind enum), so no classifier change was required.
Added by `manual-loops/workflow-step-events.md` T01-T05; golden rows
seq1312-1319.

| Symbol | File | Covers | Consumers | Kind |
|---|---|---|---|---|
| `publishExecutionStartedEvent` / `buildExecutionStartedSubject` | `services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts:251/58` | `execution_started` — emitted once per run before actions execute, payload `executionId`, `workflowId`, `runId`, `workflowName?` | `runWorkflow` (`src/temporal/workflows.ts`) via Temporal activity | Factory function (construction + publish; NATS `EventEnvelope`) |
| `publishActionStartedEvent` / `publishActionCompletedEvent` / `buildActionStartedSubject` / `buildActionCompletedSubject` | `execution-completed-publisher.activity.ts:523/534/357/362` | `action_started` / `action_completed` — payload `executionId`, `actionIndex`, `actionType` (real `WorkflowAction.activity` discriminant: `endpointCall\|mcpCall\|jsFunction\|serviceBusCall\|serviceCall\|channelSend\|agentCall\|branch\|conditional`), `actionName`, `branch?`, `connectorId?`, `agentId?`, and on completed: `status` (`ok\|failed\|skipped`) + `errorClass?` | `runWorkflow` (`src/temporal/workflows.ts`) via Temporal activities, guarded by `reserveStepEmission`'s 100-event cap | Factory function (construction + publish; NATS `EventEnvelope`) |
| `publishConditionEvaluatedEvent` / `buildConditionEvaluatedSubject` | `execution-completed-publisher.activity.ts:589/551` | `condition_evaluated` — payload `{ expression, evaluatedValue, branchTaken, cases, truncated? }`; emitted once per `conditional` node exit, NOT for untaken branches | `runWorkflow` (`src/temporal/workflows.ts`) via Temporal activity | Factory function (construction + publish; NATS `EventEnvelope`) |
| `reserveStepEmission` | `services/workflow-service/src/temporal/workflows.ts:446` | Atomic, race-safe (across fork branches) reservation of the 100-event-per-run cap (`STEP_EVENT_CAP`); returns `"emit" \| "truncated-marker" \| "skip"` | All three step-event emit call sites above | Pure function (in-workflow state mutation, no I/O) |

Causal contract (authoritative home: `TAXONOMY.md` rule 19 note, mirrored in
`services/workflow-service/README.md` "Step-Event Telemetry"): all three step
kinds are SIBLING hops off the run's `execution_started` event id — constant
`transport.depth = execution_started.depth + 1` (2-4 in practice), under
`MAX_DEPTH_BY_CATEGORY.internal_service` ceiling 5. No compile-time payload
type is exported for these kinds beyond the `IPublishActionStartedArgs` /
`IPublishActionCompletedArgs` / `IPublishConditionEvaluatedArgs` activity
argument interfaces (same file) — there is no shared runtime validator, same
posture as every other row in this inventory.

---

## Coverage map

Per the envelope structure defined in `docs/messaging/envelope.md`:

| Envelope area (envelope.md §) | Compile-time type | Runtime validator | Notes |
|---|---|---|---|
| §2.1 Mandatory header fields (`specversion`, `id`, `source`, `type`, `resource`, `time`, `traceid`, `causation_id`, `correlation_id`, `tenant`, `producer`, `domain`, `channel`, `provider`, `accountid`, `idempotencykey`) | ✅ `EventEnvelope` | ⚠️ Partial — `isCompliantEnvelope` checks presence + primitive `typeof` for every field, but does not validate string formats (UUID, ISO-8601, sha256 prefix, enum membership) | Only 2 callers use `isCompliantEnvelope` at all (claim-check path); most consumers cast/`JSON.parse` without calling it |
| §2.2 Optional extensions (`callback_url`, `adapter_id`, `enrich_adapter`, `forward_adapter`) | ✅ `EventEnvelope` | ❌ None | Not checked by `isCompliantEnvelope` (optional fields) |
| §3 Subject (8-token format) | ❌ No dedicated type found in this pass (builders `buildChannelSubject`/`buildWebhookIngressSubject` referenced in docs, not explored this pass) | ❌ None found | Subject correctness relies entirely on producer-side string builders; no consumer-side structural validator located |
| §4 Transport (`method`, `protocol`, `agent_id`, `depth`) | ✅ `EventTransport` (string literal unions) | ⚠️ Partial — `isCompliantEnvelope` only checks `typeof v.transport === "object"`, not the sub-fields or enum membership | |
| §5 EventData / claim-check | ✅ `EventData` | ⚠️ Partial — `isCompliantEnvelope` checks `data` is an object; `isClaimCheckEnvelope` narrows on `payload_inline===false`; `resolveClaimCheckEnvelope` does a **real** deep check (sha256 checksum) but only on the claim-check path | Inline (non-claim-check) payloads are never checksum-verified on read |
| §6 Causal chain (`causation_id`, `correlation_id`, `transport.depth`) + MAX_DEPTH (§6.3) | ✅ typed | ⚠️ Enforced only at **construction time** in `deriveEnvelope`/`buildEventEnvelope` (producer side); nothing validates depth/causal consistency on the **consumer** side | Per envelope.md, `DepthTrackerService` in agent-ai-service duplicates this with inconsistent `>=` vs `>` semantics — a second, divergent implementation, not a shared validator |
| §9 Two-stage ingress (`WebhookIngressEnvelope`) | ✅ `WebhookIngressEnvelope` (discriminated `Omit`) | ❌ None — no runtime guard distinguishing it from a canonical `ChannelEnvelope` | |
| Channel taxonomy (`channel`/`provider`/`kind`) | ✅ `Channel`/`ChannelProvider`/`MessageKind` literal unions | ❌ None — nothing checks incoming envelope's `channel`/`provider`/`kind` values are members of the literal unions at runtime | |
| Event-specific payload bodies (`data.payload`, e.g. `InboundMessage`) | ✅ `InboundMessage`/`OutboundMessage` (producer-side only) | ⚠️ Partial, per-consumer, ad hoc — `usage-aggregator`'s `parseEnvelope`/`parseConnectorCallEnvelope` check only the specific fields each consumer needs; not a shared/reusable payload schema | |
| `GatewayAuditEvent` (non-canonical control-channel message) | ✅ typed | ❌ None | |
| `TenantReadyMessageV1` (non-JetStream control message) | ✅ typed | ✅ **Full** — `isTenantReadyMessageV1` is the only complete field-by-field runtime validator found | Small, low-surface message; easiest case |

**Summary:** every envelope area has a TypeScript compile-time type. Runtime validation is inconsistent and mostly shallow/partial — the only genuinely complete runtime validator in the codebase (`isTenantReadyMessageV1`) covers a small 4-field control message, not the canonical bus envelope. No Zod (or equivalent) schema exists anywhere for `EventEnvelope`, `ChannelEnvelope`, or `WebhookIngressEnvelope` — confirmed via `codegraph_search` for `EventEnvelopeZod` (no results) and manual review of every hit in this inventory.

---

## Proposed extensions (per-item status — see markers)

The following gaps would need to be filled for a Bun-based message-tracking ingester to validate bus traffic at read time. Items 1–6 are **UNIMPLEMENTED PROPOSALS (REQUIRES USER APPROVAL — do not implement)**. Item 7 is **IMPLEMENTED** (see its marker) and is retained here as the record of the decision that shipped.

1. **Full runtime validator for `EventEnvelope`.**
   What: a Zod (or equivalent) schema mirroring `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`) — deep validation of every mandatory field (UUID format for `id`, ISO-8601 for `time`, `sha256:` prefix for `idempotencykey`/`payload_checksum`, enum membership for `transport.method`/`transport.protocol`), not just presence/typeof like `isCompliantEnvelope`.
   Where: candidate location `packages/shared/src/envelope.schema.ts` (new file, alongside `envelope.utils.ts`), exported for reuse by both NestJS services and a future Bun ingester.
   Why: `isCompliantEnvelope` is the closest existing thing but is intentionally shallow ("fast assertions", per its own doc comment) and is called in only 2 places; no shared deep validator exists for any consumer to reuse.

2. **Runtime validator for `ChannelEnvelope` (channel/provider/kind enums).**
   What: narrows the above with `channel`/`provider`/`kind` enum checks against `Channel`/`ChannelProvider`/`MessageKind`.
   Where: same module as #1, or `packages/shared/src/channel.schema.ts`.
   Why: today nothing checks that an incoming envelope's `channel` is actually one of `"whatsapp"|"instagram"|"telegram"|"http"` at runtime — `usage-aggregator`'s parser reads `channel` as `string` and passes it through unchecked.

3. **Runtime validator for `WebhookIngressEnvelope`.**
   What: validates the stage-1 envelope shape (`Omit<EventEnvelope,"accountid">` + `IWebhookIngressData`), distinguishing it from a canonical `ChannelEnvelope` for a tracker that needs to display both stages.
   Where: `packages/shared/src/webhook.schema.ts`.
   Why: no code currently disambiguates the two envelope variants by shape at runtime; consumers rely on subject/producer conventions instead.

4. **Subject-string structural validator (8-token format, §3).**
   What: a parser/validator for `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>` that returns a typed breakdown or a validation error, separate from the existing one-way builder functions.
   Where: `packages/shared/src/subject.schema.ts` (complementing `channel.utils.ts`'s builders with a validating parser).
   Why: a tracker ingesting arbitrary bus traffic needs to classify/route messages by subject; no reusable parser exists today (only producer-side builders and a few inline `subject.split(".")` call sites scattered across services with hand-rolled length checks, e.g. `internal-sync.service.ts:311`).

5. **Depth/causal-chain consistency validator (consumer-side).**
   What: a read-time check that `causation_id`/`correlation_id`/`transport.depth` are internally consistent (e.g. depth increments monotonically along a causal chain), for the tracker to flag anomalies.
   Where: new module, likely paired with #1.
   Why: `MAX_DEPTH_BY_CATEGORY` is only enforced at **producer construction time**; nothing validates it when a tracker reads messages back off the bus. This would also surface the known `DepthTrackerService` vs `envelope.utils.ts` inconsistency (`>=` vs `>`) documented in envelope.md §6.3.

6. **`GatewayAuditEvent` runtime validator.**
   What: same treatment as #1 for the non-canonical gateway audit control-channel message.
   Where: `packages/shared/src/audit.schema.ts`.
   Why: currently typed only; a tracker that also watches `audit.gateway.>` traffic has nothing to validate against.

7. **Ingester classification columns — IMPLEMENTED 2026-07-10** (DECIDED 2026-07-09 — see `TAXONOMY.md` §7).
   Status: **IMPLEMENTED.** Shipped as `tracking.tracked_events` (owner `tracking-ingester-service`, source of truth `services/tracking-ingester-service/src/sql/tracked-events.sql`; see the dedicated inventory section below). The events table carries `tech text` and `business_fn text` (producer-intent classification, pure function of subject/envelope), plus the two orthogonal facets decided by the user: `consumed_by text[]` (multi-value — which durable consumers read the subject family; seed mapping in `TAXONOMY.md` §5) and `is_claim_check boolean` (transport flag for `data.payload_inline === false` slim envelopes; NOT a classification value). An additional `compliance text` column (`full` | `partial` | `none`) was added during implementation to record how close each stored body is to a canonical `EventEnvelope`: `full` = compliant outright; `partial` = the user-approved stage-1 `webhook_received` canonical-with-known-drift exception (compliant except the intentionally-absent `accountid`); `none` = non-envelope/drift bodies. Rules and disposition per `TAXONOMY.md` §4/§5/§6/§7 (including rule 20 `runtime-presence` heartbeats, disposition `counted-not-persisted` → counted via an OTel metric but NO row persisted).
   Where: `services/tracking-ingester-service/src/sql/tracked-events.sql` (DDL) + `src/lib/to-tracked-event-row.ts` (mapper); classification rules in `TAXONOMY.md` §4.
   Why: `business_fn` must stay a deterministic pure function ("what the event represents"), so consumer roles and transport details were split into separate columns instead of overloading the dimension.
   Related finding: `agent-memory-service` publishes `io.yoizen.agent-memory.memory.*.v1` events on subjects built from a **service-local** `AGENT_MEMORY_SUBJECT_PREFIX` (`services/agent-memory-service/src/providers/nats.provider.ts:64-74`) — not from `packages/shared/src/constants.ts` like every other internal producer — and the envelope's `domain` field (`"automation"`) disagrees with the subject's domain token (`agent-memory`). See `DRIFT.md` discrepancy #9; the tracker classifies these by SUBJECT (`TAXONOMY.md` rule 9).
