# SPEC — E3: producer token lies on the agent-ai-service status subjects

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: none.
> Origin: register `PENDIENTES/04-e3-subject.md` (T09 ruling) + user ruling
> 2026-08-07 (heartbeat `online.v1` included, closing `DRIFT.md` item 10).
> Full evidence: `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` (E3),
> `TAXONOMY.md` §4 rules 6/20, `DRIFT.md` items 5/10.
> Engram topic: 'platform-cluster/pendientes-e3-subject'.

## Goal

Subject token 2 is the producer routing key (AGENTS.md subject grammar), and
today three agent-ai-service publishers lie on it with `ai-agent-gateway`:

1. `services/agent-ai-service/src/nats-handlers/execution.handler.ts:416` —
   `publishStatus` (`execution_started/completed/failed`), the E3 item.
2. `services/agent-ai-service/src/modules/job-executor/job-executor.service.ts:273`
   — the second `publishStatus`, same subject family.
3. `services/agent-ai-service/src/modules/heartbeat/heartbeat.service.ts:96` —
   `online.v1`, tracked as `DRIFT.md` item 10 / TAXONOMY rule 20 drift note.

After this queue: every event agent-ai-service publishes rides
`evt.{tenant}.agent-ai-service.automation.platform.internal.<kind>.v1`, its
envelope `producer` says `agent-ai-service` on BOTH publish branches
(`deriveEnvelope` currently inherits `ai-agent-gateway` from the incoming
request — the envelope lies too, in the opposite direction), every consumer
follows, tracking-ingester classifies both the new and the historical subjects,
and the docs stop describing the inconsistency as "pre-existing".

`execution_requested` DOES NOT MOVE: it is published by the gateway
(`packages/shared/src/execution-client.ts:121-141`) with
`producer: ai-agent-gateway` — subject and envelope already agree.

## User decisions (human boundary — do not reinterpret)

1. **E3 (T09 ruling)**: correct the SUBJECT to match the producer — the option
   of blessing the current subject as-is was explicitly discarded.
2. **Heartbeat included (2026-08-07)**: `online.v1` moves in the same queue,
   closing `DRIFT.md` item 10. One wire migration for all agent-ai-service
   publishers.
3. Golden rule 3 (TAXONOMY §6 precedent, rule 21): classifier rule + golden
   rows land TOGETHER and AHEAD of the emitter. Tracking-ingester learns the
   new subjects in T01; the wire flips in T02.
4. Scope discipline: adjacent smells found while fixing get REPORTED in the
   task summary, never patched in the same commit.

## Prior art (validated 2026-08-07 — REUSE, do not duplicate)

- `packages/shared/src/constants.ts:168-181` — the `AI_AGENT_GATEWAY_*`
  family: `AI_AGENT_GATEWAY_PRODUCER`, `AI_AGENT_GATEWAY_SUBJECT_PREFIX`,
  `AI_AGENT_GATEWAY_EXECUTION_REQUESTED/STARTED/COMPLETED/FAILED`. Follow the
  scheduler family pattern (`:194-196`): prefix BUILT from identity constants
  so envelope fields and subject tokens cannot disagree.
- `packages/shared/src/constants.ts:127-130` — comment already states runtime
  presence heartbeats are "agent-ai's `online.v1`".
- `packages/shared/src/__tests__/agent-admin.constants.test.ts:125-141` — the
  wire-string pin test. This queue is a SANCTIONED wire change: the pins for
  `STARTED/COMPLETED/FAILED` move with the constants; `REQUESTED` stays.
- `packages/shared/src/execution-client.ts:40-44` —
  `EXECUTION_RESULT_EVENT_SUBJECTS` (started/completed/failed templates), used
  by `waitForExecutionResult` (:176-283). Built from the shared constants —
  follows the rename automatically.
- `packages/shared/src/envelope.utils.ts:199` — `deriveEnvelope` producer
  inheritance: `producer: overrides.producer ?? incoming.producer`. The two
  `publishStatus` derive branches pass NO producer override today.
- Consumers of the moving subjects (complete list, verified by repo-wide rg):
  - `services/ai-agent-gateway/src/modules/executions/executions.service.ts`
    — durable `ai-agent-gateway-results` (`:61-66`, filter at `:89-104`), SSE
    relay `streamExecutionEvents` (`:165-190`), `submitAndStream` lifecycle
    subscriptions (`:293-297`). All import the shared constants.
  - `services/agent-admin-service/src/modules/jobs/job-execution-status.consumer.ts:40-43`
    — HARDCODED strings for `execution_completed/failed` (core NATS sub).
  - `services/audit-service/src/modules/execution-audit/execution-audit.service.ts:22-58`
    — imports the shared `STARTED/COMPLETED/FAILED` constants.
  - `services/tracking-ingester-service/src/lib/classify.ts:221-230` (rule 6),
    `:408-425` (rule 20), `src/lib/consumed-by.ts:139-145` (§5 row 6).
  - `scripts/e2e/long-agent-execution.sh:1318-1356` — jq filters on
    `.producer == "ai-agent-gateway"` for requested/completed/failed.
