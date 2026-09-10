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

- Engine: [`DOCS/guides/manual-loop.md`](DOCS/guides/manual-loop.md) — one task
  at a time, gates run verbatim, dual adversarial review, commit per green task.
  Codex runs it as the principal with `.codex/agents/`; Claude Code as
  `/manual-loop` with `.claude/agents/`. Same procedure, same role texts.
- SPECs: `manual-loops/<area>/<name>.md`, authored from
  `manual-loops-templates/` (read `manual-loops-templates/README.md` first —
  it explains the context contract: the implementer receives the task text,
  its acceptance criteria and the SPEC's Constraints; reviewers receive the
  diff, the task text and the Constraints — nothing else).
- The human approves every SPEC before its first run, and every SPEC declares
  its human boundaries.
- AGENTS.md takes precedence over SPEC Constraints, engine, agents, templates,
  skills, and local precedent. Constraints may specialize or tighten this
  contract, never silently weaken it. Report conflicts before implementation.
  Skills are advisory authoring input, not a developer or CI filesystem dependency.
- Each task declares allowed write paths and non-goals. Report required scope
  expansion before editing; preserve preexisting changes and blocked work.
- The principal assistant is the single coordinator: it launches the
  implementer, runs the gates itself, launches two independent reviewers on the
  unchanged diff, and commits or blocks. It never implements or reviews its own
  work. QA and architecture advice are optional roles the SPEC asks for.
- Shared role duties live in [`DOCS/guides/agent-roles.md`](DOCS/guides/agent-roles.md).
- Manual-loop owns retries, corrections, and task closure. FP role commands are
  specialist instructions and must not start a competing retry or closure loop.

## Universal rules (every service, every change)

1. Never weaken, skip, or delete an existing test — automatic reviewer
   rejection.
2. Verbose diagnostic logging belongs in the imperative shell on new action
   and failure paths; nothing fails silently. Calculations never log.
3. No hardcoded secrets, keys, tokens, or passwords — automatic reviewer
   rejection. Secret values never appear in logs, events, API responses, or
   persisted state.
4. Tests land in the same task/commit as the behavior they judge; every bug
   fix carries a regression test.
5. All artifacts in English: code, comments, UI strings, docs, commit
   messages. Conventional commits, no AI attribution. ONE named exception:
   `skills/envelope-messages/references/diseno-mensajes.md` keeps its Spanish
   FILENAME (its content is English) because `SKILL.md` references it by that
   exact path — the file's own header states this.
6. DDL and provisioning scripts are idempotent (`CREATE ... IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`); destructive scripts are dry-run by default
   and a human runs the first `--apply`.
7. Event publishing is fire-and-forget: emitting never fails or delays the
   operation that emits. On `DepthExceededError`, fall back to a root event
   with a warn log — an orphan event beats a lost event.
8. Reuse before rewrite: if a symbol, schema, or helper exists in
   `packages/shared` (or another shared package), import it. Never redefine
   an envelope, subject, or event shape locally.
9. Shell scripts target **bash 3.2** (macOS `/bin/bash`; the team runs macOS
   and Linux, and 3.2 syntax is the subset that runs natively on both with
   zero setup). Forbidden: `mapfile`/`readarray`, associative arrays
   (`declare -A`), `case` inside `$()`. Canonical patterns:
   `scripts/reset/purge-temporal.sh` (while-read over herestrings),
   `rebuild-changed.sh`. Enforced by G16 in
   `scripts/checks/doc-code-guards.sh`. (User ruling 2026-08-07, Option 1 —
   see `PENDIENTES/10-bash32-en-agents-md.md`.)

## Binding styles per surface

Across all surfaces, business logic is data plus pure functions returning values
or typed failures using existing Result/error conventions. Calculations do not
call effects, including injected I/O callbacks, or use exception control flow.
The shell reads inputs, calls calculations, then applies outcomes; it owns I/O,
logging, time, randomness, environment access, mutation, and exception conversion.
Framework classes remain thin shells delegating business decisions to the core.
Keep existing frameworks and libraries; new libraries (including Effect) and
service migrations require separate approved scope. Local precedent cannot
override this boundary. Record existing deviations by path and remediation scope;
do not copy them or turn a scoped change into a service rewrite.

| Surface | Style |
|:---|:---|
| Backend services (default) | NestJS-on-Bun: thin modules/services, class-validator DTOs, `@TenantId()` + `TenantGuard`; pure business functions follow the boundary above. Preserve framework idioms. |
| `tracking-ingester-service` | Named exception: pure functions in `src/lib/*` (one per file), ALL I/O in `main.ts`, plain Bun — NO NestJS. |
| `admin-console` | Angular standalone components, signals, OnPush, lazy `loadComponent` routes, inline SVG (no chart libs), tokens-only colors (no NEW hard-coded hex — guard `G14` fails on hex added in a diff; the 58 files that already carry one are grandfathered debt, fix on touch), no new libraries without human approval. Visual contract: `manual-loops/admin-console/design/Rediseño Terminal.dc.html` — deviations need human sign-off. |
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

