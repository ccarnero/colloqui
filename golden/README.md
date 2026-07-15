# Golden Sample — Bus Event Classification

**Captured:** 2026-07-09 21:04–21:20 UTC, read-only, via `nats stream get` against the
dev cluster (port-forwarded `support-services-dev/nats`). No stream, consumer, or
message was modified during capture. Captured AFTER deploying correlation fixes 1, 2
and 4 (`workflow-service`, `agent-memory-service`) — this is the definitive post-fix
sample. Earlier pre-reset and pre-fix samples were discarded; their findings are
recorded in `DRIFT.md`.

## Contents

- `raw/*.json` — 72 live captured events + 8 synthetic events (seq 1312-1319,
  added by `manual-loops/workflow-step-events.md` T01 to cover the
  `execution_started`/`action_started`/`action_completed`/`condition_evaluated`
  kinds ahead of the emitter per golden rule 3 — see addendum below) + 2
  synthetic events (seq 1320-1321, added by `manual-loops/connector-invoke-api.md`
  T04 to cover the `invoke_requested`/`invoke_completed` connector-invoke
  transport pair ahead of the T05 emitter, same golden rule 3 — see addendum
  below) + 5 synthetic events (seq 1322-1326, added by
  `manual-loops/declarative-provisioning.md` T04 to cover the
  `apply_started`/`resource_applied`/`apply_completed`/`apply_failed`
  provisioning-service apply-engine kinds, landed WITH the emitter — see
  addendum below), 87 total. Each file is a wrapper object: `{ stream, seq,
  received, subject, headers, envelope }`. File name encodes provenance:
  `<STREAM>-seq<N>.json`.
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

- **`INGRESS-ACME`** — 70 live-captured events (contiguous range seq 1242–1311) +
  8 synthetic workflow-step-events T01 events (seq 1312–1319, see addendum below) +
  2 synthetic connector-invoke-api T04 events (seq 1320–1321, see addendum below) +
  5 synthetic declarative-provisioning T04 events (seq 1322–1326, see addendum
  below).
- **`GATEWAY_AUDIT`** — 2 events.
- 9 correlation chains, all formally closed by `correlation_id` + `causation_id`:
  4 conversation chains (1 Telegram, 3 HTTP) and 2 memory approve/reject cycles
  (test-provenance memories created via the admin API for fix-4 validation), plus
  2 synthetic workflow-step-events chains (seq 1312–1315, 1316–1319), plus 1
  synthetic connector-invoke async-transport chain (seq 1320–1321), plus 2
  synthetic declarative-provisioning apply chains (seq 1322–1324 successful run,
  seq 1325–1326 failed run).

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
All 82 rows carry HIGH confidence; rows with a non-empty `notes` column are the ones
most likely to need a human decision.

## Addendum (2026-07-14) — declarative-provisioning T04 synthetic rows

`manual-loops/declarative-provisioning.md` T04 lands the classification rule
(rule 22), the apply-engine emitter, AND the golden rows together in the same
task (unlike the two addenda below, which landed the rule ahead of a
not-yet-built emitter) — golden rule 3 still applies (rule + golden + classifier
land together), just with the emitter shipping in the same commit instead of a
later one. 5 rows (seq 1322-1326, two synthetic correlation chains under
`INGRESS-ACME`) were added by hand: chain one is a successful 3-resource-count
run (`apply_started` → `resource_applied` (channel created) → `apply_completed`,
seq 1322-1324); chain two is a failed run (`apply_started` → `apply_failed`,
seq 1325-1326). Both chains follow the sibling-hop causal pattern established
by workflow-step-events T01: `resource_applied`/`apply_completed`/`apply_failed`
all cite the run's `apply_started` envelope id as `causation_id` (never a
preceding sibling event), correlation inherited, depth 1. All 5 classify as
rule 22 `platform`/`provisioning`. See `TAXONOMY.md` §4 rule 22 design note.

## Addendum (2026-07-13) — connector-invoke-api T04 synthetic rows

`manual-loops/connector-invoke-api.md` T04 lands the classification rule (rule 21)
for the async invoke transport pair (`invoke_requested`/`invoke_completed`,
producer `connector-runtime`, domain `platform`, channel `endpoint`, provider
`system`) BEFORE the `invoke_completed` emitter exists (T05, not built yet —
same golden rule 3 pattern as workflow-step-events T01 below). 2 rows (seq
1320-1321, one synthetic correlation chain under `INGRESS-ACME`) were added by
hand: `invoke_requested` is a standalone root event (correlation_id = own id,
causation null, depth 0, mirroring the sync facade's audit event shape) and
`invoke_completed` inherits its correlation and cites it as causation (depth 1).
Both classify as rule 21 `platform`/`connector-invocation` — distinct from rule
11's `connector`/`connector-invocation` (the `endpoint_call_completed` HTTP-call
audit trail), because these two kinds are transport/control-plane signaling, not
an HTTP-call audit record. See `TAXONOMY.md` §4 rule 21 design note.

## Addendum (2026-07-11) — workflow-step-events T01 synthetic rows

`manual-loops/workflow-step-events.md` T01 lands the classification rule for four
new `workflow-service` event kinds (`execution_started`, `action_started`,
`action_completed`, `condition_evaluated`) BEFORE the emitter exists (golden rule
3: rule + golden + classifier land together). Since these kinds are not yet
emitted in the live cluster, 8 rows (seq 1312-1319, two synthetic correlation
chains under `INGRESS-ACME`) were added by hand, following the exact shape of the
captured rule-19 `execution_completed` rows. All 8 classify as rule 19
`platform`/`workflow-execution` — rule 19 is kind-agnostic (matches on
`producer`+`domain`, not a kind enum), so no classifier code change was required
to make them pass; they exist to guard the classifier against a future
kind-narrowing regression. See `TAXONOMY.md` §3/§4 rule 19 design note.

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