- `services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts:20-30`
  — agent-ai's own durable filter list: `execution_requested` under the
  gateway token STAYS; the new `agent-ai-service` family must NOT be added
  (self-consumption loop).
- `services/admin-console/src/app/features/processes/trace/message-trace.component.ts:368-370`
  — one per-tenant stream captures `evt.<tenant>.>`: the move stays on-stream,
  NO stream/infra change.
- Golden addendum pattern: `golden/README.md` "synthetic rows" section;
  precedent rule 21 (TAXONOMY §6, seq 1320-1321): synthetic
  `golden/labeled.tsv` rows + matching `golden/raw/*.json` ahead of the
  emitter. Golden accuracy is pinned by
  `services/tracking-ingester-service/test/classify.golden.spec.ts`.

## Constraints (apply to every task)

- Conventional commits scoped to the touched service/area. No Co-Authored-By.
- Never weaken, skip, or delete an existing test — automatic reviewer
  rejection. The ONE sanctioned exception: the wire-string pin expectations in
  `agent-admin.constants.test.ts` (and any spec asserting the old lifecycle /
  online subjects) are UPDATED to the new wire strings. Touching the
  `REQUESTED` pin or the `AI_AGENT_GATEWAY_SUBJECT_PREFIX` pin is an automatic
  rejection.
- `execution_requested` and its constants/subjects are UNTOUCHED everywhere.
- tracking-ingester must keep accepting the OLD `ai-agent-gateway` token for
  `execution_started/completed/failed` and `online` — the 92-event golden set
  and the persisted history are frozen; relabeling existing golden rows is an
  automatic rejection. New synthetic rows are ADDED, never substituted.
- Out of scope, report only: envelope `accountid` values, event `type` strings
  (`io.yoizen.platform.runtime.*`), the `nc.publish` (core) vs `js.publish`
  (JetStream) difference between the two `publishStatus` methods, and
  `deriveEnvelope`'s default inheritance semantics in `packages/shared`
  (override producer AT THE CALL SITES only).
- No new streams, no manifest/infra changes: per-tenant INGRESS streams cover
  `evt.<tenant>.>`.
