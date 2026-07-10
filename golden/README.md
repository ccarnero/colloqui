# Golden Sample — Bus Event Classification

**Captured:** 2026-07-09 21:04–21:20 UTC, read-only, via `nats stream get` against the
dev cluster (port-forwarded `support-services-dev/nats`). No stream, consumer, or
message was modified during capture. Captured AFTER deploying correlation fixes 1, 2
and 4 (`workflow-service`, `agent-memory-service`) — this is the definitive post-fix
sample. Earlier pre-reset and pre-fix samples were discarded; their findings are
recorded in `DRIFT.md`.

## Contents

- `raw/*.json` — 72 live events. Each file is a wrapper object:
  `{ stream, seq, received, subject, headers, envelope }`. File name encodes
  provenance: `<STREAM>-seq<N>.json`.
- `labeled.tsv` — pre-labels produced by applying the classification rules in
  `TAXONOMY.md` §4 (20-rule table, first match wins) deterministically to every event.

  **Relabels (2026-07-10):** after the Phase-0 open decisions were resolved, 8
  `workflow-service` rows (seq 1247, 1253, 1261, 1265, 1272, 1276, 1281, 1286) were
  relabeled from rule 17 `unknown/unknown` to **rule 19** `platform/workflow-execution`,
  and 24 `online.v1` heartbeat rows (seq 1249, 1255, 1256, 1267, 1288–1307) from rule 16
  `platform/unknown` to **rule 20** `platform/runtime-presence` — per `TAXONOMY.md` §7
  resolved decisions #1/#2. `labeled.tsv` remains the audited golden truth.
- `REVIEW.md` — human-facing audit narrative (Spanish, per explicit request): every
  event mapped to its business story with cited evidence and confidence.

## Sample composition

- **`INGRESS-ACME`** — 70 events, contiguous range seq 1242–1311.
- **`GATEWAY_AUDIT`** — 2 events.
- 6 correlation chains, all formally closed by `correlation_id` + `causation_id`:
  4 conversation chains (1 Telegram, 3 HTTP) and 2 memory approve/reject cycles
  (test-provenance memories created via the admin API for fix-4 validation).

## `labeled.tsv` column contract

| Column | Meaning |
|---|---|
| `file` | Raw file name under `golden/raw/` |
| `seq` | JetStream sequence number within the source stream |
| `subject` | NATS subject as captured |
| `event_id` | `envelope.id` (canonical envelopes) or `envelope.requestId` (`GatewayAuditEvent`); empty when the message has no ID |
| `correlation_id` | `envelope.correlation_id` / `correlationId`; empty when absent |
| `tech` | Technology dimension per `TAXONOMY.md` §2 (public values — subject token `http` is mapped to `http-generic`) |
| `business_fn` | Business-function dimension per `TAXONOMY.md` §3 (producer intent only) |
| `is_claim_check` | `true` iff `envelope.data.payload_inline === false` (claim-check slim envelope); `false` otherwise. No claim-check event appears in this sample. |
| `rule` | Priority number of the first matching rule in `TAXONOMY.md` §4 |
| `notes` | Populated ONLY where something is off: fallback-rule hits (16/17/18), or subject-derived classification contradicting envelope fields |

## Status — pre-labels, not truth

These labels were generated mechanically from the `TAXONOMY.md` rule table.
**`labeled.tsv` becomes the classifier's golden truth ONLY after user correction.**
All 72 rows carry HIGH confidence; rows with a non-empty `notes` column are the ones
most likely to need a human decision.

## Anomalies surfaced by pre-labeling (verified in code)

1. **`workflow-service` execution-completed events are unclassified (8 events →
   `unknown`/`unknown` via rule 17).** Subject
   `evt.<tenant>.workflow-service.workflow.internal.native.execution_completed.v1`
   is a real production family (built at
   `services/workflow-service/src/temporal/activities/execution-completed-publisher.activity.ts:49`)
   that `TAXONOMY.md` does not cover — candidate for a new rule / `business_fn`
   value (e.g. `workflow-execution`) at user review time.
2. **`online.v1` heartbeats dominate the fallback bucket (24 events →
   `platform`/`unknown` via rule 16).** Kind `online` matches no rule; a dedicated
   presence/heartbeat rule is pending user decision.
3. **All `agent-memory` events carry `envelope.producer = "agent-admin-service"` and
   `envelope.domain = "automation"`** while their subject tokens say
   `agent-memory-service` / `agent-memory`. Root cause: the envelope builder reuses
   the shared `PLATFORM_PRODUCER`/`PLATFORM_DOMAIN` constants
   (`packages/shared/src/constants.ts:87`). Tracked as `DRIFT.md` #9; NOT part of the
   correlation fixes. Classification follows the SUBJECT (rule 9), per the
   TAXONOMY.md Q3 decision.
4. **Known causal-precision residual (deferred fix 3):** conversation `send` events
   and workflow `execution_completed` events point their `causation_id` at the
   `received` event, skipping the agent execution that produced the reply text.
   Correlation grouping is unaffected.
