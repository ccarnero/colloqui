# SPEC — Group C findings: repair the DI-rotted suites, invert the lag-alert pattern

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `PENDIENTES/`.
> Depends on: `PENDIENTES/02-group-c.spec.md` (shipped, 3/3) — H2 of the
> register was already closed separately (`e547048e`, python_code removal).
> Origin: register `PENDIENTES/09-hallazgos-group-c.md` (H1 + H3, found
> 2026-08-06 running the Group C loop; H2 excluded — closed).
> Engram topic: 'platform-cluster/pendientes-group-c'.

## Goal

Close the two open findings from the Group C run: (1) the 14
integration/e2e suites of agent-admin-service run green again, restoring an
honest "all tests pass" gate for every future loop touching that service;
(2) the NATS consumer-lag alerts cover every real durable by default — a new
durable is born monitored, and dead names can never silently return.

## User decisions (human boundary — do not reinterpret)

1. **H1**: REPAIR the suites, do not delete or skip them. The mock-based
   design of the integration suites is their established character — keep it;
   this is DI-token retargeting, not a rewrite. **Amended 2026-08-07 after the
   T01 block**: repair applies to tests of features that EXIST; see ruling 4
   for the phantom suites, and the T01a/T01b/T01c re-scope (human-approved
   2026-08-07).
2. **H3**: INVERT the alert pattern — broad match with an exclusion list, per
   the register's ticket shape. Do not return to a hand-enumerated allow-list.
3. Scope discipline: fix exactly the registered finding. Adjacent smells found
   while fixing get REPORTED in the task summary, never patched.
4. **Credentials/channels ruling (user, 2026-08-07 — Option B): RETIRE the
   phantom tests.** `/admin/credentials` and `/admin/channels` are not this
   service's features and are not being built here. The 18 tests exercising
   them are formally retired (T01c) — this ruling is the explicit sanction
   that unlocks the "never delete tests" constraint for EXACTLY those tests,
   nothing else. The security contract they encoded is rescued to a doc
   before deletion.
5. **Run order (human-approved 2026-08-07)**: T02 → T01c → T01a → T01b.
6. **T01d authorized (user, 2026-08-07)**: the agents-DTO implicit-conversion
   data loss surfaced by T01a's first real run of `POST /admin/agents` is
   fixed as its own product task — `@Type(() => Object)` on the six untyped
   object-array fields of `agents.dto.ts` (Create + Update:
   `channels`, `input_variables`, `output_variables`). T01a's red
   create-agent e2e test is the regression guard; T01d commits BEFORE T01a
   (fix first, then the harness whose gate it turns green). The shared
   `enableImplicitConversion` trap in other services is registered as a
   finding, NOT patched here.

## Prior art (validated 2026-08-07 — REUSE, do not duplicate)

Citations repeated inside the task bodies (the engine forwards only tasks +
Constraints).

- `services/agent-admin-service/test/integration/agents.integration.spec.ts:15,20-38`
  — the rot in one frame: overrides `TenantConnectionManager` (from
  `@yoizen/database`) while the modules inject the
  `YoizenclawTenantConnectionManager` token
  (`src/providers/tenant-connection-manager.ts:8`).
- `services/agent-admin-service/test/e2e/setup.ts` — testcontainers-based e2e
  bootstrap (GenericContainer).
- `PENDIENTES/02-group-c.spec.md` Progress T03 — the cluster-apply pattern for
  Prometheus: base kustomization's ClusterRoleBinding has no subject namespace
  (overlays inject it); apply errors on the CRB while the ConfigMap lands —
  only the alerts ConfigMap needs applying to `support-services-dev`.
- `scripts/checks/doc-code-guards.sh` — guard suite the new H3 guard joins;
  bash 3.2 patterns per `scripts/reset/purge-temporal.sh:554` (while-read).

## Constraints (apply to every task)

- Conventional commits scoped to the touched service/area. No Co-Authored-By.
- Never weaken, skip, or delete an existing test or assertion — automatic
  reviewer rejection. Retargeting a DI override token is repair; loosening an
  `expect` is weakening.
