# SPEC — Group C: dead or lying data & config (SKB SQL layers, jobs fixture, Prometheus alerts)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: none — the E9 companion fix already shipped (`c505edf6`,
> parameterized SKB query).
> Origin: register `PENDIENTES/02-group-c.md` (user decisions 2026-08-05).
> Full evidence: `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md` and
> `manual-loops/architecture/docs-truth-audit.md` (E5, E7, E8).
> Engram topic: 'platform-cluster/pendientes-group-c'.

## Goal

Three register items where data or configuration exists but does not describe
reality. After this queue: (1) the two SKB SQL-safety layers the docs describe
are actually invoked on the executed statement path; (2) the jobs reference
fixture a new dev copies passes the real jobs contract end to end; (3) the
Prometheus consumer-lag alerts filter only on durables that exist.

## User decisions (human boundary — do not reinterpret)

1. **E8**: WIRE `validateSelectOnly()` and `enforceLimit()` into the real
   execution path — do not delete them, do not leave them doc-only. This is the
   companion of the E9 injection fix (`c505edf6`); the doc's 5-layer defense
   becomes true, not rewritten to excuse the gap.
2. **E7**: CORRECT the fixture (`data/jobs.yaml`) — it is reference data a new
   dev copies; no runtime loader is added for it (none exists today —
   `manual-loops/architecture/docs-consistency.md` confirms no code path reads
   it).
3. **E5**: DELETE the two dead consumer filters from the alerts — do not
   implement consumers to match the alert.
4. Scope discipline: fix exactly the registered item. Adjacent smells found
   while fixing get REPORTED in the task summary, never patched in the same
   commit.

## Prior art (validated 2026-08-06 — REUSE, do not duplicate)

The engine does not forward this section — citations are repeated inside each
task body.

- `services/agent-admin-service/src/modules/structured-kb/skb-sql-safety.ts` —
  the two unwired functions (`validateSelectOnly` :85-92, `enforceLimit`
  :131-153) plus the wired ones (`isSafe`, `validateWhereClause`,
  `sanitizeIdentifier`). Shared constants `MAX_LIMIT`/`DEFAULT_LIMIT` at :23-24.
- `services/agent-admin-service/src/modules/structured-kb/skb-rows.repository.ts:27-78`
  — `executeQuery`, the ONLY place the NL→SQL statement is executed
  (post-E9: `container_id`/`tenant_id`/`categories`/`limit`/`offset` are bound
  parameters; only `whereClause`/`orderBy` are spliced as text).
- `services/agent-admin-service/test/unit/structured-kb/` — existing spec
  patterns for this module, including `skb-sql-safety.spec.ts`.
- `services/agent-admin-service/src/modules/jobs/schedule.validator.ts:15,55` —
  `interval:<n>` semantics: **minutes**.
- `services/agent-admin-service/src/modules/jobs/jobs.repository.interface.ts:3-14`
  — `IJob` field names (`is_active`, `payload`, ...).
- `services/agent-ai-service/src/modules/job-executor/job-executor.service.ts:63,71-116`
  — the executor reads `payload.action_type` and switches on
  `llm_call | webhook | function | python_code | agent_task`.
- `services/agent-ai-service/src/modules/job-executor/actions/function-action.service.ts:61-83`
  — registered builtin functions: `cleanup_old_conversations`,
  `get_conversation_metrics`, `export_data`, `notify_backend`.

## Constraints (apply to every task)

- Conventional commits scoped to the touched service/area. No Co-Authored-By.
- Never weaken, skip, or delete an existing test — automatic reviewer
  rejection.
- Every fix gets a regression guard in the SAME task: a test where a runner
  exists, an executable `rg` Accept check where none does.
- TypeScript: follow the file you are editing (NestJS modules, repo naming).
  Do NOT create new shared packages or move types to `packages/shared` for
  this queue.
- **E9 non-regression**: `LIMIT`/`OFFSET` and all identifier/value parameters
  in `SKBRowsRepository.executeQuery` STAY bound as parameters. Reintroducing
  string interpolation of caller values is an automatic rejection.
