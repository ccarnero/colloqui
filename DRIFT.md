# DRIFT.md — Envelope Contract Three-Way Cross-Check

**Status:** Phase 0 of the message-tracking-system effort — READ-ONLY analysis.
**Date:** 2026-07-09
**Scope:** cross-check the NATS bus envelope contract as implemented in CODE against
what DOCS say and what real test FIXTURES actually contain. This document reports
discrepancies only — nothing was fixed, normalized, or changed in any of the three
sources.

---

## Method

Three sources were compared pairwise (code↔docs, docs↔fixtures, code↔fixtures) for
every field of the envelope contract:

1. **CODE** — read directly via `Read`:
   - `packages/shared/src/interfaces.ts` (`EventEnvelope`, `EventTransport`, `EventData`, `JsonValue`)
   - `packages/shared/src/envelope.utils.ts` (`buildEventEnvelope`, `deriveEnvelope`, `isCompliantEnvelope`, `canonicalJson`, `MAX_DEPTH_BY_CATEGORY`)
   - `packages/shared/src/channel.interfaces.ts` (`Channel`, `ChannelProvider`, `MessageKind`, `ChannelEnvelope`)
   - `packages/shared/src/webhook.interfaces.ts` (`WebhookIngressEnvelope`, `IWebhookIngressData`)
   - `services/usage-aggregator-service/src/modules/aggregator/envelope-parser.ts` (`parseEnvelope`, `parseConnectorCallEnvelope`)
   - `packages/shared/src/audit.interfaces.ts` (`GatewayAuditEvent`)
   - `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts` (the actual stage-1 envelope constructor — pulled in after the fixture flagged a `type`-field discrepancy; not in the original primary file list but required to confirm whether the drift was in test data or in production code)
   - `packages/shared/src/channel.utils.ts` (`buildWebhookIngressSubject`, for subject-format cross-check)
2. **DOCS** — read via `Read`:
   - `docs/messaging/envelope.md` (prose spec, §1–§12)
   - `skills/envelope-messages/assets/envelope-schema.json` (informational JSON Schema, explicitly marked "do not use as validation authority")
3. **FIXTURES** — the 7 samples captured in `fixtures/bus-events/` (Part A of this task), transcribed verbatim from inline test-object literals in `services/usage-aggregator-service`, `services/channel-service`, `services/audit-service`, and `services/api-gateway` unit tests. See `fixtures/bus-events/README.md` for exact provenance.

No schema, interface, or doc was modified. No live cluster traffic was captured — the
sandbox has no route to the local dev cluster (`kubectl get pods -A` failed with
`dial tcp 127.0.0.1:26443: connect: operation not permitted`); this was skipped
silently per the task instructions.

---

## Discrepancies

