# SPEC — Workflow step telemetry (execution_started + per-action events)

> Task queue for the `/manual-loop` command. PREREQUISITE of `manual-loops/run-view.md`.
> Origin: user decision 2026-07-11 (Cowork session, run-view design).
> Engram topic: `tracking/workflow-step-events`. Visual consumer contract:
> `cowork/DESIGN-run-view.md`.

## Goal

workflow-service becomes observable at step level. Today it emits ONLY
`execution_completed`; conditions, forks and internal actions are silent. After
this change every run emits:

1. `execution_started` — when the Temporal workflow begins (closes the known gap:
   run duration is currently inferred from first/last event).
2. `action_started` / `action_completed` per action — with `action_index`,
   `action_type`, `action_name`, and for artifact calls the instance reference
   (`connector_id` / `agent_id`).
3. `condition_evaluated` per condition/if — payload `{ expression,
   evaluated_value, branch_taken, cases }`. This powers the run view's
   "evaluó: 320 → caso 100–500".
4. Fork/join actions emit their `action_started/completed` like any action
   (`action_type: fork|join`), with `branch` labels on child actions.

Free ride: `_started`/`_completed` pairs make `tracking.tracked_event_spans`
produce per-step `duration_ms` with ZERO changes to the pairing SQL.

## User decisions (human boundary — do not reinterpret)

1. Golden rule 3 applies LITERALLY: new event kinds = TAXONOMY.md rule + golden
   set examples + classifier updated IN THE SAME COMMIT as the emitter. A task
   that adds an event without its rule+golden must be rejected by reviewers.
2. Events ride the existing envelope contract (deriveEnvelope/causal snapshot):
   same `correlation_id`, `causation_id` = the event that caused this step,
   `depth` incremented per hop. No new transport.
3. `condition_evaluated` carries the evaluated VALUE (e.g. `320`), not the full
   variable scope. Full variable snapshots are out of scope (payload weight).
4. Naming follows the existing platform kind conventions (`execution_requested/
   started/completed/failed` precedent from agent-execution, TAXONOMY rule 6).

## Constraints (apply to every task)

- Emission happens in the Temporal workflow/activity layer of workflow-service
  (`src/temporal/workflows.ts` + activities), using the existing publisher and
  `causal` snapshot plumbing (`workflows.service.ts:299-347` precedent). NEVER
  a second publish path.
- Determinism: Temporal workflow code must stay deterministic — publishes go
  through activities (side effects), never inline in workflow code.
- Anti-loop: respect `MAX_DEPTH_BY_CATEGORY` (`envelope.utils.ts`) — step events
  increment depth; verify the ceiling accommodates the deepest realistic
  definition (condition inside fork inside condition) and document the math.
- Volume guard: step events are emitted for EVERY run. Measure the event-count
  multiplier on the e2e flow (was 3 events, will be ~3+2n) and record it in the
  task report; if a run would exceed 100 step events, cap with a `truncated`
  marker event rather than unbounded emission.
- TAXONOMY.md is EDITABLE in this queue (that is the point) — but only by the
  rule-3 triple (rule + golden + classifier together).
- Existing tests never weakened. Verbose logging.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/workflow-service && bun test
G2  cd services/workflow-service && bunx tsc -p tsconfig.json --noEmit
G3  cd services/tracking-ingester-service && bun test        # golden gate >=90% ALWAYS
G4  cd services/tracking-ingester-service && bunx tsc -p tsconfig.json --noEmit
G5a ITERATION — as in manual-loops/trace-console.md (dev-mode workflow-service,
    deps sha-check, e2e per attempt).
G5b COMMIT GATE — as in manual-loops/trace-console.md (dev-mode off +
    rebuild-redeploy of touched services + e2e on built image).
