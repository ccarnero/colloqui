# SPEC — Docs consistency: verify every document against code, fix it, and leave a guard behind

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> ABSORBS: `manual-loops/architecture/docs-consolidation.md` (L1, retired
> unrun 2026-07-30 by user decision — its full queue lives on as T01-T05 here).
> Depends on: `manual-loops/architecture/phase0-rules-inventory.md` and
> AGENTS.md (shipped 2026-07-29).
> Origin: user decisions 2026-07-30 (Cowork session).
> Engram topic: 'architecture/docs-consistency'.

## Goal

Every document in the repo tells the truth about the code — and every CLASS
of drift found gets an executable guard in `scripts/checks/doc-code-guards.sh`
so it cannot silently return. At the end: one truthful README per component,
one ADR channel, and a G0 that is strictly harder to pass than today's.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-30) Audit + guards, in one loop: a fixed drift that leaves no
   check behind is only half-fixed. Per CLASS of drift, not per instance.
2. (2026-07-30) This loop ABSORBS docs-consolidation (L1): consolidation
   tasks run first (T01-T05), validation + guard tasks after. L1's decisions
   carry over: absorb-then-delete per-service AGENTS.md with verified-only
   content; README bar = purpose, verified architecture claims (file:line),
   contracts, env vars incl. DB_ENGINE where `resolveStorageEngine()` is used.
3. A new guard lands in the SAME task as the fix that makes it green — a red
   guard never commits.