- Code, comments, and docs in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (ITERATION, every attempt, every task)
bash scripts/checks/doc-code-guards.sh
# G1 — tracking-ingester tests incl. golden accuracy (ITERATION: T01, T02)
cd services/tracking-ingester-service && bun test
# G2 — packages/shared tests (ITERATION: T02)
cd packages/shared && bun test
# G3 — agent-ai-service unit tests + build (ITERATION: T02)
cd services/agent-ai-service && bun run test:unit && bun run build
# G4 — ai-agent-gateway tests + build (ITERATION: T02)
cd services/ai-agent-gateway && bun test && bun run build
# G5 — agent-admin-service unit tests (ITERATION: T02)
cd services/agent-admin-service && bun run test:unit
# G6 — audit-service tests + build (ITERATION: T02)
cd services/audit-service && bun test && bun run build
# G7 — workflow-service unit tests (ITERATION: T02)
cd services/workflow-service && bun run test:unit
# G8 — COMMIT GATE (T02 only, once, after G0-G7 green): full suites of the
#      two services with integration tiers
cd services/agent-ai-service && bun test
cd services/agent-admin-service && bun test
```

Gate rules (self-contained — the engine runs THIS file verbatim):

- PRECONDITION (before task 1): `git status --porcelain` empty except the
  standing user-owned modifications (`.opencode/opencode.json`,
  `integrations/channels/http-fanout-telegram/manifest.yaml`) — never touch,
  stage, or revert those two.
- T01 runs G0, G1. T02 runs G0-G7 per attempt + G8 as commit gate. T03 (docs
  only) runs G0.
- ALL existing tests of a touched service must pass — no skips added.
- No dev-mode/cluster deploy gate in this queue: the flip needs six services
  rebuilt together, so deployment is a single post-queue step (see final
  section), not a per-task gate.

---

## Task queue

### T01 — tracking-ingester learns the `agent-ai-service` subjects (ahead of the emitter)

Golden rule 3: rule + golden + classifier land together, BEFORE the wire
flips. Extend, never replace:

- `src/lib/classify.ts` rule 6: `execution_started/completed/failed` classify
  as `platform`/`agent-execution` under BOTH producer tokens
  (`ai-agent-gateway` = history, `agent-ai-service` = post-E3);
  `execution_requested` stays gateway-only.
- `src/lib/classify.ts` rule 20: `online.v1` classifies as
  `platform`/`runtime-presence` (disposition `counted-not-persisted`,
  unchanged) under both tokens.
- `src/lib/consumed-by.ts` §5 row 6 mapping: lifecycle events under the
  `agent-ai-service` producer resolve to the same consumer set as today's
  gateway-token lifecycle events.
- Synthetic golden rows (labeled.tsv + `golden/raw/*.json`, per the
  `golden/README.md` addendum pattern, next free seq numbers) covering at
  minimum: new-token `execution_started`, `execution_completed`,
  `execution_failed`, `online` — labeled with the same tech/business_fn as
  their old-token twins.
- Unit specs: extend `test/classify.spec.ts` and `test/consumed-by.spec.ts`
  with the new-token cases alongside the existing old-token cases (which must
  remain untouched and passing).
- `TAXONOMY.md`: update rule 6 and rule 20 rows (§4) and §5 row 6 to state
  dual-token acceptance and cite this migration (E3, this spec).

**Accept** (after G0-G1 green):

```
# Old-token cases still covered (frozen history):
rg -n "evt\.acme\.ai-agent-gateway\.automation\.platform\.internal" services/tracking-ingester-service/test/classify.spec.ts
# New-token cases exist:
rg -n "evt\..*\.agent-ai-service\.automation\.platform\.internal\.(execution_started|execution_completed|execution_failed|online)" services/tracking-ingester-service/test
# New golden rows exist:
rg -n "agent-ai-service\.automation\.platform\.internal" golden/labeled.tsv
```

### T02 — the wire flip: constants, publishers, consumers, tests, e2e script

One atomic change — the shared constants are the single source of truth, so
publishers and constant-importing consumers flip in the same commit.

1. `packages/shared/src/constants.ts`: add `AGENT_AI_PRODUCER =
   "agent-ai-service"` and `AGENT_AI_SUBJECT_PREFIX` BUILT from identity
   constants (scheduler pattern, `:194-196`). Move the three lifecycle
   subjects to it as `AGENT_AI_EXECUTION_STARTED/COMPLETED/FAILED`; add
   `AGENT_AI_ONLINE` (`…online.v1`). `AI_AGENT_GATEWAY_PRODUCER`,
   `AI_AGENT_GATEWAY_SUBJECT_PREFIX` and
   `AI_AGENT_GATEWAY_EXECUTION_REQUESTED` stay byte-identical. Document the
   move where the old constants sat. Update `src/index.ts` exports and
   `packages/shared/README.md:200-205` table.
2. Pin test `agent-admin.constants.test.ts`: lifecycle pins move to the new
   wire strings under the new names; REQUESTED + gateway prefix pins stay.
3. agent-ai-service publishers switch to the shared constants (delete the
   hardcoded template literals):
   - `execution.handler.ts` `publishStatus`: subject from
     `AGENT_AI_EXECUTION_*`; `deriveEnvelope` branch gains
     `producer: AGENT_AI_PRODUCER`; `buildEventEnvelope` branch uses the same
     constant instead of the literal.
   - `job-executor.service.ts` `publishStatus`: identical treatment.
   - `heartbeat.service.ts`: subject from `AGENT_AI_ONLINE`; verify the
     heartbeat envelope's `producer` field equals `AGENT_AI_PRODUCER` after
     the change (subject and body must agree).
4. Consumers:
   - `executions.service.ts` (gateway): the `RESULT_SUBJECTS` durable filter,
     `streamExecutionEvents`, and `submitAndStream` lifecycle lists follow the
     renamed constants.
   - `job-execution-status.consumer.ts` (agent-admin): replace the two
     hardcoded strings with the shared constants (`buildPlatformSubject` or
     `evt.*` wildcard on the new templates, matching the file's current
     wildcard style).
   - `execution-client.ts`, audit-service: follow the constant rename —
     verify no stale identifier remains.
   - `multi-tenant-consumer.service.ts` (agent-ai): `execution_requested`
     entry UNCHANGED; the new family is NOT added (no self-consumption).
5. Tests asserting the old wire strings move to the new ones (e.g.
   `heartbeat.service.spec.ts:185`, gateway/audit specs,
   `trace-visualization.e2e.spec.ts:190-210` lifecycle fixtures —
   `execution_requested` at `:173` stays).
6. `scripts/e2e/long-agent-execution.sh`: jq producer filters —
   `completed_count`/`failed_count` expect `agent-ai-service`;
   `requested_count` keeps `ai-agent-gateway`; fix the `:1318-1320` comment.
7. Durable-consumer migration check: read
   `packages/database/src/multi-tenant-consumer-manager.ts` and determine
   whether an existing durable's `filterSubjects` change is applied
   (update-or-recreate) or silently kept. REPORT the answer + the operational
   consequence for the stale `ai-agent-gateway-results` durables in the task
   summary — do not add migration code unless the manager already errors.

**Accept** (after G0-G7 green, before G8):

```
# No agent-ai-service publisher builds a gateway-token subject anymore:
rg -n "ai-agent-gateway\.automation\.platform\.internal\.(execution_started|execution_completed|execution_failed|online)" services packages sdk scripts --glob '!node_modules' --glob '!services/tracking-ingester-service/**' --glob '!*.md'
# ^ expected: ZERO hits (tracking-ingester keeps old-token acceptance; docs are T03).
# execution_requested untouched:
rg -n "AI_AGENT_GATEWAY_EXECUTION_REQUESTED" packages/shared/src/constants.ts packages/shared/src/execution-client.ts
git diff --stat -- 'services/agent-ai-service/src/modules/nats-consumer/multi-tenant-consumer.service.ts'
# ^ expected: no diff on the consumer filter file, or diff shows no new family added.
```

### T03 — docs truth sweep: the inconsistency is no longer "pre-existing"

Update every live document that records the old subjects or the drift as
current fact. Code decides; the ledger/archive stays frozen.

- `DOCS/architecture/runtime-streaming.md`: the `:67` subject line, the
  `:129-139` table + "pre-existing inconsistency" callout — now resolved (this
  spec), `rt.` rationale updated accordingly.
- `DRIFT.md`: item 10 marked RESOLVED (per the file's own convention for
  closed items) citing this spec/commits; item 5's trailing heartbeat notes
  re-checked against the new reality.
- `TAXONOMY.md`: remaining prose OUTSIDE the §4/§5 rows already updated in T01
  — §2 family rows (`agent-execution`, `runtime-presence` at `:65,:73`), §5
  consumer table `:246`, §6 open-decision `:277` narrative gains a
  post-scriptum (do not rewrite history), rule 21's `:141` cross-reference.
- Sweep and fix stale statements in: `DOCS/messaging/ingress.md:236-245`,
  `DOCS/messaging/service-bus.md:214,310`, `DOCS/agents/execution.md`,
  `DOCS/agents/long-running-executions.md`, `DOCS/channels/telegram-sequence.md`,
  `DOCS/guides/*` hits, `skills/envelope-messages/SKILL.md` +
  `assets/envelope-schema.json`, `fixtures/bus-events/README.md`,
  `services/agent-ai-service/README.md`, `services/ai-agent-gateway/README.md`,
  `services/audit-service/README.md`, `sdk/README.md`,
  `scripts/e2e/README.md`, `SCHEMAS.md` — only where they state the OLD
  lifecycle/online subjects or the drift as current; `execution_requested`
  mentions stay.
- DO NOT touch: `DOCS/archive/**` (frozen ledgers), `golden/**` raw captures,
  `manual-loops/**` (historical run records), `PENDIENTES/04-e3-subject.md`
  (register closes at queue end).

**Accept** (after G0 green):

```
# No LIVE doc still presents the old lifecycle/online subjects as current:
rg -ln "ai-agent-gateway\.automation\.platform\.internal\.(execution_started|execution_completed|execution_failed|online)" DOCS packages/shared/README.md skills fixtures sdk/README.md SCHEMAS.md TAXONOMY.md DRIFT.md --glob '!DOCS/archive/**'
# ^ expected: only files whose remaining mentions are explicitly historical
#   (migration notes citing this spec). Reviewer judges each remaining hit.
rg -n "pre-existing inconsistency" DOCS/architecture/runtime-streaming.md
# ^ expected: zero hits.
```

---

## Progress

- [x] T01 — tracking-ingester dual-token rules + synthetic goldens + TAXONOMY rows (2026-08-07, gates green, 2× APPROVED first attempt)
- [ ] T02 — wire flip: constants, publishers, consumers, tests, e2e script
- [ ] T03 — docs truth sweep (runtime-streaming, DRIFT item 10, TAXONOMY prose, guides)

## Post-queue (operator, outside the loop)

Rebuild + redeploy together: `agent-ai-service`, `ai-agent-gateway`,
`agent-admin-service`, `audit-service`, `tracking-ingester-service`,
`workflow-service`. Apply the T02 finding about stale
`ai-agent-gateway-results` durables (delete/recreate if the manager does not
update filters). Register `PENDIENTES/04-e3-subject.md` closes after live
verification.
