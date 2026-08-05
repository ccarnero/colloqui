# End-to-End Traceability Audit

Class: RECORD
Summary: 2026-06-20 hop-by-hop audit of the two traceability threads (OTel traceid and the correlation/causation causal chain); its two P0 findings were fixed and shipped after it was written.
Status: historical

> Business question: *"Can I trace every single message from start to finish and back?"*
> Method: hop-by-hop tracking of the two traceability "threads" (OTel `traceid` and the causal chain `correlation_id`/`causation_id`/`depth`) against the actual code. Date: 2026-06-20.

> ⚠️ **HISTORICAL DOCUMENT — the defects described below are ALREADY RESOLVED.**
> This is the *original* audit report (state as of 2026-06-20). The two P0 findings that the TL;DR, the hop-by-hop map, and the Findings table mark as ⚠️/❌ **have already been fixed, shipped, and committed** (to `main`):
> 1. **Causal chain break at ingress** → `channel-service` now inherits `correlation_id`/`causation_id`/`depth` from the webhook (commit `6292520`).
> 2. **IDs not persisted in the audit database** → `audit`, `channel_events`, and `gateway_audit_events` now store trace/correlation IDs; query endpoints `GET /audit/events/chain/:correlationId` and `GET /audit/channel-events/chain/:correlationId` are available.
>
> **Current status: full traceability, queryable end-to-end.** See the "Update" section at the end for details of what was implemented. Everything that follows is preserved as the analysis that motivated those changes.

## Verdict (TL;DR)  _(state at the time of the audit — already resolved, see banner)_

| Mechanism | Status | Useful for |
|---|---|---|
| **OTel Trace (`traceid`)** | ✅ **Continuous end-to-end, including the Temporal boundary** | Tracking a live message in Tempo/Grafana, in both directions |
| **Causal chain (`correlation_id`/`causation_id`/`depth`) in the envelope** | ⚠️ **Intact from the canonical message onward; breaks ONE hop** (webhook→canonical) | Reconstructing parent↔child lineage from event fields |
| **Queryable persistence (audit database)** | ❌ **Does not store trace/correlation IDs** | Durable forensics by `correlation_id` after Tempo expires |

**In plain terms:** the **live OTel traceability is well-solved and deliberate** (they even installed the Temporal interceptors). What is NOT covered today is: (a) the link *raw provider webhook → canonical message* in the correlation fields, and (b) being able to **query lineage durably** in the database (it only lives in Tempo, which is ephemeral). For a requirement of "audit any message months later," those two are defects to fix.

---

## The two threads

1. **`traceid` (OpenTelemetry)** — the technical thread. Travels in the NATS header `traceparent` (W3C) and, inside Temporal, through the OTel interceptors. Each consumer calls `startNatsConsumerSpan` (extracts the context) and runs the handler inside that span; on publish, `injectTraceContext` re-injects it. It is **continuous**.
2. **Causal chain (`correlation_id`/`causation_id`/`transport.depth`)** — the business thread, in envelope fields. `correlation_id` ties the entire flow together; `causation_id` points to the parent event; `depth` counts hops (anti-loop). Propagated with `deriveEnvelope` / the `causal` snapshot.

---

## Hop-by-hop map

