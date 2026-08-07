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
   this is DI-token retargeting, not a rewrite.
2. **H3**: INVERT the alert pattern — broad match with an exclusion list, per
   the register's ticket shape. Do not return to a hand-enumerated allow-list.
3. Scope discipline: fix exactly the registered finding. Adjacent smells found
   while fixing get REPORTED in the task summary, never patched.

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

- PRECONDITION (before task 1): `git status --porcelain` empty.
- T01 does not run G3; T02 does not run G1/G2 unless its diff touches
  agent-admin-service.
- From T01 onward, `bun test` in agent-admin-service must exit with **0 fail**
  — no pre-existing-failure discount exists anymore.
- A G4 failure is a failed attempt like any other gate.

---

## Task queue

### T01 — H1: repair the 14 DI-rotted integration/e2e suites of agent-admin-service

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

---

## Progress

- [ ] T01 H1 repair the 14 DI-rotted suites (bun test → 0 fail)
- [ ] T02 H3 invert lag-alert pattern + durable guard

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
