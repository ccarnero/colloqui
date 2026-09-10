# SPEC — E2E journeys J1–J5 against the dev cluster

> Task queue for the manual loop. One task at a time, gated by tests and dual review.
> Origin: user decision 2026-09-10 (Cowork session) — replaces the September
> `platform-evaluation` harness (retired in the same commit that adds `e2e/journeys/`).

## Goal

`e2e/journeys/` holds one Playwright spec per product journey against the dev cluster
(`api-gateway` and `admin-console` at `*.platform-services-dev.dev.local`, tenant `acme`):
J1 access, J2 provision, J3 execute, J4 toggle, J5 diagnose. J1 is written; J2–J5 are
`test.fixme` skeletons with the intended assertions. After this loop, `bun run
e2e:journeys` runs all five green against a running dev cluster, and each spec creates
what it needs and deletes it at the end, so the suite is re-runnable.

## User decisions (human boundary — do not reinterpret)

1. One spec file per journey, under 120 lines each; shared helpers only in `env.ts`,
   `api.ts`, `console.ts`. No runner script, no ledger, no evidence directory, no
   frozen builds: `playwright test` exit code is the result.
2. Journeys go through the gateway (`/api/...`) with the `x-yoizen-tenant` header and a
   bearer token from `/api/auth/login`. The console is exercised only in J1 and J5.
3. No production code changes. If a journey cannot pass because of the product, the
   task is blocked with the failing assertion and the response body in BLOCKED.md.

## Constraints (apply to every task)

- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete an assertion that already passes.
- Poll with `expect.poll`, never `waitForTimeout`. No `test.skip` left behind; a
  `test.fixme` may remain only in a task not yet reached.
- Every resource a spec creates is deleted in `test.afterAll`/`afterEach`, even on failure.
- No new dependencies. No changes outside `e2e/journeys/`.

## Gates (the manual loop runs these verbatim, in order)

QA: none
Gate executor: script-runner

```
# G0 — repo guards (KISS, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — every journey written so far passes against the dev cluster (fixme specs are skipped, not failed)
bunx playwright test e2e/journeys --reporter=list
```

Both are ITERATION gates. PRECONDITION: the dev cluster is up
(`curl -sf http://api-gateway.platform-services-dev.dev.local/health`); if it is not,
STOP and report — do not mock it.

---

## Task queue

### T01 — J1 runs green as written, or is corrected

- **Allowed write paths:** `e2e/journeys/j1-access.spec.ts`, `e2e/journeys/api.ts`,
  `e2e/journeys/console.ts`, `e2e/journeys/env.ts`.
- **Non-goals:** no other journey; no helper beyond what J1 needs.
- Run `bunx playwright test e2e/journeys/j1-access.spec.ts`. Fix selectors, the login
  response field (`accessToken` vs `token`), or the status codes that the gateway
  actually returns — and only those. If the product returns something the assertion
  should not accept (e.g. 200 for a foreign tenant), block per User decision 3.

**Accept**
```
bunx playwright test e2e/journeys/j1-access.spec.ts --reporter=list
```

### T02 — J2 provision

- **Allowed write paths:** `e2e/journeys/j2-provision.spec.ts`, `e2e/journeys/api.ts`.
- **Non-goals:** no console; no execution.
- Replace the two `test.fixme` with passing tests. The minimal valid body comes from
  `services/workflow-service/src/modules/workflows/dto` (read it; do not guess). Delete
  the workflow in `afterAll`.

**Accept**
```
bunx playwright test e2e/journeys/j2-provision.spec.ts --reporter=list
```

### T03 — J3 execute

- **Allowed write paths:** `e2e/journeys/j3-execute.spec.ts`, `e2e/journeys/api.ts`.
- **Non-goals:** no assertions on step internals; no NATS access.
- The spec creates its own workflow (reuse J2's body through a helper in `api.ts` if
  needed), executes it with a nonce, polls the execution until `completed|failed`
  (120 s ceiling), asserts it is listed, and deletes the workflow.

**Accept**
```
bunx playwright test e2e/journeys/j3-execute.spec.ts --reporter=list
```

### T04 — J4 toggle

- **Allowed write paths:** `e2e/journeys/j4-toggle.spec.ts`, `e2e/journeys/api.ts`.
- **Non-goals:** no 120 s idle window; one refused execute is the evidence.
- Own workflow; `PATCH /workflows/:id/status` to the disabled value the DTO defines,
  execute refused with the status the service returns (read the controller; assert
  that exact code, not a list); enable; execute accepted; delete.

**Accept**
```
bunx playwright test e2e/journeys/j4-toggle.spec.ts --reporter=list
```

### T05 — J5 diagnose

- **Allowed write paths:** `e2e/journeys/j5-diagnose.spec.ts`, `e2e/journeys/console.ts`.
- **Non-goals:** no trace/span assertions; ids visible is the bar.
- Own workflow + one execution through the API; sign in to the console; the workflow
  page shows both ids; unknown execution id → 404 at the API. Delete at the end.

**Accept**
```
bunx playwright test e2e/journeys/j5-diagnose.spec.ts --reporter=list
```

---

## Progress

<!-- The loop edits only this section: the attempt counter and one line per task. Nothing else goes in the SPEC. -->

- [x] T01 J1 green — attempt 1/4; G0 exit 0 (KISS guards passed), G1 exit 0 (4 passed, 5 future-task fixme skipped), Accept exit 0 (4 passed); 2× APPROVED; committed 18cc191e, T02–T05 remain, no blockers; tokens estimated <100k/6M across threads (exact usage unavailable).
- [x] T02 J2 provision — attempt 1/4; G0 exit 0 (KISS guards passed), G1 exit 0 (6 passed, 3 future-task fixme skipped), Accept exit 0 (2 passed); 2× APPROVED; committed dff39dbb, T03–T05 remain, no blockers; tokens estimated <100k/6M across threads (exact usage unavailable).
- [x] T03 J3 execute — attempt 2/4; attempt 1 rejected by both reviewers because default test timeout truncated the 120s poll; corrected with 180s test timeout; fresh G0 exit 0 (KISS guards passed), G1 exit 0 (7 passed, 2 future-task fixme skipped), Accept exit 0 (1 passed); 2× APPROVED; pending human commit, T04–T05 remain, no blockers; tokens estimated <200k/6M across threads (exact usage unavailable).
- [ ] T04 J4 toggle
- [ ] T05 J5 diagnose

Token ceiling: 6 M per task, every thread including the orchestrator.

- Attempts: T01 1/4; T02 1/4; T03 2/4; T04 0/4; T05 0/4.

## Out of scope (explicit)

- Building images, deploying, or checking digests — the cluster that is up is the one under test.
- Trace/span correlation (J5 of September); a later SPEC if wanted.
- Making `e2e:journeys` a gate of other SPECs — decided after it is green once.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human reviews every commit before anything is pushed.