```

Gate rules: identical to `manual-loops/trace-console.md`. NOTE G3 runs from T01:
taxonomy/classifier/golden move together with the emitter, so the ingester suite
is a permanent gate of this queue.

---

## Task queue

### T01 — Taxonomy + classifier + golden for the new kinds (judge first)

Following golden rule 3, land the REGLAMENTO before the emitter:

- `TAXONOMY.md`: extend the workflow-execution rule (rule 19 area) to cover
  kinds `execution_started`, `action_started`, `action_completed`,
  `condition_evaluated` under `business_fn: workflow-execution`, `tech: platform`.
  Document the `action_index`/`action_type` payload fields and the
  condition_evaluated payload contract.
- Classifier: recognize the new kinds (subject shapes per existing
  workflow-service subject conventions).
- `golden/labeled.tsv`: add labeled synthetic examples for each new kind
  (following `lab/expected.tsv` conventions if present) — enough rows that a
  classification regression on these kinds drops accuracy below the gate.
- `fixtures/`: envelope fixtures for each kind (used by T02/T03 tests).

**Accept**
```
cd services/tracking-ingester-service && bun test
grep -n "condition_evaluated" TAXONOMY.md
```

### T02 — execution_started emitter

- Emit `execution_started` from the Temporal workflow start path (via activity),
  with the run's `causal` snapshot: causation = the trigger/canonical event,
  correlation preserved, `workflow_id`/`run_id` in payload (they already flow —
  see `workflows.service.ts:299-301` id scheme).
- Unit tests with the fixture from T01; assert envelope compliance
  (`isCompliantEnvelope`) and causal fields.
- e2e check: after this task, `scripts/e2e-http-workflow.sh` chain must contain
  `execution_started` AND the spans view must pair it with `execution_completed`
  producing `duration_ms > 0` for the workflow itself (extend the chain-assert
  stage accordingly — this REPLACES the agent-workaround need from
  trace-console T09 for workflow spans).

**Accept**
```
cd services/workflow-service && bun test
./scripts/e2e-http-workflow.sh
```

### T03 — action_started / action_completed emitters

- Wrap each action execution in the Temporal workflow with start/complete
  emission (via activities), payload: `action_index`, `action_type`
  (`http_call|agentCall|sendMessage|setVariable|condition|fork|join|...` from
  the definition), `action_name`, `branch` label when inside a fork/condition
  branch, instance refs (`connector_id`, `agent_id`) when applicable, `status`
  (`ok|failed|skipped`) on completed.
- Failed actions emit `action_completed` with `status: failed` + error class
  (no stack traces in payload).
- Depth math documented + tested (constraint above).
- Unit tests per action type incl. nested branch labels.

**Accept**
```
cd services/workflow-service && bun test
cd services/tracking-ingester-service && bun test
```

### T04 — condition_evaluated emitter

- On every condition/if evaluation: emit with `{ expression, evaluated_value,
  branch_taken, cases: [labels] }`. `evaluated_value` is the scalar/short value
  only (decision 3) — truncate to 256 chars with `truncated: true` flag.
- If without else evaluating false → `branch_taken: null`, plus the
  `action_completed(status: skipped)` of the skipped branch actions is NOT
  emitted (not executed = no event; the run view gets skipped steps from the
  DEFINITION, not from events).
- Unit tests: multi-case, if-without-else, nested condition inside fork branch.

**Accept**
```
cd services/workflow-service && bun test
cd services/tracking-ingester-service && bun test
```

### T05 — Cluster verification + volume measurement

- Extend `scripts/e2e-http-workflow.sh` chain assertions: expect
  `execution_started`, `action_started/completed` pairs for each action of the
  e2e workflow, correct `action_index` ordering, and at least one
  workflow-level span with `duration_ms > 0`.
- Measure and report the event multiplier (events per run before/after) in the
  task report; assert the e2e run stays under the 100-step cap.

**Accept**
```
./rebuild-redeploy.sh workflow-service dev
./scripts/e2e-http-workflow.sh
```

### T06 — Docs + index

- `services/workflow-service/README.md`: step-event contract (kinds, payloads,
  depth math, volume cap).
- `SCHEMAS.md`: new event kinds registered where the envelope inventory lives.
- `cowork/INDEX.md` entry + decision cuádruple (engram topic
  `tracking/workflow-step-events`).

**Accept**
```
grep -n "condition_evaluated" services/workflow-service/README.md SCHEMAS.md
grep -n "workflow-step-events" cowork/INDEX.md
```

---

## Progress

- [ ] T01 taxonomy + classifier + golden (judge first)
- [ ] T02 execution_started
- [ ] T03 action_started/completed
- [ ] T04 condition_evaluated
- [ ] T05 cluster verification + volume
- [ ] T06 docs + index

## Out of scope (explicit)

- The run view itself (`manual-loops/run-view.md`, depends on this).
- Full variable-scope snapshots in condition events (decision 3).
- Backfilling step events for historical runs (events start at deploy time;
  the run view must degrade gracefully for older runs — that requirement lives
  in the run-view SPEC).
- Any change to Temporal workflow logic beyond emission.

## Human boundaries for this change

- Approving this SPEC (especially the naming and the volume cap).
- Any new business_fn value (none expected — everything stays under
  workflow-execution; if the loop concludes otherwise, STOP and escalate).
- Golden set labeling review (per project convention, golden edits are
  human-auditable — the loop adds rows, the human can veto in review of T01).
