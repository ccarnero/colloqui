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

- [ ] T01 shared caps + DTO enforcement
- [ ] T02 cross-service invariant test
- [ ] T03 docs + validation report

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