| Hop | OTel survives? | Correlation survives? | Evidence |
|---|---|---|---|
| Client → bridge → SDK → api-gateway | n/a (enters here) | root: `correlation_id = id`, `causation_id = null`, `depth 0` | `webhook-ingress-publisher.service.ts:74-132` (sets `Nats-Msg-Id`, `X-Correlation-Id`, `traceparent`) |
| api-gateway → NATS → **channel-service (stage 2)** | ✅ extracts `traceparent` and opens span | ❌ **breaks**: `createChannelEnvelope` is called **without** `causal` → `causation=null`, `correlation=new id`, `depth=0` | `webhook-ingress-consumer.service.ts:103` (OTel) · `ingress.service.ts:109-153` + `envelope.factory.ts:43-91` (break) |
| channel-service → NATS → audit-service | ✅ `startNatsConsumerSpan` | (not applicable: persists only) — **but does not save the IDs**, see Persistence | `channel-audit.service.ts:102` |
| channel-service → NATS → **workflow-service (trigger)** | ✅ extracts span and starts the workflow inside it | ✅ snapshot `causal = {causation_id: canonical.id, correlation_id: canonical.correlation_id, depth}` | `trigger-consumer.service.ts:138-150, 206-237` |
| trigger → **Temporal** (client→workflow→activity) | ✅ **official OTel interceptors** | ✅ `causal` travels in the workflow context | `temporal.provider.ts:50`, `worker.ts:24-30`, `workflow-interceptors.ts`; `workflows.ts:266,274,320,392` |
| workflow → activity `channelSend` → NATS (response) | ✅ `activeOrRandomTraceId` + `injectTraceContext` | ✅ `correlation_id = causal.correlation_id`, `causation_id`, `depth+1`, header `X-Correlation-Id` | `channel-send.activity.ts:91-160` |
| workflow → activity `serviceBusCall` → NATS | ✅ | ✅ `correlation`/`causation` from `causal` (+ `X-Correlation-Id`/`X-Causation-Id`) | `service-bus.activity.ts:74-89` |
| workflow → `agentCall` → ai-agent-gateway/agent-ai-service | ✅ | ✅ `buildEventEnvelope({ correlationId, causationId, depth })` from `causal` | `execution-client.ts:118-145` |
| NATS response → channel-service (send-command) → provider | ✅ `startNatsConsumerSpan` | ✅ inherits from the response envelope | `send-command-consumer.service.ts:183` |

**Map conclusion:** the OTel `traceid` **does not break at any hop** (including Temporal). The correlation chain breaks **only** at `webhook→canonical`; from the canonical message onward it flows correctly, including the **response** (the outgoing `channelSend` carries the same `correlation_id` as the incoming message → the "return direction" works from the canonical message onward).

---

## Persistence (what is saved, and where)

- **audit-service → `channel_events`** (Postgres per tenant): columns `id` (PK = `envelope.id`, with `ON CONFLICT DO NOTHING`), `tenant_id, channel, provider, kind, account_id, from_id, to_id, message_type, message_text, provider_message_id, data (JSONB), nats_subject, created_at`.
  - ❌ **No columns** for `correlation_id`, `causation_id`, `traceid`, or `idempotencykey`.
  - The `data` blob stores **only `envelope.data`** (`channel-audit.postgres.repository.ts:66`), not the top-level fields → trace IDs **are not present even in the blob**.
- **Redis**: execution state (`pending:`/`result:` keyed by `<tenant>:<executionId>`), TTL ~1h — not a correlation index.
- **Temporal**: `workflowId` + idempotencyKey (`<idempotencykey>:<defId>`); `causal` lives in the workflow history, not queryable as a table.
- **Tempo (OTel)**: the full trace — but with **finite retention** (ephemeral).

---

## Findings

| # | Severity | What | Where |
|---|---|---|---|
| 1 | 🟠 Medium | The causal chain breaks at `webhook→canonical`: `createChannelEnvelope` does not receive `causal`. Mitigated by OTel (which does cross that hop), but breaks reconstruction by `correlation_id` from provider→canonical. | `ingress.service.ts:109-153`, `envelope.factory.ts:90-91` |
| 2 | 🟠/🔴 Medium-High | The durable audit **does not persist** `correlation_id`/`causation_id`/`traceid`/`idempotencykey`. Durable traceability depends only on Tempo (ephemeral). | `channel-audit.postgres.repository.ts:30-103` |
| 3 | 🟡 Low | `DepthTrackerService` (agent-ai) uses `>=` while the lib uses `>` → rejects one level earlier. | `depth-tracker.service.ts` (see `envelope.md §6.3`) |
| 4 | 🟡 Low | `buildEventEnvelope` falls back to `randomUUID()` for `traceid` when there is no active span → not a valid OTel trace (D9). Only matters for origins without a span. | `envelope.utils.ts:330`, `envelope.md §8` |

---

## Prioritized fix plan (to meet the "must")