- Completion requires actual gate commands, exit statuses and output, plus two
  independent APPROVED reviews of the same changes. Missing gates or a missing
  verdict is a blocker, not approval.
- Gate evidence is exit status plus trimmed output per gate, kept with the SPEC.
  After completion or blocking, Progress carries achieved, remaining and blocked
  work, the attempt count, tokens against the ceiling, and the validation
  outcome. Read the full applicable AGENTS.md and approved SPEC before
  execution; a compact summary is navigation, not an execution contract.
  Retired evidence cannot serve as a baseline or as gate/review proof for new
  work; a resumed or follow-up task captures fresh state and reruns its applicable
  validation. Retirement does not invalidate the historical closure it summarized.
- Review all task changes: staged and unstaged diffs plus full untracked new
  file content. Identify preexisting changes separately without discarding them.
  Any change to reviewed code or task artifacts invalidates gates and reviews;
  rerun applicable gates and both reviews before completion. A compact status
  update after validation must not alter the reviewed implementation or contract.
- For affected builds, record pinned runtime/tool versions, lockfile and frozen
  installation command/output, and build command/output for the reviewed state.
  Report unavailable prerequisites; do not claim reproducibility without evidence.
- Test pure decisions with data-driven cases without I/O mocks. Affected
  persistent writes and migrations require boundary/invariant tests covering
  validation, failure behavior, and idempotency where applicable.
- CI runs existing KISS guards; it neither certifies every service nor establishes
  remotely required merge checks. Claim branch protection only after verification.

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
  `multi-tenant`, `playwright`, `yz-ui`, `judgment-day`, `skill-registry`,
  `_shared`.
  Skills are advisory; SPEC Constraints bind within AGENTS.md precedence.
- `DOCS/archive/INDEX.md` — registry of shipped changes; every SPEC's docs task
  adds its entry.
- **Doc classes.** Every file under `DOCS/**` and every `services/*/README.md`
  and `packages/*/README.md` declares its class and a one-line summary in its
  first 10 lines; guard `G12` fails otherwise. The five classes:
  `descriptive` (as-built — the code decides), `prescriptive` (a contract or
  procedure the code must obey), `future` (`DOCS/v_next/` only — not
  implemented), `RECORD` (dated, frozen, never rewritten) and `register`
  (dated rows amended in place, e.g.
  `DOCS/architecture/decision-log.md`, `SCHEMAS.md`,
  `DOCS/archive/INDEX.md`).
- `DOCS/archive/` — the single home for dated records that are not loop
  records: the retired `cowork/` audits (`archive/audits/`), the change
  register, the run-view visual contract, the archived runbooks. Everything
  there declares `Status: historical` (or `Status: append-only` for the one
  register); guard `G6f` fails otherwise.
- `.sdd/` — a SECOND record system that is alive and blessed: per-change
  `explore/design/adr/tasks/archive` folders under `.sdd/changes/`. It is the
  named replacement for several deleted `cowork/` handoffs. It is NOT the
  retired repo-level SDD tooling listed below — that was the orchestrator
  commands and agents, not these records.

## FP delivery roles

The repository's shared role contract is documented in
[`DOCS/guides/agent-roles.md`](DOCS/guides/agent-roles.md), and its execution
procedure in [`DOCS/guides/manual-loop.md`](DOCS/guides/manual-loop.md).
Which model runs which role is configuration in `.codex/config.toml` and
`.codex/agents/*.toml`; no role is asked to prove it. The implementer and reviewer
texts are identical in `.codex/agents/` and `.claude/agents/`, and G19
(`scripts/checks/check-loop-roles-sync.py`) fails when they differ. A SPEC about
the loop itself — its roles, procedure or checks — is not a task queue; it is a
configuration change and goes through the human directly.

## Retired 2026-07-29 (do not resurrect)

- Repo-level SDD tooling (root CLAUDE.md orchestrator text,
  `.claude/commands/sdd/`, `.claude/agents/sdd-*`, `.ywai/`,
  `.github/prompts/`) — SDD lives in the user's global toolkit, not here.
- `CURSOR.md`, `GEMINI.md`, `.cursorrules`, `.gemini/`, and the former copied
  `.claude/CLAUDE.md` — drifted instruction copies; this file replaced them.
- `DOCS/guides/code-review.md` — its blocking rules are preserved in the
  independent-review section of [`DOCS/guides/agent-roles.md`](DOCS/guides/agent-roles.md).
- Stale skills (`dotnet`, `devops`, `pydantic-ai`, `tailwind-4`) — they
  legislated for stacks this repo does not have.
