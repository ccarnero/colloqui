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
# G1 — <primary service> tests
cd services/<svc> && bun test
# G2 — <primary service> typecheck
cd services/<svc> && bunx tsc -p tsconfig.json --noEmit
# G5a — ITERATION (per attempt, source-mounted dev mode)
./dev-mode.sh deps && ./dev-mode.sh <svc> on && ./scripts/e2e-<feature>.sh
# G5b — COMMIT GATE (once per task, built image)
./dev-mode.sh <svc> off && ./rebuild-redeploy.sh <svc> dev && ./scripts/e2e-<feature>.sh
```

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G5a and rely solely on G5b.

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
- Add an entry to `cowork/INDEX.md`.

**Accept**
```
grep -n "<expected string>" services/<svc>/README.md cowork/INDEX.md
```

---

## Progress

- [ ] T01 <label>
- [ ] T0N docs + index

## Out of scope (explicit)

- <Excluded work> — <one-line reason>.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human runs the first `--apply` of any destructive/administrative script.