1. **(P0 — closes #1) Propagate the causal chain at ingress.** Thread `correlation_id`/`causation_id`/`depth` from the `WebhookIngressEnvelope` through `IProcessInboundOptions` → `IPublishMessageOptions` → `createChannelEnvelope` (ideally via `deriveEnvelope`). It is plumbing of a few lines and reconnects provider↔canonical. *Verification:* test that the canonical's `correlation_id` equals the webhook's.
2. **(P0 — closes #2) Persist the trace IDs in the audit.** Add indexed columns `correlation_id`, `causation_id`, `traceid`, `idempotencykey` to `channel_events` (and to the generic audit `events`), populating them from the top-level envelope fields (currently discarded). Enables durable round-trip queries by correlation, independent of Tempo's retention. *Verification:* `SELECT … WHERE correlation_id = $1 ORDER BY created_at`.
3. **(P1) Unify the anti-loop `depth`** (`>=` → `>` or reuse `MAX_DEPTH_BY_CATEGORY`) and, on excess, route to DLQ with `X-Dlq-Reason: depth_exceeded` + metric, instead of throwing an exception (which `envelope.md §6.3` already marks as pending).
4. **(P2) Guarantee a valid OTel `traceid`** for origins without a span (always pass `activeOrRandomTraceId()` or require an active trace) to eliminate the `randomUUID` fallback.
5. **(P2 — optional) Trace retention/export policy** or a durable correlation index, if "audit months later by `correlation_id`" is a hard requirement.

---

## Positive highlights

The tracing design **is deliberate and mostly correct**: `traceparent` on every publish/consume, `startNatsConsumerSpan` in every consumer, and **Temporal OTel interceptors** in client/workflow/activity — which is exactly the boundary where tracing typically breaks. The causal chain is correctly implemented from the canonical message onward (including the response). Only two pieces are missing to go from "traceable live" to "traceable and durably auditable end-to-end": closing the ingress hop and persisting the IDs.

---

## Update 2026-06-20 — implementation status

Four changes were worked via SDD (details in `cowork/CHANGES-for-dev.md` and `.sdd/changes/`):

- ✅ **Persist the IDs (P0 #2): SHIPPED and COMMITTED.** audit-service persists `correlation_id`/`causation_id`/`depth` in `events`, `channel_events`, and `gateway_audit_events`, with endpoints `GET /audit/events?correlation_id=` and `GET /audit/events/chain/:correlationId` (causal tree). Shipped with **Option B** (also propagates to the gateway interceptor). Tests green. Archived in `.sdd/changes/traceability-audit-persist-ids/archive.md`.
- ✅ **Close the ingress hop (P0 #1): SHIPPED and COMMITTED** (git `6292520`). `channel-service` now threads `correlation_id`/`causation_id`/`depth` from the `WebhookIngressEnvelope` through `processInbound` → `createChannelEnvelope` (`ingress.service.ts:116-164`). The causal chain **no longer breaks at webhook→canonical**. Archived in `.sdd/changes/traceability-channel-ingress-causal/archive.md`.
- ✅ **Chain endpoint for `channel_events` (follow-up): SHIPPED and COMMITTED.** `GET /audit/channel-events/chain/:correlationId` is in production (`channel-audit.controller.ts:35`), reusing `buildChainTree`. Archived in `.sdd/changes/traceability-channel-chain-endpoint/archive.md`.
- 🟡 **`depth` `>=`/`>` and D9 `traceid`: pending (optional/low priority)** (`traceability-depth-and-traceid`).

**Net result:** end-to-end traceability **is complete**. The causal chain flows from the provider webhook to the canonical message and its descendants, and is durably queryable via the two chain endpoints (`/audit/events/chain/:correlationId` and `/audit/channel-events/chain/:correlationId`). The only remaining item is the optional low-priority `traceability-depth-and-traceid` item.



*Sources: `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts`, `services/channel-service/src/modules/{webhooks/webhook-ingress-consumer,ingress/ingress}.service.ts` + `src/domain/envelope.factory.ts`, `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts` + `src/temporal/{workflows.ts,worker.ts,workflow-interceptors.ts,activities/*}` + `src/providers/temporal.provider.ts`, `packages/shared/src/{envelope.utils,execution-client}.ts`, `packages/observability/src/nats-propagation.ts`, `services/audit-service/src/modules/channel-audit/channel-audit.postgres.repository.ts`, `DOCS/messaging/envelope.md`.*
