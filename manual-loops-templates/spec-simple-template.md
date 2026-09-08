# SPEC — <Feature Name>

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Origin: user decision(s) <YYYY-MM-DD> (Cowork session).
> Engram topic: '<namespace/kebab-slug>'.

<!-- TEMPLATE NOTES (delete in real SPECs)
Simple style, based on manual-loops/workflow-toggle.md and trace-console.md
(the origin of the canonical gate prose). Use for small, self-contained loops:
no cross-SPEC dependencies, no prior-art section, no gate overrides.
For anything bigger use spec-canonical-template.md.

CONTEXT CONTRACT (what the engine actually passes to the agents):
- every agent gets full AGENTS.md, task body with allowed paths/non-goals and
  Accept, all Constraints, applicable gates/conditions, and baseline ownership.
- implementer also gets previous-attempt failures on retries.
- reviewers also get staged/unstaged diffs, full untracked new file content,
  actual gate output/statuses, and implementation/model provenance.
Everything the implementer must know (precedent citations, binding decisions,
DO NOTs) must therefore live INSIDE the task body or in Constraints. Goal,
User decisions and Out of scope address the human and the orchestrator.
For FP-scoped work, include QA's acceptance cases and risks before implementation;
the developer owns regression tests and QA's final coverage edits happen before
gates and review. Manual-loop owns retry and closure decisions.
-->

## Goal

<1 short paragraph: the concrete, observable capability being delivered.>

## User decisions (human boundary — do not reinterpret)

1. <Binding choice already made by the human.>
2. <...>

## Constraints (apply to every task)

- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Preserve frameworks/libraries; thin shells call pure business functions with
  typed failures. Effects, exception conversion, and diagnostic logging stay in shell.
- Preserve preexisting and blocked work; report scope expansion before editing.
- Routine build, test, and E2E commands use the configured mechanical executor
  below both the implementation/QA tier and economical coding tier. It runs the
  exact commands in order, stops on first failure, and reports evidence without
  diagnosis, edits, retries, scope changes, or closure decisions. Record approved
  cost exceptions or delegation/unsafe-handoff blockers before execution. Verify
  callability and the applicable tool cost basis; API pricing alone is insufficient.
- Affected builds require pinned runtime/tools, lockfile, frozen installation and
  build commands with actual output/statuses. Persistent writes/migrations require
  boundary/invariant tests and idempotency coverage where applicable.
- <Idempotency, service-boundary, and coding-style rules for this loop.>

## Gates (the `/manual-loop` command runs these verbatim, in order)

One executor owns each command. Handoffs transfer the existing process/run
identity and completion evidence; they never duplicate a command. Persist full
sanitized output, status, duration, tested-state identity, and requested and
observed executor model/session/turn; keep the summary concise.

```
# G0 — repo guards (KISS default, every attempt; --full only for a scoped audit)
./scripts/checks/doc-code-guards.sh
# G1 — <primary service> typecheck (cheapest failure first)
cd services/<svc> && bunx tsc -p tsconfig.json --noEmit
# G2 — <primary service> tests
cd services/<svc> && bun test
# G5a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh <svc> on && ./scripts/e2e/<feature>.sh
# G5b — COMMIT GATE (once per task, built image)
./dev-mode.sh <svc> off && ./rebuild-redeploy.sh <svc> dev && ./scripts/e2e/<feature>.sh
```

Gate ids follow the shared convention: G0 = repo guards, G1/G2 = primary
service typecheck/tests (cheapest failure first), G3/G4 = other touched services (absent in a
single-service loop — do not renumber), G5a/G5b = cluster e2e.

VALIDATOR SAFETY: keep `services/workflow-service/src/main.ts` clean and prevent
concurrent edits. Preflight failures leave it unchanged; unexpected edits after
the canary mutation are preserved with recovery snapshots and a reported failure.
File cleanup is not cluster rollback. If prerequisites cannot be met, report the
blocked precondition without invoking it. See `DOCS/guides/dev-mode.md`.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G5a and rely solely on G5b — and RECORD the skip
(date + failure symptom) in this SPEC's Progress as a pending repair item. A
skipped iteration gate is debt; it does not silently carry over to the next SPEC.

G5a/G5b failures count as failed attempts like any other gate.
Commits only happen with dev-mode OFF and the built image live.

---

## Task queue

### T01 — <short imperative title>

- **Allowed write paths:** <explicit files/directories, including new files/tests>.
- **Non-goals:** <excluded behavior/refactors>.
- <Concrete scope: file paths, signatures, line-cited precedent.>
- <Required unit-test cases.>
- <If FP-scoped: QA acceptance cases received before implementation and the
  developer's required regression tests.>

**Accept**
```
cd services/<svc> && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T0N — Docs + index

- **Allowed write paths:** `services/<svc>/README.md`, `DOCS/archive/INDEX.md`.
- **Non-goals:** Runtime changes or historical record rewrites.
- Update `services/<svc>/README.md`.
- Add an entry to `DOCS/archive/INDEX.md`.

**Accept**
```
grep -n "<expected string>" services/<svc>/README.md DOCS/archive/INDEX.md
```

---

## Progress

- [ ] T01 <label>
- [ ] T0N docs + index

Record actual gate commands/output/statuses, reviewed-state identity, implementer
and two independent reviewer model/run identities and verdicts, retries, fallbacks,
skips, and exceptions. Reviewers must be no weaker than implementer (default opus).
Changed code/artifacts invalidate gates and both reviews; rerun before done.
Missing evidence blocks completion. CI alone does not prove remote merge enforcement.

## Out of scope (explicit)

- <Excluded work> — <one-line reason>.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human runs the first `--apply` of any destructive/administrative script.
