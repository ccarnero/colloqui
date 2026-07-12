# Bus Event Fixtures — Provenance

Phase 0 of the message-tracking-system effort. All fixtures below were transcribed
**faithfully** from inline TypeScript object literals in existing unit test files —
no field was added, removed, renamed, or "fixed" for consistency with
`docs/messaging/envelope.md` or `packages/shared/src/interfaces.ts`. Where a value
was computed at test-run time (`Date.now()`, `new Date().toISOString()`), the raw
literal expression is preserved as a placeholder string rather than invented.

Live-cluster capture was attempted per the task instructions
(`kubectl get pods -A --request-timeout=5s`) but the sandbox has no network route to
the cluster (`dial tcp 127.0.0.1:26443: connect: operation not permitted`). Skipped
silently per instructions — no live NATS messages are included in this set.

## Files

| File | Source (test file / function) | Notes |
|---|---|---|
| `usage-aggregator-envelope-parser-ingress-01.json` | `services/usage-aggregator-service/test/unit/envelope-parser.spec.ts`, `base` object (lines 13-21), consumed via `parseEnvelope(encode(base), subj("received"), "INGRESS-tenant-1")` | Deliberately partial — `parseEnvelope` only reads `idempotencykey`, `accountid`, `channel`, `producer`, `time`, `kind`, `data.payload`, so the test envelope omits all other mandatory `EventEnvelope` fields (`specversion`, `id`, `source`, `type`, `resource`, `traceid`, `causation_id`, `correlation_id`, `tenant`, `domain`, `provider`, `transport`, and most of `data`). `idempotencykey: "abc-1"` also does not follow the `sha256:` prefix convention — this is intentional throwaway test data, not a contract violation by production code. |
| `usage-aggregator-envelope-parser-egress-02.json` | Same spec file, `{ ...base, kind: "sent" }` (lines 41-44) | Same partial-envelope caveat as above. Used to assert `direction: "egress"` mapping for `kind: "sent"`. |
| `usage-aggregator-envelope-parser-dlq-03.json` | Same spec file, `{ ...base, kind: "received" }` consumed from stream `"DLQ-tenant-1"` (lines 53-57) | Body is identical to the ingress fixture; the DLQ-vs-ingress distinction in `parseEnvelope` comes from the **stream name** passed alongside the envelope bytes, not from an envelope field. The `_note_stream` key is a fixture-transcription annotation added for this README cross-reference — it is **not** part of the original test object or the wire envelope. |
| `channel-service-webhook-ingress-envelope-01.json` | `services/channel-service/test/unit/webhook-ingress-consumer.spec.ts`, `buildEnvelope()` (lines 18-50) + the `instance: "my-instance"` variant added in the second test case (lines 76-84) | This is a stage-1 `WebhookIngressEnvelope` literal (per `packages/shared/src/webhook.interfaces.ts`). `time` and `data.received_at` were `new Date().toISOString()` in the source — preserved here as the placeholder string `"<Date.now() ISO string at test run time>"` rather than a fabricated timestamp. Combines two literals from the same file: the base envelope plus the optional `data.instance` field exercised by the second `it()` block. |
| `audit-service-channel-envelope-01.json` | `services/audit-service/test/unit/channel-audit-repo-correlation.spec.ts`, `makeChannelEnvelope()` (lines 14-46) | Full `ChannelEnvelope` literal (`EventEnvelope` + `channel`/`provider`/`kind`) used as the default for all cases in this spec file. `idempotencykey: "idem-1"` and `data.payload_checksum: "chk"` do not follow the `sha256:` prefix convention — test data, not production output. |
| `audit-service-execution-envelope-01.json` | `services/audit-service/test/unit/execution-audit.service.spec.ts`, first argument to `invokePersist()` in the "persists a well-formed execution_completed envelope" test (lines 72-85) | Deliberately minimal — only the fields `persistExecutionEnvelope` reads (`id`, `tenant`, `correlation_id`, `causation_id`, `transport.depth`, `data.payload.{executionId,agentId,state}`). Not a full `EventEnvelope`; no `specversion`/`type`/`source`/etc. in the original test object. |
| `api-gateway-gateway-audit-event-01.json` | `services/api-gateway/test/unit/gateway-audit-publish.util.spec.ts`, `minimalEvent()` (lines 7-23) | This is a `GatewayAuditEvent` (`packages/shared/src/audit.interfaces.ts`), **not** the canonical `EventEnvelope`/`ChannelEnvelope` shape — it is published to the separate `audit.gateway.>` control channel (see SCHEMAS.md §8). Included because it is bus-adjacent and directly relevant to the gateway-audit drift check in DRIFT.md. `timestamp` was `new Date().toISOString()` in the source — preserved as a placeholder string. Source file lives outside the three services named as primary targets (usage-aggregator-service, audit-service, channel-service) but was pulled in because `audit-service`'s `gateway-audit.service.spec.ts` only has the *persisted Mongo row* shape (`sampleRow`), not the *published* event shape — this fixture fills that gap. |

## Addendum (2026-07-11) — workflow-step-events T01 synthetic fixtures

The four `workflow-service-{action-started,action-completed,condition-evaluated,
execution-started}-envelope-01.json` fixtures are **synthetic**, not transcribed
from an existing test literal — they violate the "faithfully transcribed" invariant
above by necessity, not oversight. `manual-loops/workflow-step-events.md` T01 lands
the TAXONOMY.md rule-19 classification contract for four `workflow-service`
step-event kinds (`execution_started`, `action_started`, `action_completed`,
`condition_evaluated`) **before the emitter exists** (golden rule 3: rule + golden +
classifier land together — see `golden/README.md`'s matching addendum for the
corresponding synthetic golden rows, seq 1312-1319). Since no test file or live
capture emits these kinds yet, the fixtures were hand-built to match the envelope
shape produced by `execution-completed-publisher.activity.ts` (camelCase payload
fields per `TAXONOMY.md` rule 19) and the shared `EventEnvelope` interface
(`packages/shared/src/interfaces.ts:29-57` — no top-level `kind` field; the kind
lives only in the subject's trailing token). Forward-referenced by T02 (emitter
implementation), T03 (classifier coverage), and T04 (end-to-end verification) of
the same manual loop, which will replace these placeholders with fixtures
transcribed from the real emitter's tests once it exists.

**Causal contract (corrected 2026-07-12, T04 review fix):** `action_started`,
`action_completed`, and `condition_evaluated` are SIBLING hops off the run's
`execution_started` event, not a chained step-to-step causation. All three
step-event fixtures cite `wf-exec-started-1` (the `execution-started`
fixture's `id`) as their `causation_id`, and all three share the SAME constant
`transport.depth` of `execution_started.depth + 1` (`3` in this synthetic
run), regardless of how many actions precede them. See TAXONOMY.md rule 19
for the ceiling rationale (chained causation would grow depth linearly with
action count and exceed `MAX_DEPTH_BY_CATEGORY.internal_service` for any
workflow with more than a few actions).

## Fixture coverage gaps

See "Fixture coverage gaps" section in `DRIFT.md` at the repo root for the full list of
event kinds/producers with no fixture in this set (e.g. `delivered`/`read`/`failed`
channel-egress confirmations, `agent-admin-service`/`ai-agent-gateway`/`agent-scheduler-service`
platform-internal events, claim-check slim envelopes with `payload_inline: false`,
`connector-runtime` connector-call events, `TenantReadyMessageV1` control messages).