| # | Field/aspect | Code says | Docs say | Fixtures show | Which source differs | Severity |
|---|---|---|---|---|---|---|
| 1 | Stage-1 `type` field format | `webhook-ingress-publisher.service.ts:117` hardcodes the literal string `"io.yoizen.messaging.webhook.received.v1"` for **every** channel — no `<channel>` token, and `"received"` instead of `"webhook_received"` | `envelope.md` §2.1 defines the format as `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`; §9 and §10.1 both give the worked example `io.yoizen.messaging.telegram.webhook.webhook_received.v1` (channel present, kind matches `envelope.kind`) | `channel-service-webhook-ingress-envelope-01.json` (transcribed from `webhook-ingress-consumer.spec.ts`) has `"type": "io.yoizen.messaging.webhook.received.v1"` — matches the **code**, confirming this is production behavior, not a test-data typo | **Code** diverges from docs; fixture corroborates the code (not the docs) | **High** — `type` is meant to be a machine-parseable discriminator; the real value cannot be used to recover `channel` or distinguish `webhook_received` from a generic `received`, which undermines any consumer (including a future tracker) that tries to classify stage-1 events by `type` alone. `kind`/`subject` still carry the correct values as a workaround. |
| 2 | `EventTransport.headers` vs `EventData.headers` | `EventTransport` (`interfaces.ts:13-18`) has **no** `headers` field at all: only `method`, `protocol`, `agent_id?`, `depth?`. The webhook header allowlist is implemented as `IWebhookIngressData.headers` (`webhook.interfaces.ts:18`) — i.e. under `data`, not `transport` | §4.1 documents "webhook header allowlist" headers as "copied to `transport.headers`"; the worked example in §10.1 places `"headers": {...}` **inside** `transport` | `channel-service-webhook-ingress-envelope-01.json` has `headers` under `data`, matching the real `IWebhookIngressData` interface, not under `transport` | **Docs** (§4.1 prose + §10.1 example) diverge from code; fixture matches code | **High** — a reader implementing against the doc's `transport.headers` placement would build a consumer that never finds the headers, since production code always puts them in `data.headers`. |
| 3 | `envelope-schema.json` `channel` enum omits `"http"` | `Channel` type (`channel.interfaces.ts:3`) is `"whatsapp" \| "instagram" \| "telegram" \| "http"` — `http` is a real, implemented channel (`services/channel-service/src/providers/http/`, per SCHEMAS.md/TAXONOMY.md) | `envelope-schema.json` `properties.channel.enum` is `["whatsapp", "instagram", "telegram"]` — `http` is missing. `envelope.md` §2.1 does not enumerate `channel` at all (says "Examples: whatsapp, telegram, platform"), so the prose doc itself is not wrong, only the JSON Schema file | No fixture uses `channel: "http"` (see coverage gaps below), so fixtures do not confirm or contradict this row directly | **JSON Schema** diverges from code; `envelope.md` prose is not affected | **Medium** — the file states "Do not use as validation authority," which limits blast radius, but an IDE/codegen tool that ingests this schema for autocomplete or a naive validator would reject legitimate `http`-channel envelopes. |
| 4 | `envelope-schema.json` `correlation_id` description vs actual `buildEventEnvelope()` behavior | `envelope.utils.ts:332`: `buildEventEnvelope()` sets `correlation_id: options.correlationId ?? randomUUID()` — a **fresh, unrelated UUID** when omitted, not the envelope's own `id` | `envelope-schema.json` `properties.correlation_id.description`: "Defaults to the envelope's own id when not explicitly passed (`buildEventEnvelope` / `createChannelEnvelope`)" — **explicitly names `buildEventEnvelope` as self-correlating**, which is false. `envelope.md` §2.1 and §6.1 get this right: "shared `buildEventEnvelope()` currently falls back to a fresh UUID unless `correlationId` is passed explicitly" (only `createChannelEnvelope()` self-correlates) | No fixture exercises the no-`correlationId`-passed code path for `buildEventEnvelope()` directly (all fixtures have `correlation_id` pre-populated) | **JSON Schema** contradicts both the code and `envelope.md`'s own prose (doc self-inconsistency, not just doc-vs-code) | **High** — this is a factual error in the informational schema's own description field, disagreeing with the more authoritative `envelope.md`. Anyone trusting the JSON Schema description over the prose doc would wrongly assume causally-unrelated envelopes share a `correlation_id`, corrupting chain assembly (`audit-service`'s `/audit/events/chain/:correlationId`). |
| 5 | `idempotencykey` format (`sha256:` prefix) | `computeIdempotencyKey`/`sha256Canonical` (`envelope.utils.ts:60-72`) always produce `"sha256:" + hex(64 chars)` | §7 states this format is mandatory ("Common violations (avoid): ... Omitting the `sha256:` prefix") | `usage-aggregator-envelope-parser-ingress-01/02/03.json` use `"idempotencykey": "abc-1"`; `audit-service-channel-envelope-01.json` uses `"idempotencykey": "idem-1"` — neither has the `sha256:` prefix or hex digest shape | **Fixtures** (test data) diverge from both code and docs | **Low** — confirmed to be deliberate throwaway test literals (these unit tests exercise field-presence/type parsing, not the idempotency algorithm), not evidence of a real production violation. Flagged because a naive reader of the fixture set alone could mistake it for a real-world sample. See `fixtures/bus-events/README.md` for the same caveat. |
| 6 | `envelope-schema.json` does not model `WebhookIngressEnvelope` at all | `WebhookIngressEnvelope` (`webhook.interfaces.ts:44`) is `Omit<EventEnvelope, "accountid">` plus narrowed literals (`producer:"api-gateway"`, `kind:"webhook_received"`, etc.) and `IWebhookIngressData` (adds `raw_body_b64`, `headers`, optional `instance`) | `envelope.md` §9 and §2.1 explicitly document this stage-1 variant, including that `accountid` is intentionally absent | `channel-service-webhook-ingress-envelope-01.json` has no `accountid` key at all, and has `raw_body_b64`/`headers`/`instance` under `data` — matches the code-side `WebhookIngressEnvelope`/`IWebhookIngressData` shape exactly | **JSON Schema** has a coverage gap vs. both code and the prose doc | **Medium** — `envelope-schema.json`'s single `required` array unconditionally lists `accountid`, so it would reject every real stage-1 envelope (see next row) and has no `oneOf`/variant to describe stage 1 vs. stage 2 at all. |
| 7 | `envelope-schema.json` `required` includes `accountid` unconditionally | `WebhookIngressEnvelope` type explicitly omits `accountid` (`Omit<EventEnvelope, "accountid">`) — omission is intentional and documented, not an oversight | `envelope.md` §2.1 documents the exception in prose: "`accountid` ... **Absent** in the initial `WebhookIngressEnvelope`" | `channel-service-webhook-ingress-envelope-01.json` has no `accountid` field, confirming the omission is real | **JSON Schema** `required` array contradicts the code, the fixture, and the JSON Schema's *own* field-level description text ("Absent in WebhookIngressEnvelope") | **High** — a self-contradiction inside the same file: the `accountid` property description acknowledges it can be absent, but the top-level `required` array still mandates it for every envelope, so validating against this schema would always reject legitimate, currently-shipping stage-1 traffic. |
| 8 | `resource` field format for stage-1 envelopes | `webhook-ingress-publisher.service.ts:118`: `` `tenant/${tenantId}/channel/${channel}/provider/webhook` `` — no `account/` segment | `envelope.md` §2.1 gives only the generic stage-2-style example (`tenant/acme/account/69bea8cd.../channel/whatsapp/provider/meta`) and never shows a stage-1 `resource` value in §9's worked example (the §9 code block omits `resource` entirely) | Not present in captured fixtures (`webhook-ingress-consumer.spec.ts`'s `buildEnvelope()` sets `resource` to a template string but the test doesn't assert its shape independently) | Docs have a **coverage gap**, not a contradiction — no documented stage-1 `resource` format to compare against | **Low** — flagged for completeness; not a contradiction because the doc simply never commits to a stage-1-specific `resource` shape. Should be resolved by adding a stage-1 example if this field matters to the tracker. |
| 9 | `agent-memory-service` subject constants + subject/envelope `domain` mismatch | `AGENT_MEMORY_SUBJECT_PREFIX = "evt.{tenant}.agent-memory-service.agent-memory.platform.internal"` and its four subject constants (`AGENT_MEMORY_PROPOSED/PUBLISHED/REJECTED/EXPIRED`) are defined **locally** in `services/agent-memory-service/src/providers/nats.provider.ts:64-74` — NOT in `packages/shared/src/constants.ts`, unlike every other internal producer (`agent-admin-service`, `ai-agent-gateway`, `agent-scheduler-service`, whose prefixes live in the shared constants file at lines 93-118). Additionally, the envelope body sets `domain: "automation"` (via shared `PLATFORM_DOMAIN`, `nats.provider.ts:214`) while the subject's domain token is `agent-memory` — the envelope and the subject disagree on the 4th taxonomy token | `envelope.md` §3 defines `domain` as the 4th subject token and the envelope field of the same name; nothing in the docs suggests they may diverge. The doc's producer inventory (§2.1: "Active producers: api-gateway, channel-service, registry-service, agent-admin-service, ai-agent-gateway") does not list `agent-memory-service` at all | No fixture exists for any `agent-memory` event (see coverage gaps) | **Code** internal inconsistency (subject token vs envelope field) + convention drift vs the shared-constants pattern; docs have a coverage gap (producer not listed) | **Medium** — any consumer classifying by `envelope.domain` puts these events in `automation`; classifying by subject puts them in `agent-memory`. TAXONOMY.md rule 9 deliberately classifies by SUBJECT. Centralizing the constants in `packages/shared/src/constants.ts` and aligning `domain` would remove the ambiguity. Found during TAXONOMY.md Q3 resolution (2026-07-09). |
| 10 | `online.v1` heartbeat subject producer token vs actual publisher (post-original-9 item, added 2026-07-10) | Subject `evt.<tenant>.ai-agent-gateway.automation.platform.internal.online.v1` carries producer token `ai-agent-gateway`, but the actual publisher is **`agent-ai-service`** — `services/agent-ai-service/src/modules/heartbeat/heartbeat.service.ts:91` builds and publishes these heartbeats every ~15s per active tenant. The subject producer token names a different service than the one emitting the event — directly analogous to item 9's agent-memory `envelope.producer` drift | `envelope.md` §3 defines the 3rd subject token as the producing service; nothing in the docs suggests the token may name a service other than the publisher. The producer inventory (§2.1) does not attribute an `online.v1` presence heartbeat to `ai-agent-gateway` or `agent-ai-service` | Live golden sample: 24 `online.v1` heartbeat events (seq 1249, 1255, 1256, 1267, 1288–1307) all carry the `ai-agent-gateway` producer subject token; see `golden/labeled.tsv` (relabeled to rule 20) | **Code** — the subject producer token disagrees with the publishing service | **Low** — classification is subject-driven, so `TAXONOMY.md` rule 20 classifies by the subject token per §2 and is unaffected (disposition `counted-not-persisted`, no row persisted). Attribution by producer would misattribute these heartbeats to `ai-agent-gateway`. Heartbeat non-canonical traits (UUID idempotencykey, `{name,version}` transport) are recorded in item 5 + its trailing "Not part of the original 9 items" note. |

