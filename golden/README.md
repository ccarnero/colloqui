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
  addendum below) + 3 synthetic events (seq 1327-1329, added by
  `manual-loops/declarative-provisioning.md` T05 to cover the
  `secret_written`/`secret_resolved`/`secret_access_denied` secrets-audit
  kinds, landed WITH the emitter — see addendum below) + 2 synthetic events
  (seq 1330-1331, added by `manual-loops/connectors/connection-call-inspector.md`
  T05 to cover the `mcp_call_completed`/`llm_call_completed` kinds, landed
  WITH the T03/T04 emitters — see addendum below) + 4 synthetic events (seq
  1332-1335, added by `PENDIENTES/04-e3-subject.spec.md` T01 to cover the
  `execution_started`/`execution_completed`/`execution_failed`/`online` kinds
  under the NEW `agent-ai-service` producer token, ahead of the T02 emitter per
  golden rule 3 — see addendum below), 96 total. Each file
  is a wrapper object: `{ stream, seq, received, subject, headers, envelope
  }`. File name encodes provenance: `<STREAM>-seq<N>.json`.
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
  below) + 3 synthetic declarative-provisioning T05 events (seq 1327–1329, see
  addendum below) + 2 synthetic connection-call-inspector T05 events (seq
  1330–1331, see addendum below) + 4 synthetic E3-subject T01 events (seq
  1332–1335, see addendum below).
- **`GATEWAY_AUDIT`** — 2 events.
- 13 correlation chains, all formally closed by `correlation_id` + `causation_id`,
  plus 2 standalone connection-call-inspector roots (seq 1330, seq 1331, each a
  single-event chain — see addendum below):
  4 conversation chains (1 Telegram, 3 HTTP) and 2 memory approve/reject cycles
  (test-provenance memories created via the admin API for fix-4 validation), plus
  2 synthetic workflow-step-events chains (seq 1312–1315, 1316–1319), plus 1
  synthetic connector-invoke async-transport chain (seq 1320–1321), plus 2
  synthetic declarative-provisioning apply chains (seq 1322–1324 successful run,
  seq 1325–1326 failed run), plus 2 synthetic declarative-provisioning secrets
  chains (seq 1327 standalone `secret_written` root, seq 1328 a `secret_resolved`
  sibling reusing the seq1322 apply-run's correlation, seq 1329 a standalone
  `secret_access_denied` chain), plus 1 synthetic E3-subject execution chain
  (seq 1332 `execution_started` → seq 1333 `execution_completed`) and 1
  standalone E3-subject failed-execution root (seq 1334). The E3 heartbeat row
  (seq 1335) is a standalone beat with its own correlation, exactly like the
  24 captured `online.v1` rows.

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

## Addendum (2026-08-07) — E3 subject-fix T01 synthetic rows

`PENDIENTES/04-e3-subject.spec.md` T01 teaches the classifier the NEW producer
token of the agent-ai-service publishers BEFORE the wire flips (T02) — golden
rule 3 in its original form (rule + golden + classifier ahead of the emitter,
same pattern as the connector-invoke-api T04 addendum below). Subject token 2
is the producer routing key, and the three `publishStatus` lifecycle kinds
(`execution_started`/`execution_completed`/`execution_failed`) plus the
`online.v1` heartbeat were riding `ai-agent-gateway` while agent-ai-service
published them (`DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` E3; `DRIFT.md`
item 10 for the heartbeat). Rules 6 and 20 now accept BOTH tokens: the
`ai-agent-gateway` token is FROZEN history (the 92 previously audited rows —
including the 8 captured lifecycle rows and the 24 captured heartbeat rows —
keep their labels untouched) and `agent-ai-service` is the post-E3 truth.
4 rows (seq 1332-1335) were added by hand, following the exact shape of the
captured old-token rows they twin: seq1332 `execution_started` (synthetic
chain root — correlation_id = own id, causation null, depth 0) → seq1333
`execution_completed` (causation = seq1332's envelope id, correlation
inherited, depth 1); seq1334 `execution_failed` is a second, standalone
execution root (depth 0) and is the ONLY golden coverage of that kind — no
execution failed during the 2026-07-09 capture window; seq1335 is an
`online.v1` heartbeat that preserves the live non-canonical envelope shape
verbatim (no `data.payload_inline`, `transport = {name,version}`, UUID
`idempotencykey`, empty `accountid` — `DRIFT.md` item 5, untouched by this
migration). All four carry the SAME `tech`/`business_fn`/`rule` as their
old-token twins (rule 6 `platform`/`agent-execution`, rule 20
`platform`/`runtime-presence` with the unchanged `counted-not-persisted`
disposition). `execution_requested` is deliberately ABSENT: it is published by
the gateway itself and does NOT move, so an `agent-ai-service`
`execution_requested` subject stays the rule-16 alarm. See `TAXONOMY.md` §4
rules 6/20.

