# SPEC — L2 skills cleanup: every repo skill tells the truth

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> Depends on: `manual-loops/architecture/phase0-rules-inventory.md` (C4/C5).
> Origin: user decisions 2026-07-29 (Cowork session — rules audit).
> Engram topic: 'architecture/skills-cleanup'.

## Goal

The surviving repo skills (`angular/*`, `envelope-messages`, `git-commit`,
`multi-tenant`, `yz-ui`, `playwright`, `judgment-day`, `skill-registry`)
describe THIS repo accurately — no phantom stacks, no wrong headers, no
directories that do not exist. An agent loading any of them writes code for
this platform, not for another company.

## User decisions (human boundary — do not reinterpret)

1. The 2026-07-29 deletions stand (dotnet, devops, pydantic-ai, tailwind-4,
   setup.sh) — this loop fixes what SURVIVES, it does not re-litigate.
2. Skills are advisory; SPEC Constraints are binding (AGENTS.md). Skills must
   therefore never contradict AGENTS.md — where they did, AGENTS.md wins.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Skills/docs only: NO service source changes in this loop.
- Every factual claim added to a skill carries a file:line citation or a
  runnable check; claims that cannot be verified are removed, not softened —
  automatic reviewer rejection for unverified claims.
- English everywhere.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
```

Gate rules (self-contained): docs-only loop; per-task Accepts carry the
specific greps.

---

## Task queue

### T01 — multi-tenant skill: align with reality

In `skills/multi-tenant/SKILL.md`, replace the prescriptions that contradict
the codebase (audited 2026-07-29, phase0 inventory C5):

- Header `X-Tenant-Id` → `x-yoizen-tenant` (the real mechanism, AGENTS.md
  Platform contracts).
- Express middleware + `jsonwebtoken` examples → NestJS `TenantGuard` +
  `@TenantId()` decorator + `jose` (cite `workflow-toggle.md:29-30` lineage
  and a real guard file as the pattern).
- Mongo-first framing → the real model: per-tenant DATABASE as default
  boundary (no `tenant_id` columns), `resolveStorageEngine()` dual
  Postgres/Mongo, and the documented registry-service shared-table exception
  (undecided divergence — the skill must WARN, not prescribe either way).

**Accept**
```
grep -c "X-Tenant-Id" skills/multi-tenant/SKILL.md | grep -x 0
grep -n "x-yoizen-tenant" skills/multi-tenant/SKILL.md
```

### T02 — yz-ui skill: remove the ghost half

- Delete the React/`yoizen-ui` consumer sections (`SKILL.md:44-45` lists
  `Services/yoizen-ui/` — the directory does not exist; recipes at ~451-521
  target it). The skill keeps only what serves `admin-console` (Angular,
  tokens, no Tailwind — its own line ~523 already says so).
- Spot-check the surviving Angular/token claims against
  `services/admin-console/src/styles.scss` and the design contract.

**Accept**
```
grep -c "yoizen-ui" skills/yz-ui/SKILL.md | grep -x 0
```

### T03 — Gitignored-skill decision + registry regen

- `skills/playwright/` is real but gitignored (`.gitignore:4-6` legacy from
  the deleted devops/dotnet era): PROPOSE track-or-keep-ignored with a one
  line rationale each way and STOP for the human decision (boundary below);
  apply the decision.
- Regenerate the skill registry (`skill-registry` skill) so compact rules
  reflect the surviving set; verify `judgment-day`'s registry lookup chain
  still resolves.
- `cowork/INDEX.md` entry; Engram topic `architecture/skills-cleanup`.

**Accept**
```
grep -n "skills-cleanup" cowork/INDEX.md
```

---

## Progress

- [ ] T01 multi-tenant skill aligned
- [ ] T02 yz-ui ghost half removed
- [ ] T03 gitignored decision + registry regen

## Out of scope (explicit)

- User-home skills (`~/.claude/skills/*`) — personal toolkit, not repo scope.
- Writing NEW skills (e.g. a kustomize/tilt devops replacement) — separate
  decision once these tell the truth.
- The `angular/*` skills — spot-checked healthy in the audit; untouched.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- The track-vs-ignore decision for `skills/playwright/` (T03).
