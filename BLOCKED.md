# Blocked tasks — message-tracking ingester build loop

## T13 — End-to-end validation

- **Date:** 2026-07-10
- **Attempts:** 1 (validation-only task; no code changed, nothing reverted)
- **Failing criterion:** "SQL for the correlation_id returns the full chain (>= 4 stages, unknown = 0)". Live run got a healthy full chain (10 events, depth 1→5, terminal channel-egress) but `unknown = 2`, and the ingress stage is missing from every chain.
- **Evidence:** correlation_id `cec80a9c-6ce9-402b-a200-f30a31a5df20`, driven 2026-07-10 01:43 UTC via a simulated Telegram update POSTed to the api-gateway webhook route (tenant acme). Dashboard verified live: top chain max_depth=5 / 10 events; open=8 / closed=1.

### Blocker 1 — taxonomy decision required (USER) — RESOLVED 2026-07-10
User decision: TAXONOMY.md rule 19 — `evt.*.workflow-service.workflow.*` → tech `platform`, business_fn `workflow-execution` (justification recorded in TAXONOMY.md §7; tech from the subject token per §2, Temporal is an implementation detail; publisher verified in execution-completed-publisher.activity.ts). Implemented end-to-end: classifier rule 19 (evaluated before catch-alls 16/17/18), exported `UNKNOWN_RULES = {16,17,18}` as the single alarm-derivation source (a second `rule >= 16` derivation in process-tracked-message.ts was caught by review and fixed with regression tests), golden/labeled.tsv relabeled (8 rows: seq 1247, 1253, 1261, 1265, 1272, 1276, 1281, 1286), golden gate 72/72. `unknown = 0` is now reachable once Blocker 2 is fixed.

### Blocker 2 — ingress orphaning bug (CODE, fixable in-loop once unblocked)
`evt.*.api-gateway.messaging.*.webhook.webhook_received.v1` (TAXONOMY rule 2, `ingress`) never lands as ingress: stage-1 envelopes carry no `accountid` yet (account is resolved in stage 2), `isCompliantEnvelope` (packages/shared/src/envelope.utils.ts:372) requires it, so the T04 mapper routes the event to the drift path (rule 18 unknown) with NULL correlation_id and a synthesized event_id. Result: zero `ingress` rows in the table; every chain starts at channel-processing.
Fix sketch: treat stage-1 webhook_received as canonical-with-known-drift (subject classifies rule 2; preserve envelope correlation_id/tenant even when compliance fails on accountid only), OR relax/parameterize the compliance gate for stage-1. Ties into the documented stage-1 envelope drift (DRIFT.md). Per repo rule, the fix must ship with a regression test (webhook_received fixture → ingress row with correlation preserved).

### What was tried
Single validation run. Flow simulation worked on the first attempt; both blockers are deterministic classification outcomes, not flaky infra, so retries were pointless.

### Unblock path
1. ~~User decides the workflow-service family rule~~ DONE — rule 19 shipped (T02b).
2. Remaining: T04b — stage-1 ingress compliance fix (webhook_received without accountid must classify rule 2 `ingress` with correlation preserved) + regression test.
3. Re-run T13: with rule 19 live and T04b fixed, the full-chain criterion (>= 4 stages, unknown = 0, ingress present) is reachable.
