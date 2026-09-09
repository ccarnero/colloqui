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
- implementer gets ONLY: the task body + its Accept block + the Constraints
  section (+ previous-attempt failures on retries).
- reviewers get ONLY: the diff + the task text + the Constraints section.
Everything the implementer must know (precedent citations, binding decisions,
DO NOTs) must therefore live INSIDE the task body or in Constraints. Goal,
User decisions and Out of scope address the human and the orchestrator.
-->

## Goal

<1 short paragraph: the concrete, observable capability being delivered.>

## User decisions (human boundary — do not reinterpret)

1. <Binding choice already made by the human.>
2. <...>

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- <Idempotency, service-boundary, and coding-style rules for this loop.>

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — <primary service> tests
cd services/<svc> && bun test
# G2 — <primary service> typecheck
cd services/<svc> && bunx tsc -p tsconfig.json --noEmit
# G5a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh <svc> on && ./scripts/e2e/<feature>.sh
# G5b — COMMIT GATE (once per task, built image)
./dev-mode.sh <svc> off && ./rebuild-redeploy.sh <svc> dev && ./scripts/e2e/<feature>.sh
```

Gate ids follow the shared convention: G0 = repo guards, G1/G2 = primary
service tests/typecheck, G3/G4 = other touched services (absent in a
single-service loop — do not renumber), G5a/G5b = cluster e2e.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G5a and rely solely on G5b — and RECORD the skip
(date + failure symptom) in this SPEC's Progress as a pending repair item. A
skipped iteration gate is debt; it does not silently carry over to the next SPEC.

G5a/G5b failures count as failed attempts like any other gate.
Commits only happen with dev-mode OFF and the built image live.

---

## Task queue

### T01 — <short imperative title>

- <Concrete scope: file paths, signatures, line-cited precedent.>
- <Required unit-test cases.>

**Accept**
```
cd services/<svc> && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T0N — Docs + index

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

Token ceiling: <N> M per task, every thread including the orchestrator. Crossing it
blocks the task like an exhausted attempt budget; the monitor alerts on it.

## Out of scope (explicit)

- <Excluded work> — <one-line reason>.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human runs the first `--apply` of any destructive/administrative script.