## Addendum (2026-07-28) — connection-call-inspector T05 synthetic rows

`manual-loops/connectors/connection-call-inspector.md` T05 lands the two new
classification rules (rule 24 for `mcp_call_completed`, rule 25 for
`llm_call_completed`), the matching `TAXONOMY.md` entries, AND the golden
rows together in the same task — the T03/T04 emitters already landed
(`event-publisher.ts`'s `emitMcpCall`, `llm-call-event-publisher.service.ts`),
so, like the declarative-provisioning T04/T05 addenda above, this is golden
rule 3 with the emitter shipping ahead of (not after) the classifier. 2 rows
(seq 1330-1331) were added by hand, each a standalone root (no upstream
causal chain — correlation_id = own id, causation null, depth 0): seq1330 is
a successful MCP tool call (`search_docs`, resource `mcp/mcp-repo-support-bot`)
classifying as rule 24 `connector`/`connector-invocation` — REUSED from rule
11, not a new `business_fn`, because decision 1 groups `mcpCall` alongside
`endpointCall` as one of "every connector invocation type"; seq1331 is a
standalone (non-chat-execution) job-executor LLM call (`gpt-4o-mini`,
resource `execution/job-execution-seq1331`) classifying as rule 25
`platform`/`llm-invocation` — a NEW `business_fn`, distinct from rule 6's
`agent-execution` (a full chat execution) and rule 11/24's
`connector-invocation` (a connector-runtime call), because it represents a
standalone LLM invocation outside any agent chat execution. See
`TAXONOMY.md` §4 rules 24/25 design notes.

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

## Addendum (2026-07-14) — declarative-provisioning T05 synthetic rows

`manual-loops/declarative-provisioning.md` T05 lands the classification rule
(rule 23), the secrets CRUD/broker emitter, AND the golden rows together in
the same task (same golden rule 3 pattern as T04's rule 22 addendum above).
3 rows (seq 1327-1329) were added by hand: seq1327 is a standalone
`secret_written` root (a `PUT /secrets/:name` write — correlation_id = own
id, causation null, depth 0); seq1328 is a `secret_resolved` SIBLING that
reuses the seq1322 apply-run's `correlation_id` as its own `causation_id`
(demonstrating the broker resolving a secret mid-apply-run) at depth 1;
seq1329 is a `secret_access_denied` SIBLING off its own fresh correlation
(a standalone denied resolve attempt, binding mismatch) at depth 1. All 3
classify as rule 23 `platform`/`secrets-audit` — a NEW `business_fn`, kept
separate from rule 22's `provisioning` even though both share the same
producer/domain/channel/provider family (human decision: secrets audit is a
distinct business concern from apply-run bookkeeping). None of the three
payloads carry a secret VALUE — `secret_access_denied` carries a `reason`
string only. See `TAXONOMY.md` §4 rule 23 design note.

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
