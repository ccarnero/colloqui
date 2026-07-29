# SPEC — Fix the dev-mode validator's stage-5 race (restore G-a iteration gates)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> Origin: user decision 2026-07-29 (Cowork session — rules audit follow-up).
> Engram topic: 'architecture/dev-mode-validator'.

## Goal

`./scripts/validate-dev-mode.sh --with-e2e` exits 0, deterministically. Every
manual-loop's G-a ITERATION gates (fast source-mounted feedback, ~2s reload)
come back to life — since 2026-07-16 all backend loops silently degraded to
commit-gates-only via the PRECONDITION escape hatch.

## User decisions (human boundary — do not reinterpret)

1. Fix the VALIDATOR, not the loops: the race is internal to
   `validate-dev-mode.sh` (twice diagnosed); `dev-mode.sh` itself works.
2. Determinism bar: the validator must pass twice consecutively before this
   loop's tasks may be checked off.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Scripts only — no service source changes in this loop. Bash follows the
  existing style of `scripts/validate-dev-mode.sh` (stages, exit-code
  contract).
- The fix must WAIT for observable readiness, never sleep a fixed guess:
  poll with a bounded timeout and log what it waited for.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — the validator itself, twice (determinism bar, decision 2)
./scripts/validate-dev-mode.sh --with-e2e && ./scripts/validate-dev-mode.sh --with-e2e
```

Gate rules (self-contained): G1 is the acceptance — no dev-mode/G-a/G-b split
in this loop (it repairs that machinery, it cannot depend on it).

---

## Task queue

### T01 — Reproduce and pinpoint the race window (report task, no fix)

- Known symptom (recorded 2026-07-16 in `provisioning-manifest-gaps.md:524`,
  re-confirmed 2026-07-24 in `provisioning-manifest-gaps-4.md` Progress):
  stage 4's canary-revert triggers a second `bun --watch` reload; stage 5's
  e2e hits the API mid-reload (`jq: Cannot index number with string "name"`
  on the workflow LIST). The same e2e passes standalone with dev-mode on AND
  off.
- Instrument or observe: identify the exact window (what stage 4 changes,
  which process reloads, how long the API is inconsistent) and RECORD the
  evidence in this SPEC's Progress under "**T01 findings (recorded <date>):**",
  numbered, with log excerpts.

**Accept**
```
./scripts/validate-dev-mode.sh --with-e2e; test $? -ne 0  # still red, now explained
grep -n "T01 findings" manual-loops/architecture/dev-mode-validator-fix.md
```

### T02 — Close the window: readiness barrier between stage 4 and stage 5

- In `scripts/validate-dev-mode.sh`, after the canary-revert of stage 4:
  wait for the reloaded API to be observably ready before stage 5 starts —
  poll a cheap authenticated endpoint until it returns the expected SHAPE
  (not just 200), bounded timeout, verbose logging of attempts.
- No fixed sleeps (constraint). The barrier logs what it waited for and how
  long it took.
- If T01's findings point at a different mechanism, follow the findings —
  and note the deviation in Progress.

**Accept**
```
./scripts/validate-dev-mode.sh --with-e2e && ./scripts/validate-dev-mode.sh --with-e2e
```

### T03 — Retire the debt notes + docs

- Remove the "KNOWN STATE 2026-07-29 ... expect this skip" note from
  `manual-loops/connectors/connection-call-inspector.md`'s PRECONDITION (the
  anti-zombie rule itself STAYS in both templates and the SPEC).
- `DOCS/guides/dev-mode.md`: document the stage-4→5 readiness barrier and
  the historical race (dated).
- `cowork/INDEX.md` entry; Engram topic `architecture/dev-mode-validator`.

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -c "KNOWN STATE 2026-07-29" manual-loops/connectors/connection-call-inspector.md | grep -x 0
grep -n "dev-mode-validator" cowork/INDEX.md
```

---

## Progress

- [ ] T01 reproduce + pinpoint (report)
- [ ] T02 readiness barrier
- [ ] T03 retire debt notes + docs

## Out of scope (explicit)

- Touching `dev-mode.sh` or any service source — the validator is the patient.
- Making G-a mandatory for admin-console (it has no dev-mode; the skip is by
  design, not debt).

## Human boundaries for this change

- Human approves this SPEC before the first run.
- If T01 reveals the race is NOT internal to the validator (contradicting the
  two prior diagnoses), STOP and re-plan with the human.