- Every fix gets a regression guard in the SAME task: the repaired suites ARE
  the guard for T01; the new doc-code-guards check is the guard for T02.
- Shell edits stay **bash 3.2 compatible** (macOS `/bin/bash`): no `mapfile`,
  no associative arrays; follow the while-read pattern in
  `scripts/reset/purge-temporal.sh:554`. Keep existing `set` flags.
- TypeScript: follow the file you are editing. No new shared packages.
- Code, comments, and docs in English.
- Tasks marked **[cluster]** end with their stated deploy step BEFORE dual
  review/commit — the cluster must never drift from the branch.
- If a repaired suite exposes a real product bug too large for one attempt,
  STOP the task and report — do not absorb unrelated fixes.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 ITERATION — repo guards (every attempt)
bash scripts/checks/doc-code-guards.sh
# G1 ITERATION — agent-admin-service full suite (T01; MUST be 0 fail — the
#                14-failure waiver from 02-group-c.spec.md dies with T01)
cd services/agent-admin-service && bun test
# G2 ITERATION — agent-admin-service typecheck (T01)
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
# G3 ITERATION — T02 only: manifests build + guard script syntax
kubectl kustomize infrastructure/base/observability/prometheus > /dev/null
bash -n scripts/checks/doc-code-guards.sh
# G4 COMMIT GATE — [cluster] tasks only: the task's stated deploy step, then
#                  its cluster checks, once per task after G0-G3 green.
```

Gate rules (self-contained):

- PRECONDITION (before each task): `git status --porcelain` empty.
- T02 does not run G1/G2 unless its diff touches agent-admin-service; the
  T01x tasks do not run G3.
- **0-fail staging (re-scope 2026-08-07)**: the `bun test` **0 fail** endgame
  is T01b's Accept. Interim tasks (T01c, T01a) must STRICTLY REDUCE the
  full-suite fail count and never introduce a new failure — record the
  before/after counts in each task summary.
- A G4 failure is a failed attempt like any other gate.

---

## Task queue

### T01 — RE-SCOPED 2026-08-07 (human-approved) into T01c/T01a/T01b below

> Kept for provenance. The single-task form was BLOCKED (see `BLOCKED.md`):
> its `0 fail` Accept contained a product decision no implementer could make.
> Ruling 4 resolved it; the body below remains the evidence base the three
> subtasks cite. Run order per ruling 5: T02 → T01c → T01a → T01b.

#### Original body (evidence, still valid)

`cd services/agent-admin-service && bun test` fails 14 tests across the
integration and e2e suites ON THE BASE COMMIT — NestJS cannot build the test
modules: `Nest can't resolve dependencies of the SystemVariablesService (?)`,
`... of the ConfigFilesMongoRepository (?)` — the missing argument is always
`YoizenclawTenantConnectionManager`. Failing files: `test/integration/`
(`agents`, `config-files`, `jobs`) and `test/e2e/` (`agents`,
`credentials-security`, `health`, `multi-tenancy`, `nats-events`). Each file
also cascades a `TypeError: undefined is not an object (evaluating
'app.close')` in `afterAll` — an artifact of the module never building.

Root cause (verified, one frame): the suites override the WRONG TOKEN.
`agents.integration.spec.ts:15,20-38` mocks `TenantConnectionManager` imported
from `@yoizen/database`, but the service's modules inject the
`YoizenclawTenantConnectionManager` class token
(`src/providers/tenant-connection-manager.ts:8`) — the suites predate that
migration and were never re-run (this is the E10 failure class: suites nobody
executes).

- Retarget/extend each failing suite's `Test.createTestingModule` overrides to
  the token(s) the modules actually inject today. Audit the OTHER overridden
  tokens in the same files (`LAZY_NATS`, `NatsPublisher`, etc.) for the same
  rot while you are in there — same-class, same-file fixes are in scope.
