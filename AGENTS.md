# AGENTS.md — the platform-cluster constitution

> The single normative document for this repository. Written 2026-07-29 from
> the Phase 0 rules audit (`manual-loops/architecture/phase0-rules-inventory.md`),
> which canonized the rules the codebase actually follows. If any other
> document contradicts this one, THIS file wins — fix the other document.
> Rules here are enforced by the manual-loop system (gates + dual review),
> not by good intentions: a rule that cannot be checked by a gate or a
> reviewer belongs in a guide, not here.

## How work gets done

All non-trivial changes go through the **manual-loop system**:

- Engine: `.claude/commands/manual-loop.md` — one task at a time, gates run
  verbatim, dual adversarial review, commit per green task.
- Agents: `.claude/agents/implementer.md` (writes code) and
  `.claude/agents/reviewer.md` ×2 (judge the diff; their automatic-rejection
  list is part of this constitution).
- SPECs: `manual-loops/<area>/<name>.md`, authored from
  `manual-loops-templates/` (read `manual-loops-templates/README.md` first —
  it explains the context contract: agents only see the task body, its Accept
  block, and the Constraints section).
- The human approves every SPEC before its first run, and every SPEC declares
  its Engram topic and its human boundaries.

## Universal rules (every service, every change)

1. Never weaken, skip, or delete an existing test — automatic reviewer
   rejection.
2. Verbose logging on every new code path; nothing fails silently.
3. No hardcoded secrets, keys, tokens, or passwords — automatic reviewer
   rejection. Secret values never appear in logs, events, API responses, or
   persisted state.
4. Tests land in the same task/commit as the behavior they judge; every bug
   fix carries a regression test.
5. All artifacts in English: code, comments, UI strings, docs, commit
   messages. Conventional commits, no AI attribution.
6. DDL and provisioning scripts are idempotent (`CREATE ... IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`); destructive scripts are dry-run by default
   and a human runs the first `--apply`.
7. Event publishing is fire-and-forget: emitting never fails or delays the
   operation that emits. On `DepthExceededError`, fall back to a root event
   with a warn log — an orphan event beats a lost event.
8. Reuse before rewrite: if a symbol, schema, or helper exists in
   `packages/shared` (or another shared package), import it. Never redefine
   an envelope, subject, or event shape locally.

## Binding styles per surface

| Surface | Style |
|:---|:---|
| Backend services (default) | NestJS-on-Bun: modules/services, class-validator DTOs, `@TenantId()` + `TenantGuard`. Follow the file you are editing, not personal taste. |
| `tracking-ingester-service` | Named exception: pure functions in `src/lib/*` (one per file), ALL I/O in `main.ts`, plain Bun — NO NestJS. |
| `admin-console` | Angular standalone components, signals, OnPush, lazy `loadComponent` routes, inline SVG (no chart libs), tokens-only colors (no hard-coded hex — reviewer rejection), no new libraries without human approval. Visual contract: `manual-loops/admin-console/design/Rediseño Terminal.dc.html` — deviations need human sign-off. |
| `api-gateway` | New routes are explicit proxy modules; global guards apply; no `@Public()`. The gateway never auto-forwards. |
| `connector-runtime` | Pure core libs (no Temporal/NATS/Express imports); Result types in core; `ApplicationFailure` mapping only in the activity wrapper. |
| `workflow-service` | Temporal workflow code stays deterministic: publishes happen in activities, never inline in workflow code. One publish path. |

## Platform contracts

- **Eventing**: every bus message is the canonical envelope
  (`packages/shared/src/interfaces.ts`; prose spec `DOCS/messaging/envelope.md`;
  drift status `SCHEMAS.md`). Subject grammar is the 8-token
  `evt.<tenant>.<producer>.<domain>.<channel>.<provider>.<kind>.v<version>`.
  Causal chain: `correlation_id` copied, `causation_id = parent id`,
  `depth + 1`. Flat `EVENTS`/`RESULTS` streams are deprecated — never in new
  code.
- **Taxonomy**: a new event kind lands with its TAXONOMY.md rule, its
  `classify.ts` change, AND its golden fixture in the same commit — the
  golden suite (`golden/labeled.tsv`) is the gate.
- **Tenancy**: `x-yoizen-tenant` header + tenant-scoped JWT. The default
  isolation model is one database per tenant (the DB is the boundary; no
  `tenant_id` columns). KNOWN EXCEPTION: `registry-service` uses shared
  tables with `tenant_id` — a standing, undecided divergence. Do NOT copy
  either model into a new service without a human decision.
- **Storage engine**: services using `resolveStorageEngine()` support
  Postgres and Mongo; both schemas update in the same task and the service
  README documents `DB_ENGINE`/`STORAGE_ENGINE`.
- **Payload hygiene**: `data.payload` is never logged (use
  `envelopeLogFields`/`logWithEnvelope`); captured HTTP headers are redacted,
  bodies truncated at 8KB; payload viewing goes through the guarded tracking
  endpoint (`tracking:payload:read` + audit event).

## Verification

- Gates live in each SPEC and run verbatim. Standard set: `G0`
  `scripts/checks/doc-code-guards.sh` (doc/code drift), per-service suites,
  cluster e2e (`scripts/e2e/`) in dev-mode iteration (G-a) and built-image
  commit gate (G-b). Commits only with dev-mode OFF and the built image live.
- A skipped iteration gate (failed `validate-dev-mode.sh` precondition) is
  recorded DEBT in the SPEC's Progress, never a silent permanent state.
  Known debt 2026-07-29: the validator's internal stage-5 race.
- Cluster bring-up, seeding, and reset tooling: `README.md` (repo root).

## Where the rest lives

- `README.md` — dev environment, bootstrap, e2e ordering, reset scripts.
- `SCHEMAS.md` / `TAXONOMY.md` / `DOCS/messaging/` — the eventing spine.
- `DOCS/guides/dev-mode.md` — dev-mode operations.
- `skills/` (symlinked at `.claude/skills/`) — authoring aids for humans and
  the orchestrator: `angular/*`, `envelope-messages`, `git-commit`,
  `multi-tenant`, `yz-ui`, `judgment-day`, `skill-registry`, `_shared`.
  Skills are advisory; SPEC Constraints are binding.
- `cowork/INDEX.md` — registry of shipped changes; every SPEC's docs task
  adds its entry.

## Retired 2026-07-29 (do not resurrect)

- Repo-level SDD tooling (root CLAUDE.md orchestrator text,
  `.claude/commands/sdd/`, `.claude/agents/sdd-*`, `.ywai/`,
  `.github/prompts/`) — SDD lives in the user's global toolkit, not here.
- `CURSOR.md`, `GEMINI.md`, `.cursorrules`, `.gemini/`, `.claude/CLAUDE.md`
  — drifted instruction copies; this file replaced them.
- `DOCS/guides/code-review.md` — its blocking rules are baked into
  `.claude/agents/reviewer.md`.
- Stale skills (`dotnet`, `devops`, `pydantic-ai`, `tailwind-4`) — they
  legislated for stacks this repo does not have.
