# SPEC — L1 docs consolidation: one true doc per component (repo-wide)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> Depends on: `manual-loops/architecture/phase0-rules-inventory.md` (the audit
> that produced every finding below) and AGENTS.md (shipped 2026-07-29).
> Origin: user decisions 2026-07-29 (Cowork session — rules audit).
> Engram topic: 'architecture/docs-consolidation'.

## Goal

Every component has exactly ONE truthful doc: a README verified against its
code. The 14 scattered per-service `AGENTS.md` files are absorbed and deleted,
the 10 missing READMEs exist, the 3 lying READMEs tell the truth, and ADR
content lives in one indexed channel.

## User decisions (human boundary — do not reinterpret)

1. AGENTS.md (root) is the constitution; per-service docs are READMEs only —
   no per-service AGENTS.md/CLAUDE.md survive this loop.
2. Absorb-then-delete: content from a per-service AGENTS.md is merged into
   the service README ONLY after each claim is verified against code (claims
   that fail verification are dropped, with the drop noted in Progress).
3. README bar for missing components: purpose, architecture claims (verified,
   with file:line), endpoints/events contracts, env vars incl.
   `DB_ENGINE`/`STORAGE_ENGINE` where `resolveStorageEngine()` is used.

## Prior art (validated 2026-07-29 — REUSE, do not duplicate)

The engine does not forward this section — repeat citations inside tasks.

- Phase 0 findings: `manual-loops/architecture/phase0-rules-inventory.md`
  (C7 lying READMEs, C9 coverage, kill-list execution notes).
- Verified-good README examples to copy the shape of:
  `services/connector-runtime/README.md`, `services/workflow-service/README.md`.
- `packages/shared/README.md` exists since 2026-07-29 (renamed from its old
  CLAUDE.md) — verify its claims, do not rewrite from scratch.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Docs only: NO service source changes in this loop. If verification uncovers
  a code bug, record it in Progress as a follow-up — do not fix it here.
- Every architecture claim written into a README carries a file:line citation
  or a runnable command; unverified claims do not land — automatic reviewer
  rejection.
- English everywhere.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
```

Gate rules (self-contained): docs-only loop — per-task Accept blocks carry
the specific greps. G0 is load-bearing here: K6a/K6d catch inventory and
path drift the moment a README lies about a file.

---

## Task queue

### T01 — Fix the three lying READMEs

- `services/auth-service/README.md`: replace the shared-table
  `tenant_users(tenant_id, ...)` depiction with the real per-tenant-DB model
  (`packages/shared/src/tenant-auth-schema.ts:34-44`: no `tenant_id` column,
  `role_id` FK, `UNIQUE(email)`); document `DB_ENGINE`.
- `services/cache-service/README.md`: drop the "no shared package dependency"
  claim (`cache.controller.ts:14` imports from `@yoizen/shared`).
- `services/tracking-ingester-service/README.md`: golden gate row count 72 →
  92 (`test/classify.golden.spec.ts:51-52`).

**Accept**
```
grep -c "tenant_id" services/auth-service/README.md | grep -x 0
grep -c "no shared package" services/cache-service/README.md | grep -x 0
grep -n "92" services/tracking-ingester-service/README.md
```

### T02 — READMEs for the five service gaps (absorb AGENTS.md where present)

- `agent-admin-service`, `channel-service`, `usage-aggregator-service`:
  absorb their `AGENTS.md` (verify every claim first — decision 2), write the
  README to the decision-3 bar, DELETE the AGENTS.md.
- `agent-memory-service`, `ai-agent-gateway`: write READMEs from code (no
  prior doc exists).

**Accept**
```
ls services/agent-admin-service/README.md services/agent-memory-service/README.md services/ai-agent-gateway/README.md services/channel-service/README.md services/usage-aggregator-service/README.md
ls services/agent-admin-service/AGENTS.md services/channel-service/AGENTS.md 2>&1 | grep -c "No such" | grep -x 2
```

### T03 — Absorb + delete the remaining per-service AGENTS.md (11 files)

- For each service that HAS a README and an AGENTS.md (`api-gateway`,
  `audit-service`, `auth-service`, `cache-service`, `connector-admin`,
  `connector-runtime`, `proxy-service`, `registry-service`, `tenant-service`,
  `usage-aggregator-service` if not covered in T02, `workflow-service`):
  merge verified-only content into the README, then delete the AGENTS.md.
- Conflicts (e.g. audit-service's AGENTS.md says Mongo, README says
  Postgres): the CODE decides; record each adjudication in Progress.

**Accept**
```
find services -maxdepth 2 -name "AGENTS.md" | wc -l | grep -x 0
```

### T04 — Package READMEs (4 missing + verify shared)

- Write READMEs for `packages/angular-shared`, `packages/database`,
  `packages/observability`, `packages/testing` (decision-3 bar; for database:
  document `MultiTenantConsumerManager`/`ensureDurableConsumer` and
  `DEFAULT_ACK_WAIT_MS` semantics — cite the K7 census in
  `scripts/checks/doc-code-guards.sh`).
- Verify `packages/shared/README.md` (293 lines inherited from the old
  CLAUDE.md): spot-check its structure/exports claims against source; fix
  what drifted; track the file in git (it is currently untracked).
- Delete `packages/shared/AGENTS.md` after absorbing verified content.

**Accept**
```
ls packages/angular-shared/README.md packages/database/README.md packages/observability/README.md packages/shared/README.md packages/testing/README.md
find packages -maxdepth 2 -name "AGENTS.md" | wc -l | grep -x 0
```

### T05 — One ADR channel

- Move the three inline ADRs from `DOCS/guides/onboarding.md` (lines ~571-611:
  connector-runtime split, tenant two-tier Postgres, Temporal+NATS) into
  `DOCS/adr/` as dated records; onboarding keeps one-line pointers.
- `DOCS/architecture/decision-log.md` header: state the relationship between
  D-numbers and `DOCS/adr/` (which graduates to which); cross-link both ways.

**Accept**
```
grep -c "Architecture Decision Record" DOCS/guides/onboarding.md | grep -x 0
ls DOCS/adr/ | wc -l
```

### T06 — Docs + index

- `cowork/INDEX.md` entry; note in `DOCS/README.md` that per-component truth
  lives in READMEs and the constitution is `AGENTS.md`.
- Engram: decisions + follow-ups (code bugs found during verification) under
  'architecture/docs-consolidation'.

**Accept**
```
grep -n "docs-consolidation" cowork/INDEX.md
```

---

## Progress

- [ ] T01 fix the three lying READMEs
- [ ] T02 READMEs for the five service gaps
- [ ] T03 absorb + delete remaining AGENTS.md
- [ ] T04 package READMEs + shared verification
- [ ] T05 one ADR channel
- [ ] T06 docs + index

## Out of scope (explicit)

- Fixing code bugs found during verification (recorded as follow-ups only).
- Rewriting DOCS/architecture/* content (only the ADR channel unification).
- The tenancy-model decision (C6) — needs its own human decision first.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Any claim adjudication where code contradicts BOTH docs (new information)
  is reported before the task commits.
