# SPEC — System validation run: prove the manual-loop machinery end-to-end (vehicle: adapter retry-chain caps)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> Depends on: the 2026-07-29 template/engine/agent generation (G0 green,
> context contract, anti-zombie PRECONDITION) — this loop VALIDATES it.
> Origin: user decision 2026-07-29 (Cowork session — "quiero validar que los
> templates andan de verdad").
> Engram topic: 'architecture/system-validation'.

## Goal

1. **Validate the system**: one full pass of the manual-loop machinery on a
   real change — engine, context contract, G0, per-service gates, dual
   review, auto-checked Progress, conventional commits. Each mechanism's
   firing is RECORDED as evidence (T03), so this SPEC's Progress becomes the
   documented proof that the templates "andan".
2. **Ship real value as the vehicle**: adapter retry-chain fields get upper
   caps, closing the 2026-07-29 finding that an uncapped adapter `timeoutMs`
   × retries can exceed the invoke-consumer's 300s `ackWaitMs` and duplicate
   outbound HTTP.

## User decisions (human boundary — do not reinterpret)

1. Caps (approved with this SPEC): `timeoutMs` ≤ 60_000, `maxRetries` ≤ 3,
   `retryBackoffMs` ≤ 10_000. Worst chain ≈ 3 × (60s + 10s) + webhook
   delivery ≈ 220s < 300s ackWait — the invariant T02 turns into a test.
2. Validation layer only: DTO caps + shared constants. NO DB CHECK
   constraint, NO migration of existing rows (out of scope; rows above the
   cap keep working until next edit).
3. The caps live as exported constants in `packages/shared` — never as magic
   numbers in two services.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Schemas/constants live in `packages/shared` and are IMPORTED, never
  duplicated (decision 3).
- Repo style wins: NestJS + class-validator in connector-admin; follow the
  file you are editing.
- Tests land with the behavior, same task.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — connector-admin tests + typecheck
cd services/connector-admin && bun test && bunx tsc -p tsconfig.json --noEmit
# G2 — connector-runtime tests + typecheck (from T02 onward)
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
# G3b — COMMIT GATE (once per task, built image)
./rebuild-redeploy.sh connector-admin dev && ./scripts/e2e/http-workflow.sh
```

Gate rules (self-contained): a diff touching `packages/shared` redeploys
connector-runtime in G3b as well. Commits only on built image.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip iteration dev-mode use and rely on G3b — and
RECORD the skip (date + symptom) in Progress as a pending repair item (see
`manual-loops/architecture/dev-mode-validator-fix.md`).

---

## Task queue

### T01 — Shared cap constants + DTO enforcement

- `packages/shared`: export `ADAPTER_TIMEOUT_MS_MAX = 60_000`,
  `ADAPTER_MAX_RETRIES_MAX = 3`, `ADAPTER_RETRY_BACKOFF_MS_MAX = 10_000`
  (place beside the existing adapter constants/schema —
  `packages/shared/src/adapter-schema.ts` neighborhood).
- `services/connector-admin/src/modules/adapters/adapters.dto.ts`: add
  `@Max(...)` using the shared constants to `timeoutMs` (lines 189 and 248 —
  today `@Min(100)` with NO upper bound), and to `maxRetries` /
  `retryBackoffMs` in the same DTOs (today `@Min(0)`, lines ~192-197).
- Unit tests: accepts value at cap, rejects value above cap (each field,
  Create AND Update DTOs); existing tests untouched.

**Accept**
```
cd services/connector-admin && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "ADAPTER_TIMEOUT_MS_MAX" packages/shared/src/adapter-schema.ts services/connector-admin/src/modules/adapters/adapters.dto.ts
```

### T02 — Cross-service invariant test: worst chain < ackWait

- In connector-runtime's test suite: a unit test importing the shared caps
  and asserting
  `ADAPTER_MAX_RETRIES_MAX * (ADAPTER_TIMEOUT_MS_MAX + ADAPTER_RETRY_BACKOFF_MS_MAX)`
  plus the webhook delivery timeout (from connector-runtime's own config)
  stays below the invoke consumer's `ackWaitMs: 300_000`
  (`services/connector-runtime/src/invoke-consumer-main.ts` config block).
- Extract `ackWaitMs` into a named exported constant next to the config so
  the test asserts against the REAL value, not a copy.
- This test is the permanent guard: raising any cap or lowering ackWait
  without rebalancing breaks the build.

**Accept**
```
cd services/connector-runtime && bun test
grep -rn "300_000\|ACK_WAIT" services/connector-runtime/src/invoke-consumer-main.ts | head -3
```

### T03 — Docs + the validation report (the actual point of this loop)

- `services/connector-admin/README.md`: document the caps and their
  rationale (link the invariant).
- `cowork/INDEX.md` entry; Engram topic `architecture/system-validation`.
- **Validation report** — record in this SPEC's Progress, as
  "**T03 findings (recorded <date>):**", the observed evidence for each
  mechanism: G0 ran on every attempt; the implementer received only task +
  Accept + Constraints; two reviewers returned independent verdicts (quote
  one objection if any); Progress checkboxes were auto-marked; commits are
  conventional and scoped; any retry/objection cycle that occurred. Missing
  evidence for a mechanism = the mechanism did NOT fire = record it as a
  finding, not a shrug.

**Accept**
```
grep -n "system-validation" cowork/INDEX.md
grep -n "T03 findings" manual-loops/architecture/system-validation.md
```

---

## Progress

- [x] PENDING REPAIR (recorded 2026-07-29, CLOSED 2026-07-31): PRECONDITION
  `./scripts/validate-dev-mode.sh --with-e2e` failed at stage 1/7 preflight —
  "deps PVC missing — run ./dev-mode.sh deps first". Iteration dev-mode use
  skipped per Gates rule; relying on G3b. See
  `manual-loops/architecture/dev-mode-validator-fix.md`.
  RESOLUTION: the failure was a sandbox artifact, not a missing PVC — the
  orchestrator's sandboxed shell could not reach the cluster API
  (127.0.0.1:26443, "operation not permitted"), so the preflight's PVC probe
  came back empty. The PVC existed all along (`./dev-mode.sh deps` on
  2026-07-30: "persistentvolumeclaim/dev-mode-deps unchanged … node_modules
  in PVC are up to date"). Validator run outside the sandbox is fully green:
  2026-07-30 (twice, as the long-running-agent-executions loop PRECONDITION)
  and 2026-07-31 (7/7 stages PASS, this closeout). No repair was needed;
  dev-mode iteration is safe to use.
- [x] T01 shared caps + DTO enforcement
- [x] T02 cross-service invariant test
- [x] T03 docs + validation report

**T03 findings (recorded 2026-07-29, item 8 appended 2026-07-30):**

1. **G0 ran on every attempt** — three times total (T01 attempt 1, T01 re-run
   after the spec fix, T02), green each time. Evidence: doc-code-guards
   "CLEAN" output per attempt.
2. **Context contract held** — each implementer launch received only the task
   text, its Accept block, and the Constraints section (plus prior-attempt
   failure context on the retry, as designed). Implementers were barred from
   touching this SPEC; the orchestrator made every SPEC edit.
3. **Dual review fired independently** — two reviewers per task, four
   verdicts, all APPROVED, none rubber-stamped: both T02 reviewers
   independently flagged the same non-blocking defect ("the third test …
   only checks the constant is a finite positive number — it does not
   actually detect someone re-inlining a literal in invoke-consumer-main.ts,
   contrary to its comment"). No REJECTED round occurred, so the
   objection-retry path was NOT exercised this run.
4. **Progress auto-marking worked** — T01/T02 checkboxes flipped by the
   orchestrator in the same commit as the code, as specified.
5. **Commits conventional and scoped** — `6561c7a8`
   feat(connector-admin): T01 …, `be98e50d` test(connector-runtime): T02 …;
   no Co-Authored-By.
6. **Retry cycle exercised (1 round, human-arbitrated)** — T01 attempt 1
   failed gate G1 on a PRE-EXISTING red baseline: three
   internal-sync integration specs used node-style `beforeAll(fn, timeout)`,
   which bun rejects, so `bun test` exited 1 before T01 touched anything.
   Finding: the gate as authored had never been green — the loop caught it,
   the orchestrator stopped instead of burning attempts, and the human chose
   "fix the specs". The fix exposed a second latent defect: module-scope
   prototype spies leaking from `internal-sync.service.spec.ts` into the
   integration specs (fixed with `afterAll` + `mockRestore`).
7. **PRECONDITION path exercised** — `validate-dev-mode.sh --with-e2e`
   failed (deps PVC missing); the skip was recorded per the Gates rule and
   G3b carried the burden: full rebuild-redeploy + e2e ran green twice
   (T01: admin+runtime because packages/shared changed; T02: admin+runtime
   because runtime source changed).
8. **Second retry cycle exercised, human-arbitrated (T03, recorded
   2026-07-30)** — G1 failed on T03's docs-only diff: the internal-sync
   shutdown integration test flaked ~2-in-5 runs. Latent defect exposed by
   T01's spec repair (the test had never actually executed under bun
   before). Human chose "fix it now". Root cause was test-harness, not
   product: testcontainers publishes the host→container port mapping
   asynchronously after `start()` resolves (measured 2–14 ms lag, first
   connect refused in 5 of 6 boots), so `beforeAll` could dial NATS before
   the port existed — bun reports a failed hook as `(unnamed)`, masquerading
   as the test body. Fix: `waitForHostPortConnectable` TCP-probe gate in
   `test/integration/setup.ts` for NATS and Mongo containers + a regression
   spec (`setup-readiness.integration.spec.ts`) that fails 2/5 on the
   pre-fix harness. Stability proof: 10/10 green on the shutdown spec,
   10 (3+7) consecutive green full-suite runs. API outage note: the T03
   implementer launch was blocked ~40 min by upstream 529s — loop state
   survived idle and resumed cleanly.
9. **Mechanism NOT observed:** BLOCKED.md flow (no task blocked) and the
   same-error-twice fast-block — neither had a trigger this run. Also noted
   for template repair: the PostToolUse organize-imports hook strips
   not-yet-referenced imports, forcing usage-before-import edit ordering.

## Out of scope (explicit)

- DB CHECK constraints or migration/backfill of existing adapter rows
  (decision 2).
- Runtime clamping in connector-runtime (validation belongs at the admin
  write path; the invariant test covers the interplay).
- Any change to the caps' values mid-loop — that is a human decision.

## Human boundaries for this change

- Human approves this SPEC before the first run (including the three cap
  values in decision 1).
- Human runs the loop itself (`/manual-loop manual-loops/architecture/system-validation.md`)
  — this run IS the validation, so the human should watch it.
- If T02's invariant cannot hold with the approved caps (webhook timeout
  larger than budgeted), STOP — rebalancing caps vs ackWait is a human call.