4. Scope = READMEs (root, services, packages), DOCS/**, SCHEMAS.md,
   TAXONOMY.md. NOT in scope: manual-loops/ SPECs and cowork/ (historical
   records — validating them would be rewriting history).
5. (2026-07-30) Code-first documentation: DESCRIPTIVE docs (READMEs,
   inventories, as-built contracts) are derived FROM the code — the code
   decides, always. PRESCRIPTIVE docs (envelope spec, security MUSTs,
   TAXONOMY — recorded design decisions the code must obey) are NOT
   rewritten from code: where code diverges from them, the CODE is the bug
   (recorded as a follow-up finding, fixed in its own loop). When doc ≠
   code, the loop's first question is: does this doc describe or prescribe?

## Prior art (validated 2026-07-30 — REUSE, do not duplicate)

The engine does not forward this section — repeat citations inside tasks.

- Guard style to extend: `scripts/checks/doc-code-guards.sh` (K6a service
  inventory :42-74, K6c ROW_FILES case-statement :96-149, K7 census +
  allowlist :250-370 — bash 3.2 compatible, fail() accumulator pattern).
- Phase 0 findings: `manual-loops/architecture/phase0-rules-inventory.md`
  (C7 lying READMEs, C9 coverage, C2 executed kill list).
- Verified-good README shapes: `services/connector-runtime/README.md`,
  `services/workflow-service/README.md`.
- `packages/shared/README.md` (293 lines, renamed 2026-07-29 from its old
  CLAUDE.md, tracked since commit 09712da1) — verify, do not rewrite.
- Doc-side envelope fixes belong here ONLY when the DOC is wrong (e.g.
  DRIFT.md item 2: headers live at `data.headers`, envelope.md §4.1 claims
  `transport.headers`). CODE-side envelope drift stays with the future
  envelope-drift loop.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Docs and `scripts/checks/` only: NO service source changes. Code bugs found
  during verification are recorded in Progress as follow-ups, never fixed here.
- Every claim written into a doc carries a file:line citation or a runnable
  command; unverified claims are dropped, not softened — automatic reviewer
  rejection.
- New guards follow the existing script's conventions (case statements, no
  bash-4 features, fail() accumulator, one clear message per failure).
- G0 must be green at every commit INCLUDING the new checks added so far
  (decision 3).
- English everywhere.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards, INCLUDING checks added by earlier tasks of this loop
./scripts/checks/doc-code-guards.sh
```

Gate rules (self-contained): docs-only loop; per-task Accepts carry the
specific greps. G0 grows as the loop advances — that is the point.

---

## Task queue

### T01 — Fix the three lying READMEs + first counting guard (K9)

- `services/auth-service/README.md`: replace the shared-table
  `tenant_users(tenant_id, ...)` depiction with the real per-tenant-DB model
  (`packages/shared/src/tenant-auth-schema.ts:34-44`: no `tenant_id` column,
  `role_id` FK, `UNIQUE(email)`); document `DB_ENGINE`.
- `services/cache-service/README.md`: drop the "no shared package dependency"
  claim (`cache.controller.ts:14` imports from `@yoizen/shared`).
- `services/tracking-ingester-service/README.md`: golden row count 72 → the
  real count.
- **K9 (numeric-claims guard)**: the golden row count STATED in the ingester
  README must equal the data-row count of `golden/labeled.tsv` (and the
  assertion in `test/classify.golden.spec.ts`). Class: numbers quoted in docs
  drift from generated reality.

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -c "tenant_id" services/auth-service/README.md | grep -x 0
grep -n "K9" scripts/checks/doc-code-guards.sh
```

### T02 — READMEs for the five service gaps (absorb AGENTS.md where present)

- `agent-admin-service`, `channel-service`, `usage-aggregator-service`:
  absorb their `AGENTS.md` (verify every claim first — decision 2), write the
  README to the bar, DELETE the AGENTS.md.
- `agent-memory-service`, `ai-agent-gateway`: write READMEs from code.

**Accept**
```
ls services/agent-admin-service/README.md services/agent-memory-service/README.md services/ai-agent-gateway/README.md services/channel-service/README.md services/usage-aggregator-service/README.md
find services -maxdepth 2 -name "AGENTS.md" | wc -l | grep -x 11
```

### T03 — Absorb + delete the remaining per-service AGENTS.md

- For each service with both README and AGENTS.md: merge verified-only
  content into the README, delete the AGENTS.md. Conflicts (e.g.
  audit-service AGENTS.md says Mongo, README says Postgres): the CODE
  decides; record each adjudication in Progress.
- **K6a extension**: after this task, extend K6a (or add K6f-style check)
  to FAIL on any `services/*/AGENTS.md` or `packages/*/AGENTS.md` existing at
  all — the class "per-component agent files resurrect" gets a guard.

**Accept**
```
./scripts/checks/doc-code-guards.sh
find services packages -maxdepth 2 -name "AGENTS.md" | wc -l | grep -x 0
```

### T04 — Package READMEs + storage-engine guard (K11)

- Write READMEs for `packages/angular-shared`, `packages/database`,
  `packages/observability`, `packages/testing` (for database: document
  `MultiTenantConsumerManager`/`ensureDurableConsumer` + `DEFAULT_ACK_WAIT_MS`
  semantics, citing the K7 census). Verify `packages/shared/README.md`
  claims; fix drift. Delete `packages/shared/AGENTS.md` after absorption.
- **K11 (storage-engine documentation guard)**: every service whose source
  calls `resolveStorageEngine()` must mention `DB_ENGINE` (or
  `STORAGE_ENGINE`) in its README. Class: undocumented dual-backend support
  (11 services used it, 2 documented it — phase0 C9).

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "K11" scripts/checks/doc-code-guards.sh
ls packages/angular-shared/README.md packages/database/README.md packages/observability/README.md packages/testing/README.md
```

### T05 — One ADR channel

- Move the three inline ADRs from `DOCS/guides/onboarding.md` (~571-611)
  into `DOCS/adr/` as dated records; onboarding keeps one-line pointers.
- `DOCS/architecture/decision-log.md`: state the D-number ↔ `DOCS/adr/`
  relationship; cross-link both ways.

**Accept**
```
grep -c "Architecture Decision Record" DOCS/guides/onboarding.md | grep -x 0
```

### T06 — Dead-link guard (K10) over the whole doc corpus

- **K10 (link-resolution guard)**: every RELATIVE `.md` link in root
  `README.md`, `DOCS/**/*.md`, and `services/*/README.md` resolves to an
  existing file. Class: docs linking deleted docs (the `code-review.md`
  dangling-row case, found 2026-07-29, repeats every time a doc dies).
- Fix every dead link the new check finds (fix or remove, with the choice
  noted in Progress).

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "K10" scripts/checks/doc-code-guards.sh
```

### T07 — Full-corpus verification sweep (report + doc-side fixes)

- Sweep `DOCS/messaging/*`, `DOCS/architecture/*`, `SCHEMAS.md`, `TAXONOMY.md`
  and the guides: verify load-bearing claims against code (sampling bar:
  every claim that names a file, field, constant, or count gets checked).
- Fix DOC-side errors in place (e.g. envelope.md §4.1 `transport.headers` →
  `data.headers`, cross-checked with DRIFT.md item 2 and
  `packages/shared/src/interfaces.ts`).
- CODE-side divergences (stage-1 type token, depth operator `>` vs `>=`,
  envelope-schema.json rewrite) are RECORDED as numbered findings for the
  future envelope-drift loop — not fixed here (constraint).
- Findings land in Progress as "**T07 findings (recorded <date>):**".

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "T07 findings" manual-loops/architecture/docs-consistency.md
grep -c "transport.headers" DOCS/messaging/envelope.md | grep -x 0
```

### T08 — Docs + index

- `DOCS/README.md`: state that per-component truth lives in READMEs, the
  constitution is `AGENTS.md`, and G0 now enforces K9/K10/K11 + the
  AGENTS.md-resurrection check.
- `cowork/INDEX.md` entry; Engram decisions + follow-up list (code bugs found
  in T07) under 'architecture/docs-consistency'.

**Accept**
```
grep -n "docs-consistency" cowork/INDEX.md
```

---

## Progress

- [ ] T01 lying READMEs + K9
- [ ] T02 five service README gaps
- [ ] T03 absorb remaining AGENTS.md + resurrection guard
- [ ] T04 package READMEs + K11
- [ ] T05 one ADR channel
- [ ] T06 K10 dead-link guard + fixes
- [ ] T07 full-corpus sweep + doc-side fixes
- [ ] T08 docs + index

## Out of scope (explicit)

- Service source changes of any kind (follow-ups only).
- CODE-side envelope drift (future envelope-drift loop owns it).
- manual-loops/ SPECs and cowork/ session records (decision 4 — history).
- The tenancy-model decision (C6) — separate human decision.
- Guarding prose quality/style — guards check FACTS only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Claim adjudications where code contradicts BOTH docs are reported before
  the task commits.
- Any NEW guard class beyond K9/K10/K11/resurrection needs human sign-off
  (a guard is forever — it should be born deliberately).