**Handling note (items 6 & 7, stage-1 `accountid`, added 2026-07-10):** the tracking
layer now treats a stage-1 `webhook_received` envelope (TAXONOMY.md §4 rule 2) whose
ONLY compliance failure is the intentionally-absent (or explicit `null`) `accountid` as
**canonical-with-known-drift**: it is persisted with `compliance = 'partial'`, classified
by subject, `correlation_id`/`tenant` preserved, real `event_id` (`envelope.id`), never
synthesized. The mapper `services/tracking-ingester-service/src/lib/to-tracked-event-row.ts`
(`stage1PartialEnvelope`) cites these exact rows. This is a HANDLING decision for the
tracker only — the underlying `envelope-schema.json` drift itself (models no
`WebhookIngressEnvelope`; unconditionally `required`s `accountid`) remains **OPEN**: the
schema is still wrong.

---

## Fixture coverage gaps

Event kinds/producers with **no fixture** captured in `fixtures/bus-events/` (Part A),
either because no test literal was found or because the local dev cluster was
unreachable for live capture:

- **`channel-egress` confirmations** — `delivered`, `read`, `failed` kinds (only `sent` is covered, via the `usage-aggregator-envelope-parser-egress-02.json` partial envelope; no full `ChannelEnvelope` example for these three kinds).
- **`instagram` and `telegram` channel envelopes** — all captured fixtures use `channel: "whatsapp"`; no Instagram/Meta or Telegram-provider sample exists despite both being real `Channel`/`ChannelProvider` values.
- **`http` (generic-webhook) channel** — no fixture at all; relevant to discrepancy #3 above.
- **Claim-check slim envelope** (`data.payload_inline: false`, `payload_ref` populated, `payload: null`) — no fixture exercises this branch; all captured `data.payload_inline` values are `true`.
- **`agent-admin-service` platform-internal events** (`config_sync`, `jobs_sync`, `job_trigger`, `chat_respond`, `agent_published`, `agent_unpublished`, `document_ingestion`, `skb_file_ingestion`) — none found as inline test literals in the searched services.
- **`ai-agent-gateway` execution lifecycle events** (`execution_requested/started/completed/failed`) — only a partial, non-standard-shape sample exists (`audit-service-execution-envelope-01.json`, which is what `persistExecutionEnvelope` reads, not a full `EventEnvelope`).
- **`agent-scheduler-service` heartbeat events** — none found.
- **`registry-service` service-upserted/deleted events** — none found.
- **`connector-runtime` connector-call events** (`parseConnectorCallEnvelope`'s input shape) — the parser exists and is documented in SCHEMAS.md §5, but no `*.spec.ts` under the searched services constructs a literal test envelope for it (only the normalized `IConnectorCallEventRow` output is implied by the parser's own logic, not exercised by an existing spec with an inline fixture).
- **`platform.tenant.*` control messages** (`TenantReadyMessageV1`) — no test literal found under `packages/database` in this pass; this is a Core-NATS message, not a `evt.` bus envelope, so it is lower priority for this tracker but still an open gap.
- **`dlq.<tenant>.>` real DLQ envelope with `X-Dlq-Reason`/`X-Dlq-Stage` headers** — the captured DLQ fixture (`usage-aggregator-envelope-parser-dlq-03.json`) reuses the ingress body and does not include the DLQ-specific NATS headers described in `docs/messaging/service-bus.md`.
- **`audit.gateway.>` events with populated causal-chain fields** (`correlationId`/`causationId`/`depth` non-null) — the only `GatewayAuditEvent` fixture (`api-gateway-gateway-audit-event-01.json`) omits all three optional causal-chain fields.
- **Any envelope exceeding the 256 KB claim-check threshold** — by construction, none of the captured unit-test fixtures are large enough to exercise claim-check.