- The mock-based design is the suites' established character (user decision 1)
  — keep the mocks, retarget the tokens. The e2e suites bootstrap via
  `test/e2e/setup.ts` (testcontainers); Docker is available — if a suite
  legitimately needs its container, let it run, do not stub it out.
- Do NOT weaken or delete a single assertion. If a suite, once it builds,
  fails on a REAL product bug (not test rot), STOP and report per Constraints.
- Small mechanical rot uncovered by the suites finally running (renamed
  symbols, moved imports) is in scope; product-behavior changes are not.

**Accept**
```
cd services/agent-admin-service && bun test
cd services/agent-admin-service && bun test 2>&1 | rg " 0 fail"
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
```
(No cluster step: test-only changes expected. If the fix somehow requires a
src change, flag it in the summary — the orchestrator adds
`./rebuild-redeploy.sh agent-admin-service dev` before review.)

### T02 — H3: invert the consumer-lag alert pattern and add the durable guard **[cluster]**

After 02-T03 the two exprs of `nats-consumer-lag`
(`infrastructure/base/observability/prometheus/alerts.yaml:383,401`) honestly
enumerate 4 durables — but the platform has 13 (register H3 lists them). The
allow-list pattern means every new durable is born UNMONITORED — the exact
failure mode E5 fixed. User decision 2: invert it.

- **Both exprs**: replace the `consumer_name=~"<allow-list>"` matcher with the
  broad form — every consumer alerts by default, minus an explicit exclusion
  matcher (`consumer_name!~"<excluded>"`) ONLY if something must be excluded.
  Start the exclusion list EMPTY unless the implementer finds a durable whose
  lag is by-design (document any exclusion with a YAML comment naming why).
  Thresholds and `for:` durations stay as they are.
- **Guard (the regression guard for this task)**: new check in
  `scripts/checks/doc-code-guards.sh`, following its existing check/pass/fail
  conventions and bash 3.2 rules: every literal consumer name appearing in a
  `consumer_name` matcher in `alerts.yaml` must exist as a real durable under
  `services/` (rg for the durable-name declarations). This makes E5's bug
  class — dead names in alert filters — a CI failure, and it guards the
  exclusion list from day one.
