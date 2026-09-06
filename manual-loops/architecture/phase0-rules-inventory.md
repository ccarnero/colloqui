# Phase 0 — Rules inventory & contradictions (2026-07-29)

> Working artifact of the architecture consistency initiative. Synthesized from
> four parallel read-only audits: (1) repo-root AI/meta files, (2) formal docs
> (SCHEMAS/TAXONOMY/DOCS), (3) service & package READMEs with spot-checks,
> (4) skills/ + manual-loops Constraints corpus.
> Engram topic: 'architecture/rules-audit'. Nothing here changes code — this
> document feeds the Phase 2 human decisions and the Phase 3 remediation loops.

## Goal

Centralizar contradicciones y reglas de operación reales para definir cuál es la
constitución ejecutable del repositorio antes de escalarlas a remediaciones.

## User decisions (human boundary — do not reinterpret)

1. Mantener `AGENTS.md` como norma y usar este artefacto sólo como mapa de
   implementación.
2. No tocar runtime desde este documento: cada cambio operativo va en loops
   separados con pruebas y dual review.

## Constraints (apply to every task)

- Los contratos técnicos vivos mandan sobre documentación.
- No se asumen capacidades no verificables en guardas existentes.
- Este texto puede contener hallazgos abiertos; su cierre requiere ronda humana.

## Task queue

### Verdict

The platform HAS a real, coherent rulebook — but it does not live where the
documentation says it lives. The operative constitution is the `manual-loops/`
Constraints corpus plus two executable gates (taxonomy golden rows,
`scripts/checks/doc-code-guards.sh`). Everything above it — the four AI
instruction files, the code-review checklist, the security/multi-tenancy
principles — is prose with no enforcement, drifted copies, or claims the code
contradicts. There is NO CI: no `.github/workflows`, no `lefthook.yml`.
Every rule is enforced either by a manual-loop run or by nobody.

### 1. The de-facto constitution (real, repeated, worth canonizing)