---

## Post-reset verification (2026-07-09)

Phase 0 DATA leg re-run against a fresh, live, uncontaminated capture of 68 NATS events
(`golden/raw/*.json`, JetStream streams `INGRESS-ACME` and `GATEWAY_AUDIT`, captured
2026-07-09 19:14–19:28 UTC). Each of the 9 discrepancies above was re-checked against
this fresh data where the item is data-observable; items about a static docs/schema
file's own text are marked code/docs-only. No DRIFT finding text above was altered.

1. **Stage-1 `type` field format — CONFIRMED in fresh data.** All 5 fresh `webhook_received` events (e.g. `golden/raw/INGRESS-ACME-seq1164.json`) carry `envelope.type: "io.yoizen.messaging.webhook.received.v1"` — no `<channel>` token, `"received"` not `"webhook_received"` — for both `telegram` and `http` channels. `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:117` still hardcodes this literal unconditionally; code unchanged since the original finding.
2. **`EventTransport.headers` vs `EventData.headers` — CONFIRMED in fresh data.** `golden/raw/INGRESS-ACME-seq1164.json`: `envelope.data.headers` holds `{content-type, x-telegram-bot-api-secret-token}`; `envelope.transport` is `{method, protocol, depth}` — no `headers` key at all. Matches the code-side shape, not the docs' `transport.headers` placement.
3. **`envelope-schema.json` `channel` enum omits `"http"` — CODE/DOCS-ONLY (not data-verifiable).** The finding is about a static JSON Schema file's `enum` array, which fresh event data cannot confirm or refute. Note in passing: this sample newly contains live `http`-channel traffic (6 events, e.g. `golden/raw/INGRESS-ACME-seq1191.json`), closing the "no `http` fixture" gap listed below the table — the missing-enum-value risk is therefore no longer theoretical if anything ingests that schema file.
4. **`envelope-schema.json` `correlation_id` description vs `buildEventEnvelope()` — CODE/DOCS-ONLY (not data-verifiable).** The finding is about a description string inside the schema file disagreeing with `envelope.utils.ts`/`envelope.md`; no event payload can confirm or refute prose text. (Separately, `services/agent-memory-service/src/providers/nats.provider.ts:396-397` shows `causationId: null` passed explicitly for `publishMemoryApproved`, consistent with `buildEventEnvelope`'s documented no-self-correlation behavior, but this is a different call site than the one the drift item discusses.)
5. **`idempotencykey` `sha256:` prefix — CONFIRMED in fresh data (new evidence, more serious than originally scoped).** 54 of 68 fresh events carry the correct `sha256:<64-hex>` format. The remaining 11 all belong to one kind: `evt.acme.ai-agent-gateway.automation.platform.internal.online.v1` heartbeat events (e.g. `golden/raw/INGRESS-ACME-seq1177.json`, `idempotencykey: "dff7e107-da73-4051-b10c-0dccd32e6a94"`) — plain UUIDs, no `sha256:` prefix. Unlike the original finding (unit-test throwaway literals), these are live production heartbeat events, so the "not evidence of a real production violation" caveat from the original Low-severity write-up no longer holds for this event kind; severity should be reassessed by the taxonomy owner.
6. **`envelope-schema.json` does not model `WebhookIngressEnvelope` — CODE/DOCS-ONLY (not data-verifiable).** Coverage gap in a static schema file; no event payload can confirm or refute what a schema file omits.
7. **`envelope-schema.json` `required` includes `accountid` unconditionally — CONFIRMED in fresh data, with a capture-format caveat.** `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:113-134` still builds the stage-1 object literal with no `accountid` key at all (comment at line 103 unchanged: "deliberately absent"). The fresh capture (`golden/raw/INGRESS-ACME-seq1164.json`) shows `"accountid": null` as an explicit key — not a wholly absent key as the original fixture-based finding described. This looks like a golden-capture/dump-tooling normalization (fixed-shape deserialization backfilling `null` for unset optional fields) rather than a code regression; the underlying code-level omission is unchanged and still contradicts the schema's unconditional `required` array either way.
8. **`resource` field format for stage-1 envelopes — CONFIRMED in fresh data (previously a docs coverage gap only, now data-observable).** `golden/raw/INGRESS-ACME-seq1164.json`: `envelope.resource: "tenant/acme/channel/telegram/provider/webhook"` — matches the code template in `webhook-ingress-publisher.service.ts:118` exactly (no `account/` segment). `envelope.md` still has no documented stage-1 `resource` example, so the docs gap itself persists.
9. **`agent-memory-service` subject constants + subject/envelope `domain` mismatch — CONFIRMED in fresh data, and worse than originally scoped.** All 5 `memory_proposed.v1` events in the sample (e.g. `golden/raw/INGRESS-ACME-seq1178.json`) show subject domain token `agent-memory` vs. `envelope.domain: "automation"` — confirms the original finding. Additionally (new): `envelope.producer` is `"agent-admin-service"` on every one of these events, not `agent-memory-service`. Root cause traced this pass: `services/agent-memory-service/src/providers/nats.provider.ts:213` sets `producer: PLATFORM_PRODUCER`, and `packages/shared/src/constants.ts:87` hardcodes `PLATFORM_PRODUCER = "agent-admin-service"` — a shared constant written for `agent-admin-service` and reused unchanged by `agent-memory-service`'s generic `buildEventEnvelope()` call path. TAXONOMY.md rule 9 already mandates classifying by subject, not `envelope.domain`/`envelope.producer`, so the tracker's classification is unaffected, but any consumer trusting `envelope.producer` for attribution (e.g. dashboards, alerting) would misattribute every agent-memory event to `agent-admin-service`.

**Not part of the original 9 items, surfaced this pass (see `golden/REVIEW.md` for full evidence):** the `ai-agent-gateway...online.v1` heartbeat kind (11 events) is unclassifiable under TAXONOMY.md's rule 6 (kind not in its enum) and falls to the rule-16 catch-all (`business_fn: unknown`); its envelope also lacks `data.payload_inline` entirely and uses a non-canonical `transport: {name, version}` shape instead of `{method, protocol}` — same 11 events implicated in item 5 above. `workflow-service`'s `execution_completed.v1` events (10 events) are self-correlated (`correlation_id` = own `id`, `causation_id` always `null`) and never carry the triggering webhook/channel event's causal IDs, even though `services/workflow-service/src/temporal/workflows.ts:452-457` calls `publishExecutionCompletedEvent` without forwarding the `workflow.causal` context available in scope — a code-level cause of a correlation break, not just a data anomaly.

---

## Post-correlation-fix verification (2026-07-09)

The correlation-chain fixes (fixes 1, 2, 4 of the approved plan, applied to
`services/workflow-service` and `services/agent-memory-service`) were deployed to the
dev cluster and validated live. A definitive post-fix sample of 72 events was captured
to `golden/raw/` (INGRESS-ACME seq 1242–1311 + 2 GATEWAY_AUDIT, 21:04–21:20 UTC; the
pre-fix sample was discarded after verification — its findings are recorded here).
Each data-verifiable item re-checked against this sample; deltas vs the previous block:

1. **Stage-1 `type` field format — STILL CONFIRMED (no delta, not part of the fixes).** `golden/raw/INGRESS-ACME-seq1242.json` and `seq1257`: `envelope.type: "io.yoizen.messaging.webhook.received.v1"` for both telegram and http channels.
2. **`transport.headers` vs `data.headers` — STILL CONFIRMED (no delta).** Both fresh `webhook_received` samples carry `headers` under `envelope.data`, none under `transport`.
3. **`envelope-schema.json` `channel` enum — CODE/DOCS-ONLY (unchanged).**
4. **`envelope-schema.json` `correlation_id` description — CODE/DOCS-ONLY (unchanged).**
5. **`idempotencykey` `sha256:` prefix — STILL CONFIRMED for the `online.v1` heartbeat family (no delta; heartbeats were not part of the fixes).** All 24 heartbeats in this sample carry plain-UUID idempotencykeys (e.g. `golden/raw/INGRESS-ACME-seq1249.json`, `"febf0e28-b22d-4a93-8390-6cd91fb05912"`); every other event carries `sha256:<hex>`.
6. **`envelope-schema.json` missing `WebhookIngressEnvelope` — CODE/DOCS-ONLY (unchanged).**
7. **`required: accountid` contradiction — STILL CONFIRMED (no delta).** Fresh stage-1 envelopes still have `accountid: null` (capture normalization of the code-level omission), e.g. `seq1242`.
8. **Stage-1 `resource` format — STILL CONFIRMED (no delta).** `seq1242` `resource: "tenant/acme/channel/telegram/provider/webhook"`.
9. **agent-memory subject/envelope mismatch — STILL REPRODUCES (expected: the envelope producer/domain lie was NOT part of the fixes).** All 8 memory lifecycle events in this sample (6 `memory_proposed` + 1 `memory_published` + 1 `memory_rejected`) still carry `envelope.producer: "agent-admin-service"` and `envelope.domain: "automation"` against subject tokens `agent-memory-service`/`agent-memory` (e.g. `golden/raw/INGRESS-ACME-seq1310.json`). Root cause unchanged: `PLATFORM_PRODUCER` at `packages/shared/src/constants.ts:87` reused by `services/agent-memory-service/src/providers/nats.provider.ts:213`.

**Deltas — previously-reported breaks now FIXED / NO LONGER OBSERVED in fresh data:**

- **Static-literal agent correlation — NO LONGER OBSERVED (fix 1 verified).** All 12 `execution_requested/started/completed` events now inherit the channel chain root as `correlation_id` (e.g. `golden/raw/INGRESS-ACME-seq1245.json`: `correlation_id: "07102a98..."` = the telegram webhook root; `causation_id: "208e49bf..."` = the `received` event; `transport.depth: 2`; started/completed follow at depth 3 with `causation_id` = the requested event's id). No `"ai-agent-triage"`/`"mcp-repo-support-bot"` literal appears in any envelope `correlation_id` in this sample. Fix: `services/workflow-service/src/temporal/workflows.ts` (agentCall now passes `context.causal`) + `agent-call.activity.ts` (uncommitted).
- **workflow-service self-correlated orphans — NO LONGER OBSERVED (fix 2 verified).** All 8 `execution_completed.v1` events now carry the chain root as `correlation_id` and `causation_id` = the triggering `received` event id, `depth: 2` (e.g. `seq1247`: `correlation_id: "07102a98..."`, `causation_id: "208e49bf..."`). Fix: `workflows.ts` finally-block object-form call + `execution-completed-publisher.activity.ts` `depth` support (uncommitted).
- **agent-memory `memory_published`/`memory_rejected` causation null — NO LONGER OBSERVED (fix 4 verified).** `seq1310` (`memory_published`): `causation_id: "332d969f..."` = the `memory_proposed` envelope id of `seq1308`, `correlation_id: "memory:bb0135b3..."`, `transport.depth: 1`. `seq1311` (`memory_rejected`): `causation_id: "5c491be7..."` = `seq1309`'s proposed envelope id. The two anchoring memories are deliberate validation fixtures (`payload.content: "Temporary test memory to validate causation anchoring. Safe to delete."`). Fix: `services/agent-memory-service/src/modules/memory/services/memory.service.ts` + `providers/nats.provider.ts` (uncommitted).

**Known residual (deferred fix 3 — expected, not a new finding):** `send.v1` and workflow `execution_completed.v1` `causation_id` still point at the `received` event, skipping over the agent execution that generated the reply content (e.g. `seq1252` send: `causation_id: "208e49bf..."` = the received event, not `"f4dee42f..."` = the `execution_completed` that produced the text). Correlation now unifies the whole trace regardless.

**RESOLVED (fix 3 verified live, 2026-07-09 22:36 UTC, commit a182b67):** the agent's
`execution_completed` envelope id now travels back through the execution status
(gateway projector persists it to Redis; `waitForExecutionResult` enriches it on the
NATS hot path), and the workflow rederives its causal context from it. Verified across
4 live conversation chains (INGRESS-ACME seq 1441–1485): every post-agent `send` and
workflow `execution_completed` cites the agent's completed event (e.g. seq1450 send:
`causation_id: "fd18030d..."` = the agent `execution_completed` of seq1449, depth 4),
while the no-agent echo workflow's `send` correctly keeps `received` as its cause
(seq1443, depth 2 — legacy fallback intact). Depth chain closes 0→1→2→3→4→5.
Note: the `golden/` 72-event sample predates fix 3, so its raw events still show the
residual — the sample remains valid for classification labeling.

---

## Code-fix log (envelope-drift loop, 2026-07-31)

Findings above are never rewritten (see the Method note: "No DRIFT finding text
above was altered"); this section records which of them the code side has since
closed, in the file's own append-only style.

2. **`EventTransport.headers` vs `EventData.headers` — FIXED in code
   (envelope-drift T06, SPEC decision 1).** `createChannelEnvelope` now places
   the webhook allowlist on `data.headers`, typed as `IChannelEventData`
   (`packages/shared/src/channel.interfaces.ts`), and `transport` is a plain
   object literal carrying exactly its declared fields — so the excess-property
   check that the old conditional spread bypassed is active again (verified: a
   probe key on `transport` now fails `tsc` with TS2353). `DOCS/messaging/envelope.md`
   §4.1's placement rule stands as written and its §10.2 example was corrected in
   the same commit. Wire impact: none. The `webhookHeaders` option had NO caller
   (the ingress caller never passed it), so no published stage-2 envelope
   ever carried `transport.headers` — matching this section's own 2026-07-09
   observation that fresh `transport` objects were `{method, protocol, depth}`.
   [Addendum 2026-07-31 (post-loop item 3): the caller now DOES pass it, so
   webhook-derived stage-2 envelopes carry the allowlist at its declared home
   `data.headers`. `transport.headers` remains gone for good.]
   Regression pins: `services/channel-service/test/unit/envelope.factory.spec.ts`
   ("webhook header allowlist placement").

