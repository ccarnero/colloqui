# SPEC — <Feature Name> (<surface, e.g. admin console / hosted services>)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/<prereq>.md` (<status: shipped / done N/N / "degrade gracefully if not shipped yet">)
> Origin: user decision(s) <YYYY-MM-DD> (Cowork session<, detail>).
> Engram topic: '<namespace/kebab-slug>'.

<!-- TEMPLATE NOTES (delete in real SPECs)
Canonical style, reverse-engineered from manual-loops/connector-invoke-api.md
(most evolved) with conventions shared by all 7 loops as of 2026-07-14.
Use this template when the loop has cross-SPEC dependencies, prior art to
protect, or needs to override inherited gate rules. For small self-contained
loops use spec-simple-template.md instead.

CONTEXT CONTRACT (what the engine actually passes to the agents):
- implementer gets ONLY: the task body + its Accept block + the Constraints
  section (+ previous-attempt failures on retries).
- reviewers get ONLY: the diff + the task text + the Constraints section.
Everything the implementer must know (precedent citations, binding decisions,
DO NOTs) must therefore live INSIDE the task body or in Constraints. Goal,
User decisions, Prior art and Out of scope address the human and the
orchestrator.
-->

## Goal

<1 short paragraph or numbered list of user/system-observable outcomes.
No implementation detail — that belongs in the tasks.>

## User decisions (human boundary — do not reinterpret)

1. <Binding choice already made by the human. The loop must not revisit or
   reinterpret it mid-flight.>
2. <...>

## Prior art (validated <YYYY-MM-DD> — REUSE, do not duplicate)

The engine does not forward this section — it is the author-facing registry.
Repeat each citation inside the body of the task that uses it.

- `<path/file.ts:123-145>` — <what exists and must be reused instead of rewritten>
- `<path/other.ts:42>` — <...>

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- DDL/SQL and provisioning scripts are idempotent (`ADD COLUMN IF NOT EXISTS`,
  `CREATE ... IF NOT EXISTS`).
- <Service-boundary rules: which services may be touched, coding style per
  service (NestJS vs plain Bun vs Angular), data ownership boundaries.>

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — <primary service> tests
cd services/<svc> && bun test
# G2 — <primary service> typecheck
cd services/<svc> && bunx tsc -p tsconfig.json --noEmit
# G3 — <other touched service> tests (from T0N onward)
cd services/<other> && bun test
# G5a — ITERATION (per attempt, source-mounted dev mode; admin-console has no dev-mode — skip)
./dev-mode.sh deps && ./dev-mode.sh <svc> on && ./scripts/e2e-<feature>.sh
# G5b — COMMIT GATE (once per task, built image)
./dev-mode.sh <svc> off && ./rebuild-redeploy.sh <svc> dev && ./scripts/e2e-<feature>.sh
```

Gate rules (self-contained — the engine runs THIS file verbatim; never
inherit rules by reference to another SPEC):

- ALL existing unit AND integration tests must pass — in every touched
  service, every task. Weakening, skipping, or deleting an existing test is
  an automatic reviewer rejection.
- G5b runs for every task; a diff touching `packages/shared` redeploys every
  dependent service. The cluster must never drift from the branch.
- <Overrides for THIS queue, e.g. "no baseline/precondition e2e — the
  previous attempt's green run IS the baseline; supersedes the rule above">.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G5a and rely solely on G5b.

E2E CLEANUP: every e2e script tears down what it creates — trap-guarded,
account-scoped, idempotent teardown. G5a/G5b failures count as failed attempts
like any other gate.

Commits only happen with dev-mode OFF and the built image live.

---

## Task queue

### T01 — <short imperative title>

- <Concrete scope: file paths, function/class names, exact signatures,
  line-cited precedent (`workflows.service.ts:284-388`).>
- <Explicit DO / DO NOT statements.>
- <Required unit-test cases: "Unit tests: success, expired, timeout, malformed input".>
- <Dependencies on other tasks in prose: "reuses T02's PUT/recreate path".>

**Accept**
```
cd services/<svc> && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T02 — <diagnosis/report task, no code (optional pattern)>

- <Investigative instructions. Findings are recorded verbatim in this SPEC's
  progress entry under a "**T02 findings (recorded <date>):**" sub-heading,
  numbered, with SQL/log evidence quoted.>

**Accept**
```
<command proving the investigation ran, e.g. a grep/psql check>
```

### T0N — Docs + index

- Update `services/<svc>/README.md` with the new contract/behavior.
- <Update `DOCS/<area>/<doc>.md`, `SCHEMAS.md`, `TAXONOMY.md` if applicable.>
- Add an entry to `cowork/INDEX.md`.
- Log the decision (rule, why, evidence, engram topic) tying back to
  "User decisions" and the preamble's Engram topic.

**Accept**
```
grep -n "<expected string>" services/<svc>/README.md cowork/INDEX.md
```

---

## Progress

- [ ] T01 <label>
- [ ] T02 <label>
- [ ] T0N docs + index

<!-- Progress convention: entries above grow into a changelog as tasks
complete — record findings, human-approved mid-flight design changes
("DESIGN CHANGE (human-approved <date>): ..."), bonus fixes, and
"FOLLOW-UPS (reviewer-flagged, non-blocking)" sub-lists. New tasks are
APPENDED with "Added <date> after <reason>" provenance — never renumber
existing tasks. Retry blocks get an inline "> RETRY NOTE (<date>, after
N-attempt block — see BLOCKED.md): ..." inside the task body. -->

## Out of scope (explicit)

- <Excluded work> — <one-line reason>.
- <...>

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human runs the first `--apply` of any destructive/administrative script.
- <Naming/taxonomy changes are approved by the human BEFORE code lands.>
- <Deviating from a binding visual/design contract requires human sign-off.>
- <Changing a human-decided default (retention window, TTL, cap) requires
  human sign-off.>