Universal (from 28 SPEC Constraints sections):
- Verbose logging on every new code path (28/28 SPECs).
- Never weaken, skip, or delete existing tests (27/28; "automatic reviewer
  rejection" in 15).
- Nothing fails silently (19/28).

Binding styles (origin `trace-console.md:33-47`, inherited by 5+ SPECs):
- Default backend = NestJS-on-Bun, class-validator DTOs, `@TenantId()` +
  `TenantGuard` ("repo style wins", `workflow-toggle.md:29-30`).
- tracking-ingester-service = named exception: pure functions in `src/lib/*`,
  one per file, I/O only in `main.ts`, plain Bun, NO NestJS.
- admin-console = standalone components, signals, OnPush, lazy routes, inline
  SVG, no chart libs, no new libs without human approval, tokens-only colors
  (no hard-coded hex — reviewer rejection), visual contract =
  `manual-loops/admin-console/design/Rediseño Terminal.dc.html`.
- api-gateway = explicit proxy modules only, global guards, no `@Public()`.
- connector-runtime = pure core (no Temporal/NATS/Express imports in lib),
  Result types in core, `ApplicationFailure` mapping only in activity wrapper.
- workflow-service = publishes only through Temporal activities (determinism),
  single publish path.

De-facto code patterns (repeated across READMEs/code, mostly undocumented):
- Fire-and-forget event publishing that never throws into the caller.
- Causal chain contract: correlation/causation/depth, `DepthExceededError` →
  fallback to root event with warn.
- `x-yoizen-tenant` header as THE tenant-scoping mechanism.
- `resolveStorageEngine()` dual Postgres/Mongo backend — used by 11 services,
  documented by 2.
- Idempotent DDL (`IF NOT EXISTS`) applied via `applySchema` at startup.
- English for all code/UI artifacts.

Executable enforcement that actually exists:
- Taxonomy golden gate: `golden/labeled.tsv` (92 rows) + classifier spec —
  new classification rules land with fixtures or fail.
- `scripts/checks/doc-code-guards.sh` (K6a-K8): doc/manifest drift guards,
  run manually.
- Manual-loop gates + dual review — but ONLY for work done through loops.

### 2. Contradictions & rot (numbered — Phase 2 decides each)

C1. `AGENTS.md` is EMPTY (0 bytes) yet cited as authoritative by
    `.claude/CLAUDE.md:4` and `.gemini/gemini.md:6`.
C2. Instruction-file drift: `CURSOR.md` == `GEMINI.md` == `.cursorrules`
    (byte-identical, untouched since May 6); root `CLAUDE.md` edited Jul 29
    and lost the Engram protocol section the others still carry. Two
    incompatible Gemini identities (`GEMINI.md` = SDD orchestrator vs
    `.gemini/gemini.md` = "Guardian Agent"). `.gemini/skills/` symlink claimed
    but nonexistent. `.claude/CLAUDE.md` claims "Lefthook runs pre-commit
    validation" — no lefthook.yml exists.
    → USER DECISION (2026-07-29): CURSOR.md, GEMINI.md and .claude/CLAUDE.md
    "no van" — legacy from the first version by other devs. Kill list below.
C3. No CI/pre-commit at all. code-review.md checklist (19 rules, 6 BLOCKING),
    security MUSTs, size limits — all prose-only. doc-code-guards.sh and the
    golden gate run only when a human remembers.
C4. Stale skills mandating nonexistent stacks: `dotnet` (zero .cs files),
    `devops` (Azure Pipelines + Helm vs real Kustomize/Tilt/Knative — direct
    contradiction with `declarative-provisioning.md:85-88`), `tailwind-4` +
    React half of `yz-ui` (consumer `yoizen-ui/` does not exist; admin-console
    explicitly non-Tailwind per `yz-ui/SKILL.md:523`), `pydantic-ai` (no
    Python anywhere). `devops`/`dotnet`/`playwright` are gitignored yet loaded
    via the `.claude/skills` symlink.
C5. `multi-tenant` skill contradicts reality: prescribes `X-Tenant-Id` header
    (real: `x-yoizen-tenant`), Express middleware + jsonwebtoken (real: NestJS
    guards/decorators + jose), Mongo-first (real: polyglot via
    resolveStorageEngine).
C6. Two tenancy models coexist undocumented: per-tenant database ("the DB is
    the boundary, no tenant_id column" — workflow/tenant/auth) AND shared
    tables with `tenant_id` (registry-service, source-verified). No document
    acknowledges both or says when each applies.
C7. READMEs that lie against their own code: auth-service (documents shared
    `tenant_users` with `tenant_id` + UNIQUE(tenant_id,email); code implements
    per-tenant DB, `role_id` FK, UNIQUE(email)); cache-service ("no shared
    package dependency" — imports 3 symbols from @yoizen/shared);
    tracking-ingester README (golden = 72 rows; actual = 92).
C8. Envelope contract drift (DRIFT.md, 10 items, partially resolved): stage-1
    `type` hardcoded without channel token; headers documented at
    `transport.headers` but living at `data.headers`; depth anti-loop
    implemented twice with different operators (`>` in shared utils vs `>=`
    in agent-ai DepthTracker); `envelope-schema.json` self-contradictory and
    marked "not validation authority"; `isCompliantEnvelope` is shallow and
    called from 2 sites; no runtime subject-grammar validator; no Zod schema
    for any envelope type.
C9. Documentation coverage: 5 services with no README (agent-admin,
    agent-memory, ai-agent-gateway, channel-service, usage-aggregator), all 5
    packages with none (including packages/shared — the platform's heart).
    ADRs live in three unlinked places (decision-log.md D1-D17, DOCS/adr/,
    inline in onboarding.md).
C10. Governance holes: 4 services never mentioned in ANY manual-loop —
    ai-agent-gateway, auth-service, proxy-service, usage-aggregator-service.
     No spec constraint, no binding style, no loop has ever touched them.
C11. Security enforcement mostly aspirational: no NATS ACLs (permanent current
     state), no rate limiting, plaintext MCP credentials at rest (known risk,
     no compensating control), agent auth/revocation "Pending" across the
     board.

### 3. Kill list (C1/C2 — user-directed 2026-07-29, pending execution go)

- `CURSOR.md`, `GEMINI.md`, `.cursorrules`, `.gemini/` (root)
- `.claude/CLAUDE.md` — after absorbing its 3 true rules (skills/ pointer,
  code-review.md pointer, conventional commits; the lefthook claim dies as
  false) into the new AGENTS.md
- Scattered copies: `packages/shared/{AGENTS,CLAUDE,CURSOR,GEMINI}.md`,
  per-service `AGENTS.md`/`CLAUDE.md` pairs (audit-service's two contradict
  each other on which database the service uses)
- Open: fate of root `CLAUDE.md`'s SDD-orchestrator content (Part 6) — keep
  SDD or retire it; root CLAUDE.md becomes a pointer to AGENTS.md either way.

### 4. Proposed remediation (Phase 3 — each its own manual-loop)

- L1 `architecture/docs-consolidation.md` — AGENTS.md becomes the single
  normative doc (§1 content, canonized); execute kill list; README stubs for
  the 10 missing components; fix the 3 lying READMEs; unify ADR channels.
- L2 `architecture/skills-cleanup.md` — delete dotnet/devops/pydantic-ai or
  replace devops with a real kustomize/tilt skill; fix multi-tenant skill to
  match reality; strip the React/Tailwind ghost half of yz-ui; untrack-or-track
  decision for gitignored skills.

Dangling refs left by the 2026-07-29 kill-list execution (assigned):
- L1: `DOCS/README.md:126` links the deleted `guides/code-review.md`.
- L2: `skills/skill-registry/SKILL.md:122-130` lists deleted `.cursorrules`/
  `GEMINI.md` as registry targets.
- L2 (PRIORITY): `skills/setup.sh` `--cursor`/`--gemini` flows RECREATE the
  deleted CURSOR/GEMINI/.cursorrules/.gemini artifacts if run — strip those
  flows; until then, do not run setup.sh with those flags.
- L3 `architecture/envelope-drift.md` — DRIFT.md items: stage-1 type, headers
  placement doc fix, depth operator unification, envelope-schema.json rewrite
  or deletion, promote isCompliantEnvelope or add a Zod schema at the bus edge.
- L4 `architecture/enforcement-bootstrap.md` — make lefthook real (or minimal
  CI): doc-code-guards.sh + golden gate + per-service test suites on commit;
  the code-review checklist's 6 BLOCKING rules become lint/guard checks where
  mechanically possible.
- Tenancy convergence (C6) and the 4 orphan services (C10) need Phase 1 code
  audit + a human decision before any loop is written.

### 5. Phase 1 (code audit) — measuring stick now exists

## Progress

- [x] Relevado de base (`AGENTS` y 4 suites de auditoría) y contradicciones
  numeradas.
- [x] Priorizados manual-loops de remediación de fase 3.

## Out of scope (explicit)

- Decisiones de runtime y cambios de implementación.
- Tareas históricas ya cerradas sin evidencia nueva.

## Human boundaries for this change

- Este inventario no aprueba cambios directos; toda remediación queda en SPECs
  posteriores con aprobación humana.

With §1 canonized, the code audit measures every service against: NestJS
conventions (or named exception), x-yoizen-tenant enforcement, causal-chain
contract, fire-and-forget publishing, idempotent DDL, storage-engine
documentation, test presence per suite. Priority targets: the 4 orphan
services (C10) and the tenancy split (C6).