- Code, comments, and docs in English.
- Tasks marked **[cluster]** end with their deploy step (rebuild-redeploy or
  manifest re-apply, as the task states) BEFORE dual review/commit — the
  cluster must never drift from the branch.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
bash scripts/checks/doc-code-guards.sh
# G1 — agent-admin-service tests (tasks touching it: T01, T02)
cd services/agent-admin-service && bun test
# G2 — agent-admin-service typecheck (T01, T02)
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
# G3 — prometheus manifests still build (T03 only)
kubectl kustomize infrastructure/base/observability/prometheus > /dev/null
# G4 — COMMIT GATE, [cluster] tasks only (once per task, after G0-G3 green):
#      run the task's stated deploy step, wait for rollout, then run the
#      cluster checks in the task's Accept.
```

Gate rules (self-contained — the engine runs THIS file verbatim; never
inherit rules by reference to another SPEC):

- PRECONDITION (before task 1): `git status --porcelain` empty.
- ALL existing unit AND integration tests of a touched service must pass,
  every task.
- Tasks not touching agent-admin-service skip G1/G2; tasks not touching the
  prometheus manifests skip G3. G0 runs for every task (`security.md` and
  `alerts.yaml` are watched by the doc guards).
- OVERRIDE for this queue: no dev-mode iteration gate (`G5a` of the canonical
  template) — this is a bug-fix queue proven by unit tests plus the G4 cluster
  step; there is no feature e2e script to run.
- A G4 deploy failure is a failed attempt like any other gate.

---

## Task queue

### T01 — E8: wire `validateSelectOnly()` and `enforceLimit()` into the executed SKB query path **[cluster]**

`skb-sql-safety.ts` exports `validateSelectOnly()` (:85-92) and `enforceLimit()`
(:131-153) — exported, tested (`test/unit/structured-kb/skb-sql-safety.spec.ts`),
never called from `src`. `DOCS/skb/security.md` presents them as Layers 2 and 5
of the 5-layer defense and admits the gap (:68-74, :132-137, table rows :284,
:288). Wire them into the real path; the E9 fix (`c505edf6`) parameterized the
query, this connects the layers the doc already promised.

Where the real path is: `SKBQueryService.query` validates the LLM fragments
(`skb-query.service.ts:308-322`, `isSafe` + `validateWhereClause`), then
`SKBRowsRepository.executeQuery` (`skb-rows.repository.ts:27-78`) assembles
`dataQuery`/`countQuery` and runs them via `sql.unsafe`.

- **`validateSelectOnly`**: call it on the final assembled `dataQuery` AND
  `countQuery` inside `executeQuery`, before `sql.unsafe` — defense-in-depth on
  the statement that actually executes. The existing service-layer checks stay
  untouched. No legit statement changes behavior: the fixed template
  (`SELECT data FROM skb_rows ...`) contains no blocked keyword (`created_at`
  does not match `\bCREATE\b`), and hostile fragments already fail the
  service-layer checks today.
- **`enforceLimit` — known trap, do not wire naively**: the executed query
  binds LIMIT/OFFSET as parameters (`LIMIT $n OFFSET $m`,
  `skb-rows.repository.ts:60-61`), so `enforceLimit`'s `\blimit\s+(\d+)\b`
  regex does NOT match the parameterized text and a naive call would APPEND a
  second `LIMIT` and break the query. Required shape: extract the numeric
  clamp from `enforceLimit` (e.g. `clampLimit(n, maxLimit)` next to it in
  `skb-sql-safety.ts`, delegating to the same `MAX_LIMIT`/`DEFAULT_LIMIT`
  constants; `enforceLimit` keeps its text contract by delegating to it) and
  apply the clamp to the limit value on the execution path. Parameters stay
  bound (E9 non-regression constraint).
- **Byte-identical invariant**: `security.md:94-97` states
  `SKBQueryService.buildSql` (`skb-query.service.ts:341,421`) builds a
  byte-identical debug string of the executed statement (stored in
  `skb_query_history`). Clamp the limit BEFORE both `executeQuery` and
  `buildSql` see it (one clamp, one value), so the invariant holds.
- **Docs (same task — the doc admissions are the register's evidence)**:
  update `DOCS/skb/security.md` Layer 2 admission (:68-74), Layer 5 admission
  (:132-137), and summary-table rows (:284, :288) to describe the real wiring.
  ALSO sanctioned here: the Layer 4 note (:117-126) and the summary line (:4)
  still describe the PRE-E9 string-concatenated `executeQuery` and an "open
  injection risk" — stale since `c505edf6`; bring them up to date with the
  parameterized reality. Nothing else in the doc changes.
- **Tests** (extend `skb-sql-safety.spec.ts`, add repository/service cases
  following the existing patterns in `test/unit/structured-kb/`):
  - `clampLimit` (or equivalent): below cap, at cap, above cap, default.
  - `enforceLimit` existing cases stay green (text contract unchanged).
  - Wiring regression: `executeQuery` with a hostile assembled statement
    throws BEFORE `sql.unsafe` is invoked (mock the sql handle); a limit above
    the cap produces an executed statement/params clamped to the cap, and the
    recorded debug `sql` matches.

**[cluster]** deploy: `./rebuild-redeploy.sh agent-admin-service dev`.

**Accept**
```
cd services/agent-admin-service && bun test && bunx tsc -p tsconfig.build.json --noEmit
rg -n "validateSelectOnly" services/agent-admin-service/src/modules/structured-kb/skb-rows.repository.ts
rg -n "not wired|NOT called from" DOCS/skb/security.md ; test $? -eq 1
bash scripts/checks/doc-code-guards.sh
./rebuild-redeploy.sh agent-admin-service dev
```

### T02 — E7: make `data/jobs.yaml` pass the real jobs contract

`services/agent-admin-service/data/jobs.yaml` is the reference fixture a new
dev copies (no code path reads it —
`manual-loops/architecture/docs-consistency.md`). It is wrong on three axes,
and the third is worse than the register recorded:

1. **Schedule unit**: `schedule: "interval:3600"` means 3600 **minutes** (60 h)
   — `schedule.validator.ts:15,55`. The job describes itself as "every hour"
   → `interval:60`.
2. **Field name**: `enabled:` — `IJob` declares `is_active`
   (`jobs.repository.interface.ts:9`; `jobs.service.ts:123,178` read it).
3. **Action contract**: the executor reads `payload.action_type`
   (`services/agent-ai-service/src/modules/job-executor/job-executor.service.ts:63`)
   and switches on `llm_call | webhook | function | python_code | agent_task`
   (:71-116); anything else throws `Unknown action type` → `execution_failed`.
   The fixture's `action: "collect_metrics"` / `action: "notify"` are wrong
   twice: wrong key AND values that are not action types at all. Rewrite both
   payloads as `function` actions using registered builtins
   (`function-action.service.ts:61-83`): metrics snapshot →
   `action_config.function: "get_conversation_metrics"`; demo notification →
   `action_config.function: "notify_backend"` (executor reads
   `action_config.function` / `action_config.parameters`, :93-99). Do NOT use
   `python_code` — it throws "not supported" by design (:23-26).
- **Regression guard** — the fixture has no runtime consumer, so give it a
  lint test it cannot rot past: new spec
  `services/agent-admin-service/test/unit/jobs/jobs-fixture.spec.ts` that
  parses `data/jobs.yaml` (Bun YAML — the suite runs under `bun test`) and
  asserts per job: no `enabled` key and `is_active` is boolean; `schedule`
  passes the real `schedule.validator`; `payload.action_type` present and a
  member of the executor's action list (hardcode the list in the test with a
  comment citing `job-executor.service.ts:71-116` — acceptable cross-service
  duplication for a fixture lint; do NOT move the contract to
  `packages/shared`, per Constraints); `function` actions name only functions
  from the builtin registry (same hardcode-with-citation approach).
- `DOCS/agents/jobs.md` references this fixture — if it reproduces the stale
  fields (`enabled`, `action`, the 3600 interval), sync it in this task.

**Accept**
```
cd services/agent-admin-service && bun test test/unit/jobs/jobs-fixture.spec.ts
cd services/agent-admin-service && bun test && bunx tsc -p tsconfig.build.json --noEmit
rg -n "enabled:" services/agent-admin-service/data/jobs.yaml ; test $? -eq 1
rg -n "action:" services/agent-admin-service/data/jobs.yaml ; test $? -eq 1
rg -n "interval:60" services/agent-admin-service/data/jobs.yaml
rg -n "action_type" services/agent-admin-service/data/jobs.yaml
```
(No cluster step: reference data + tests only; nothing deployed changes.)

### T03 — E5: drop the two dead consumer filters from the NATS lag alerts **[cluster]**

`infrastructure/base/observability/prometheus/alerts.yaml`, group
`nats-consumer-lag` (:378-412): both alert exprs (:383, :401) filter
`consumer_name` on six durables, but `webhook-dispatcher` and
`event-processor` appear in NO `DURABLE_NAME` under `services/` (verified
2026-08-06: only test fixtures and an old README mention similar names). Both
alerts silently match nothing for those two names.

- Remove `webhook-dispatcher|event-processor` from BOTH regexes; keep
  `workflow-triggers|channel-webhook-ingress|auto-reply|channel-egress`
  untouched.
- Adjacent smell — REPORT, do not patch (Constraints): the real durables
  `execution-audit` and `audit-events` exist but are NOT covered by these
  alerts; record it in the task summary as a candidate infra ticket.
- **[cluster]** deploy + proof: re-apply the observability manifests the way
  dev bring-up does (locate the overlay that includes
  `infrastructure/base/observability` — `rg -l observability
  infrastructure/local` — and `kubectl apply -k` it), restart the Prometheus
  Deployment (read its namespace from
  `infrastructure/base/observability/prometheus/deployment.yaml` / the
  overlay), then query the Prometheus API and prove the rules reloaded:
  `curl <prometheus>/api/v1/rules` (port-forward if needed) must show the
  `nats-consumer-lag` group loaded, with NO occurrence of
  `webhook-dispatcher` or `event-processor` and the four real durables still
  present in both exprs.

**Accept**
```
rg -n "webhook-dispatcher|event-processor" infrastructure/base/observability/prometheus/alerts.yaml ; test $? -eq 1
rg -n 'workflow-triggers\|channel-webhook-ingress\|auto-reply\|channel-egress' infrastructure/base/observability/prometheus/alerts.yaml
kubectl kustomize infrastructure/base/observability/prometheus > /dev/null
bash scripts/checks/doc-code-guards.sh
```
(Second check must hit exactly the two expr lines. The cluster proof — apply,
restart, `/api/v1/rules` clean — is part of this task's G4 and is quoted in the
task summary.)

---

## Progress

- [x] T01 E8 wire validateSelectOnly/enforceLimit into the executed path
  - Done 2026-08-06, 2 attempts (attempt 2 = doc-consistency objections from
    reviewer B). Gates green; G4 redeploy of agent-admin-service completed.
  - ORCHESTRATOR RULING (2026-08-06): reviewer B showed the sanctioned Layer 4
    rewrite left security.md self-contradictory about E9 — the three remaining
    stale pre-E9 spots (Multi-Tenant Isolation, Risk 3b, checklist row) were
    ruled the same sanctioned class and got minimal truth edits in attempt 2.
  - PRE-EXISTING DEBT (recorded per gate rules, NOT caused by this task): 14
    integration/e2e suites in agent-admin-service fail identically on the base
    commit (743/14 base vs 758/14 with T01) — NestJS DI rot:
    `YoizenclawTenantConnectionManager` unresolved in SystemVariables/
    ConfigFiles/etc. test modules. Candidate register entry; same class as
    Group B's E10 (suites that never run green).
  - FOLLOW-UPS (reviewer-flagged, non-blocking): comment at
    `skb-query.service.ts:331-333` still says "byte-identical" (values, not
    text); `security.md:196` "Layers 2-5 all operate on LLM output" stale
    (Layer 5 clamps caller input); `clampLimit` has no lower bound (DTO
    `@Min(1)` is the floor).
- [x] T02 E7 jobs.yaml fixture passes the real contract
  - Done 2026-08-06, 2 attempts (attempt 2 = one doc sentence: "safe to copy"
    overclaimed — fixture is still not a verbatim POST body: `id`/`description`
    keys and slug `agent_id` fail `CreateJobDto` + `forbidNonWhitelisted`).
  - Sanctioned deviation (reviewer-endorsed): extra test pinning
    `job-metrics-snapshot.schedule === "interval:60"` — `isValidSchedule`
    accepts `interval:3600` as syntactically valid, so the validator assertion
    alone cannot guard the unit-semantics axis.
  - FOLLOW-UPS (reviewer-flagged, non-blocking): lint window — a future drift
    to `action_type: "python_code"` would pass the fixture lint yet no-op at
    runtime (`function-action.service.ts:23-32` returns `{supported: false}`
    and the execution still reports completed — silent no-op success, reported
    as adjacent smell) — **RESOLVED 2026-08-07** (user ruling, post-loop):
    `python_code` removed entirely (executor case, stub, doc row, fixture
    enum, lint allowlist); regression pinned in
    `agent-ai-service/test/unit/function-action.service.spec.ts`; see
    `PENDIENTES/09-hallazgos-group-c.md` H2 (CERRADO);
    `DOCS/archive/audits/DOCS-TRUTH-LEDGER.md:947-952`
    still lists the old drift as a live finding (frozen archive, left as-is);
    `test/unit/jobs/` is the first subdir among flat jobs specs.
- [x] T03 E5 remove dead consumer filters from nats-consumer-lag alerts
  - Done 2026-08-06, 1 attempt, 2× APPROVED first review. G4 cluster proof:
    alerts ConfigMap applied to `support-services-dev`, Prometheus restarted,
    `/api/v1/rules` shows group `nats-consumer-lag` loaded with both alerts,
    all four real durables present, zero occurrences of the removed names.
  - G4 note: applying the BASE kustomization directly errors on
    `ClusterRoleBinding prometheus-discovery` (base omits the subject
    namespace by design — overlays inject it); the CRB is live and untouched,
    only the alerts ConfigMap needed the apply.
  - ADJACENT SMELL (reported per Constraints → candidate infra ticket): the
    alerts now cover 4 of 13 real durables. Uncovered: `execution-audit`,
    `audit-events`, `channel-audit`, `workflow-projector`,
    `connector-runtime-invoke`, `adapter-internal-sync`, `ingestion-worker`,
    `skb-ingestion-worker`, `ai-agent-gateway-results`. Ticket shape: broad
    match + exclusion list instead of allow-list, so new durables are covered
    by default (the exact failure mode E5 fixed). Also: the consumer list is
    hand-copied in 3 places (2 exprs + doc prose) with no guard tying them —
    doc-code-guards watch alert names, not label filters.

<!-- Progress convention: entries above grow into a changelog as tasks
complete — record findings, human-approved mid-flight design changes
("DESIGN CHANGE (human-approved <date>): ..."), bonus fixes, and
"FOLLOW-UPS (reviewer-flagged, non-blocking)" sub-lists. New tasks are
APPENDED with "Added <date> after <reason>" provenance — never renumber
existing tasks. -->

## Out of scope (explicit)

- **E23** — already closed via D34 (see `docs-truth-audit.md`); not in this
  queue.
- Adding `execution-audit` / `audit-events` to the lag alerts — real gap,
  separate infra ticket; T03 only removes lies, it does not extend coverage.
- Any runtime loader/seeder for `data/jobs.yaml` — it is reference data by
  design; making it auto-applied is a feature, not this fix.
- Moving the job action-type contract to `packages/shared` — one fixture-lint
  consumer does not justify a shared contract.
- E13 (agent-scheduler-service deployment fix) — postponed by user ruling
  2026-08-06, its own future SPEC.
- Any fix beyond the registered items; adjacent smells are reported, not
  patched.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- The E8 ruling (wire, don't delete) and the E5 ruling (delete filters, don't
  build consumers) are binding — the loop does not revisit them.
- Running the loop (`/manual-loop PENDIENTES/02-group-c.spec.md`).