- **Doc sync**: `DOCS/architecture/observability.md` §4.2 — the "Monitored
  consumers" prose and the expression cell move from the 4-name list to the
  inverted pattern ("all JetStream consumers by default, exclusions listed
  here"). Keep it minimal and true.
- **[cluster]** deploy + proof (the 02-T03 pattern): pipe
  `kubectl kustomize infrastructure/base/observability/prometheus` into
  `kubectl apply -n support-services-dev -f -` (the ClusterRoleBinding row
  errors for lack of subject namespace — known, harmless: the CRB is live and
  untouched; the alerts ConfigMap is what must land), `kubectl rollout restart
  deploy/prometheus -n support-services-dev`, wait for rollout, then via
  port-forward assert on `/api/v1/rules`: group `nats-consumer-lag` loaded,
  both alerts present, and the expr text shows the inverted matcher (no
  allow-list enumeration).

**Accept**
```
rg -n "consumer_name" infrastructure/base/observability/prometheus/alerts.yaml
rg -n "workflow-triggers\|channel-webhook-ingress" infrastructure/base/observability/prometheus/alerts.yaml ; test $? -eq 1
kubectl kustomize infrastructure/base/observability/prometheus > /dev/null
bash -n scripts/checks/doc-code-guards.sh
bash scripts/checks/doc-code-guards.sh
/bin/bash -n scripts/checks/doc-code-guards.sh
```
(Second check proves the allow-list enumeration is gone from the exprs. The
cluster proof — apply, restart, `/api/v1/rules` shows the inverted matcher —
is this task's G4, quoted in the task summary.)

### T01c — retire the phantom credentials/channels tests (ruling 4)

Added 2026-08-07 after the T01 block (human-approved re-scope). USER RULING
(Option B, 2026-08-07): `/admin/credentials` and `/admin/channels` are not
this service's features — the tests exercising them are formally retired.
This ruling is the EXPLICIT SANCTION overriding the "never delete tests"
constraint for exactly these tests. Surgical scope — one file dies, two get
edited:

- **Delete** `test/e2e/credentials-security.e2e.spec.ts` entirely — its 13
  tests are 100% phantom (`/admin/credentials` CRUD + rotation + a
  `credential.rotated` event `NatsPublisher` does not define).
- **Edit** `test/e2e/multi-tenancy.e2e.spec.ts` — remove ONLY the tests
  hitting `/admin/credentials` (:266) and `/admin/channels` (:311); every
  other test stays byte-identical (they are repaired later, in T01a/T01b —
  do NOT touch them even if red).
- **Edit** `test/e2e/nats-events.e2e.spec.ts` — remove ONLY the
  credential-related tests (create/update/rotate); the rest stays
  byte-identical.
- **Rescue the contract BEFORE deleting**: new doc
  `DOCS/agents/credentials-security-contract.md` recording what the retired
  suite encoded — the `value` field never appears in ANY response (list,
  single, create, update), rotation emits an event, accepted credential
  types — plus the ruling (Option B, 2026-08-07) and a pointer to this SPEC.
  If credentials ever gets built (here or elsewhere), that doc is its
  ready-made security spec.
- Record before/after full-suite fail counts in the task summary (gate rule:
  strict reduction, no new failures).

**Accept**
```
test ! -f services/agent-admin-service/test/e2e/credentials-security.e2e.spec.ts
rg -rn "admin/credentials|admin/channels" services/agent-admin-service/test ; test $? -eq 1
rg -n "value" DOCS/agents/credentials-security-contract.md
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
cd services/agent-admin-service && bun test 2>&1 | tail -4
```
(Last command is evidence for the fail-count reduction, not a 0-fail gate.)

### T01a — repair the repairable e2e suites (health + agents + the T01c survivors)

Added 2026-08-07 after the T01 block (human-approved re-scope). Repairs
layers 1-4 of the rot in `test/e2e/` — the attempt already PROVED this
recipe on `health` (10 pass standalone before the protocol revert):

- **DI token**: overrides target `TenantConnectionManager`
  (`@yoizen/database`) but modules inject `YoizenclawTenantConnectionManager`
  (`src/providers/tenant-connection-manager.ts:8`) — retarget, and audit
  sibling overrides (`LAZY_NATS`, `NatsPublisher`) for the same rot.
- **Eager NATS**: `jetStreamManagerProvider` dials the broker at `app.init()`
  (`src/providers/nats.provider.ts:175-185`) — override `LAZY_NATS`.
- **HTTP platform**: suites call `createNestApplication()` (Express); the
  service is Fastify. Precedent:
  `services/agent-memory-service/test/e2e/agent-tools.controller.e2e-spec.ts:172,180`.
- **Testcontainers**: default wait strategy hangs; bun rejects
  `beforeAll(fn, ms)`. Repo pattern: `setDefaultTimeout` +
  `Wait.forLogMessage` (`services/connector-admin/test/integration/setup.ts:112-118`).
  Docker IS available — let real containers run, do not stub them.
- **Schema drift**: `test/e2e/setup.ts` `SCHEMA_SQL` predates
  `knowledge_base_ids`, `input_variables`, `output_variables`,
  `enabled_tools`, `agent_versions` — align with the canonical
  `initAgentAdminTenantSchema`, and pin the e2e engine to postgres explicitly
  (do not rely on `test/setup-env.ts`'s mongo default).
- Scope: `e2e/health`, `e2e/agents`, and the surviving tests of
  `e2e/multi-tenancy` + `e2e/nats-events`. ValidationPipe parity with
  production (`packages/observability/src/bootstrap-fastify.ts:45-51`) where
  a suite asserts 400s. Zero assertion changes. A suite failing on a REAL
  product bug once it builds → STOP and report.
- KNOWN ISSUE to solve, not dodge: `bun test` runs all files in ONE process
  and `STORAGE_ENGINE` binds at import time (`providers.module.ts:24`) — the
  e2e fix must coexist with the mongo-pinned integration suites in a full
  `bun test` run (isolate via module-registry hygiene, per-file bootstrap, or
  whatever the codebase supports — prove it with the full-suite run).

**Accept**
```
cd services/agent-admin-service && bun test test/e2e 2>&1 | rg " 0 fail"
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
cd services/agent-admin-service && bun test 2>&1 | tail -4
```
(Full-suite count must show only the integration failures remaining — strict
reduction vs T01c's count, no new failures.)

### T01b — repair the integration suites with an in-memory persistence fake

Added 2026-08-07 after the T01 block (human-approved re-scope). The endgame:
`test/integration/{agents,config-files,jobs}` (57 tests). Their mock "SQL
connection" (`{unsafe: (v) => v, json: JSON.stringify}`) cannot back a real
repository — `sql.unsafe("INSERT ...")` returning the SQL string breaks every
create/read assertion once modules build.

- Build the fake at the **repository-token seam** (engine-agnostic, the
  cheapest honest seam — user decision 1 keeps the mock-based character):
  override the repository providers with in-memory implementations honoring
  the `IJobsRepository` / agents / config-files interfaces.
- ValidationPipe parity with production
  (`packages/observability/src/bootstrap-fastify.ts:45-51`) — the suites
  assert 400s from `forbidNonWhitelisted`.
- Zero assertion changes. A REAL product bug surfaced by a finally-running
  suite → STOP and report.
- This task closes the queue: the 14-failure debt recorded in
  `02-group-c.spec.md` Progress dies here.

**Accept**
```
cd services/agent-admin-service && bun test
cd services/agent-admin-service && bun test 2>&1 | rg " 0 fail"
cd services/agent-admin-service && bunx tsc -p tsconfig.build.json --noEmit
```

---

## Progress

- [~] T01 — RE-SCOPED 2026-08-07 into T01c/T01a/T01b (human-approved; ruling
  4 resolved the block — see `BLOCKED.md`, entry closed). Not run as-is.
- [x] T02 H3 invert lag-alert pattern + durable guard (ran FIRST per ruling 5)
  - Done 2026-08-07, 1 attempt, 2× APPROVED. Exprs inverted to matcher-less
    (`jetstream_consumer_num_pending > 500` / `..._ack_pending > 200`),
    exclusion list starts EMPTY; new G15 guard derives the durable universe
    from code (22 names, 4 declaration shapes, services/ + packages/) and
    fails on any dead name in a matcher. G4 cluster proof: CM applied,
    Prometheus restarted, `/api/v1/rules` shows both alerts with zero
    consumer_name matchers; G15 live-proven to fail on `ghost-consumer`.
  - ORCHESTRATION INCIDENT (recorded): during the live G15 proof the
    orchestrator ran `git checkout -- alerts.yaml`, wiping the implementer's
    uncommitted edit; recovered byte-exact from the implementer's scratchpad
    backup (idempotent `kubectl apply` → "unchanged" proved parity). Rule for
    future live-proofs on uncommitted trees: `cp` backup + restore, never
    `git checkout`.
  - FINDINGS (reviewer/implementer, non-blocking): register's "13 durables"
    undercounts — 22 declared names (context-dependent counts, both true);
    `channel-processor` const possibly dead; usage-aggregator durable names
    are env-overridable (guard validates compiled defaults only); no promtool
    in CI (PromQL validity unchecked beyond kustomize build); alerts.yaml:391
    comment says "services/" where guard scans services/+packages/ (cosmetic).
- [x] T01c retire phantom credentials/channels tests (ruling 4, Option B)
  - Done 2026-08-07, 2 attempts (attempt 2 = doc fix: C6 had invented the
    literal `x-tenant-id`; real `TENANT_HEADER` is `x-yoizen-tenant`). 18
    tests retired (13 + 2 + 3, incl. the mixed-workflow test removed whole —
    reviewer-endorsed: it exercised the phantom API), contract rescued to
    `DOCS/agents/credentials-security-contract.md` (RECORD). Fail count
    14 → 12, survivors byte-identical.
  - FOLLOW-UPS (non-blocking): `sdk/GROWTH-PLAN.md:84` still lists the
    retired suite (stale, follow-up docs task); `test/e2e/setup.ts` still
    creates/truncates `credentials`/`channels` tables (dead schema — T01a
    touches that file and may clean it if in scope); codegraph index carries
    phantom route symbols until reindex; multi-tenancy's "Tenant B cannot
    modify Tenant A agent" test is a no-op (builds app, asserts nothing) —
    T01a/T01b territory.
- [x] T01d agents.dto.ts @Type fix (added 2026-08-07 after T01a exposed live
  data loss — ruling 6; committed before T01a)
  - Done 2026-08-07, 1 attempt, 2× APPROVED. Six `@Type(() => Object)` on
    Create/Update × channels/input_variables/output_variables, leveled to the
    `tools` pattern. TDD: new `agents.dto.transform.spec.ts` (8 tests,
    production pipe options, generic sweep auto-discovering untyped
    object-array fields) written red-first; mutation-proven by the
    orchestrator (decorator removed → 4 fail naming the field → restored).
    Full suite 802/7 → 811/6. G4: agent-admin-service rebuilt+redeployed.
  - PLATFORM FINDING (registered, NOT patched — scope): the same
    `enableImplicitConversion` + untyped-object-array trap exists potentially
    in every service using `withValidationPipe: true` → candidate register
    entry for a platform-wide sweep.
- [x] T01a repair e2e suites: health + agents + T01c survivors
  - Done 2026-08-07, 1 attempt + STOP-and-report round (the stop surfaced the
    T01d product bug; after T01d landed, Accept went green). 2× APPROVED.
    e2e 35 pass / 0 fail; full suite 811 pass / 6 fail (integration only).
    Layers fixed: DI retarget, LAZY_NATS, Fastify + production ValidationPipe
    parity, testcontainers Wait.forLogMessage, canonical schema via
    `initAgentAdminTenantSchema` (dup SCHEMA_SQL deleted), DB-per-tenant,
    engine pin via `bunfig.toml` preload (empirically proven: bunfig
    `[test].preload` MERGES with CLI `--preload`; 29 fail without pin, 6
    with; `test:unit` 776/0 unpoisoned).
  - FOLLOW-UPS (reviewer-flagged, non-blocking): multi-tenancy's "Tenant B
    cannot modify Tenant A agent" is still vacuous (pre-existing; needs a
    real PUT + 404 or retirement); nats-events still asserts mock-fabricated
    envelopes (pre-existing smell, marginally improved by the
    signature-parity fix); ValidationPipe options are parity-by-copy —
    extracting the options object from packages/observability would kill the
    duplication; one pgvector container per spec file (pre-existing).
- [ ] T01b integration suites via in-memory repo fake (bun test → 0 fail)

<!-- Progress convention: entries grow into a changelog as tasks complete —
findings, human-approved design changes, FOLLOW-UPS sub-lists. New tasks are
APPENDED with provenance, never renumbered. -->

## Out of scope (explicit)

- H2 (`python_code`) — already closed (`e547048e`), regression pinned in
  `agent-ai-service/test/unit/function-action.service.spec.ts`.
- Rewriting the mock-based integration suites into containerized ones — their
  design is kept as-is (user decision 1).
- New alerts for other metrics, threshold tuning, or Grafana work — this queue
  only inverts the existing two alerts' matcher.
- The bash 3.2 AGENTS.md constitution change — its own register
  (`PENDIENTES/10-bash32-en-agents-md.md`), human decision pending.
- Any fix beyond the registered findings; adjacent smells are reported, not
  patched.

## Human boundaries for this change

- Human approves this SPEC before the first run (invoking the loop on it is
  that approval).
- The H1 repair-don't-delete and H3 invert-don't-enumerate rulings are binding.
- Running the loop (`/manual-loop PENDIENTES/09-hallazgos-group-c.spec.md`).
