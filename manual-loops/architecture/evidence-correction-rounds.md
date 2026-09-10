# SPEC — Evidence-correction rounds do not consume implementation attempts

> **SUPERSEDED 2026-09-10 — do not run.** Its goal (record corrections must not spend an
> attempt) is already in the restored August manual (`DOCS/guides/manual-loop.md`, step 6:
> "Notes about the record are not objections"). Its tasks would add a classification layer
> to the manual, the templates and `fp-reviewer` — the September accretion retired in
> `a978bf38`. Kept as a record; Progress stays unchecked on purpose.

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/architecture/blocker-handoff-certification.md`
> (run this only after that loop closes; its T01 findings are cited below).
> Origin: user decision 2026-09-08 (Cowork session).
> Engram topic: 'manual-loop/attempt-budget'.

**SCOPE CLASS: dedicated human-approved configuration scope**, for T03 only,
which edits `.codex/agents/fp-reviewer.toml` and one entry of
`.codex/manual-loop.lock.json`. Per AGENTS.md and
`DOCS/guides/codex-manual-loop.md`, a normal feature SPEC cannot authorize that.
T03 is separable: if its sign-off is withheld, T01, T02 and T04 still deliver the
rule change, and T03 is recorded as pending.

---

## Goal

An objection round that finds only evidence or record defects — with neither
reviewer indicating an implementation edit — is classified as an
**evidence-correction round** and does not consume one of the four implementation
attempts. Any objection touching code, tests, scope, or constraints consumes an
attempt exactly as today.

## Why (the category error being corrected)

`manual-loop.md` step 5 currently sends every objection "back to the task's
implementation role as a new attempt". But the implementer does not own the
evidence: the principal assembles it and the mechanical executor produces it.
Routing a duration-recording defect to `fp-dev` asks the wrong role to fix
something it never wrote, and charges the task's implementation budget for it.

Observed instance, cited from the predecessor loop's evidence:
`blocker-handoff-diagnosis-evidence/T01-review-attempt1.md` records Reviewer B
rejecting over an Accept duration written as `0.000003666` against a native
`0.000003875`, plus an omitted runner evidence-write failure. The same document
states: "No implementation edit is currently indicated by either verdict." One of
four attempts was spent with the implementation already correct.

The risk this addresses is concrete. `platform-evaluation-j3-offline-repair.md`
exhausted 4/4 and blocked on a one-line TypeScript narrowing error. A budget that
can be drained by bookkeeping is a budget that runs out before the work does.

## User decisions (human boundary — do not reinterpret)

1. The maximum of **4 implementation attempts** per task is unchanged. Only the
   classification of what consumes one changes.
2. Evidence-correction rounds are **capped at 2 per task**. Exceeding the cap
   blocks the task. An uncapped exemption is a loop that never ends.
3. Classification is made by the **principal**, from the reviewers' own words,
   and is recorded. It is never inferred by the implementer or asserted by a
   reviewer about its own objection.
4. A round qualifies only if **both** reviewers indicate no implementation edit.
   One reviewer requiring a code change makes it an implementation attempt,
   whatever the other found.
5. The "same error twice in a row blocks immediately" invariant applies to
   evidence-correction rounds too: the same evidence defect surviving a
   correction round blocks the task rather than consuming the second one.
6. Reviewers keep their existing severity. This SPEC does not tell them to
   overlook evidence defects; it changes only what a rejection costs.

## Prior art (validated 2026-09-08 — REUSE, do not duplicate)

The engine does not forward this section. Repeat each citation inside the task.

- `DOCS/guides/manual-loop.md`, `## Invariants` — "Max 4 implementation attempts
  per task. The SAME error appearing in 2 consecutive attempts blocks the task
  immediately (do not spend the remaining attempts)."
- `DOCS/guides/manual-loop.md`, `## Per-task cycle` step 5 **Objections** —
  "Each objection round consumes one attempt. Any correction invalidates prior
  evidence and approvals."
- `DOCS/guides/manual-loop.md`, step 6 — "Evidence-only Progress updates do not
  invalidate implementation review; changes to code, task scope, rules, or gate
  commands do." The distinction this SPEC needs already exists in the engine at
  closure; step 5 simply does not use it at objection time.
- `DOCS/guides/agent-roles.md`, `## Mechanical gate execution` — the executor
  produces evidence and "does not diagnose, remediate, edit, retry". It is not a
  role an objection can be routed to as an implementation attempt.
- `DOCS/guides/agent-roles.md`, `## Independent review (fp-reviewer)`, automatic
  rejection 7 — "Contract/evidence gaps". Unchanged by this SPEC.
- `.codex/agents/fp-reviewer.toml` — hash-locked in `.codex/manual-loop.lock.json`
  and validated by `scripts/checks/check-codex-manual-loop.py` (G19). The checker
  reports drift and never refreshes the lock.

## Constraints (apply to every task)

- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- **No prohibition is relaxed.** If any proposed wording could be read as letting
  a reviewer's finding be dismissed, a gate be skipped, a correction escape
  re-running gates and reviews, or an implementation defect be reclassified as
  evidence, stop and report instead of softening it.
- A correction of any kind still invalidates prior gates and both reviews. An
  evidence-correction round costs no attempt; it does not cost less rigor.
- `.codex/**` is writable in T03 only. Elsewhere it is read-only.
- Run every gate and Accept byte-for-byte as written. A command that fails
  because this SPEC is wrong is a blocker to report, never a command to adapt.

## Gates (the `/manual-loop` command runs these verbatim, in order)

One executor owns each command. Persist full sanitized output, status, natively
reported duration, tested-state identity, and requested and observed executor
model/session/turn. Do not round, retype, or recompute a duration.

```
# G0 — repo guards, KISS default (ITERATION, every attempt)
./scripts/checks/doc-code-guards.sh
# G19a — Codex manual-loop policy checker, invoked directly (ITERATION, every attempt)
python3 ./scripts/checks/check-codex-manual-loop.py
# G19b — full guard mode (COMMIT GATE, once per task, after G0 and G19a are green)
./scripts/checks/doc-code-guards.sh --full
```

- **No cluster gates apply.** Markdown guides, one Codex role definition, one lock
  entry. G1-G5b are absent by declaration, not omission; do not renumber.
- **No dev-mode precondition**, since no iteration or built-image gate is
  declared. Record the reasoning in Progress.
- After T03, G19a must be green. Drift means the lock and the file disagree: fix
  one of them, never suppress the checker.

---

## Task queue

### T01 — Classify objection rounds in the engine

- **Allowed write paths:** `DOCS/guides/manual-loop.md`.
- **Non-goals:** `agent-roles.md`, templates, `.codex/**`, and any change to gate
  classes, closure conditions, reviewer independence, or commit authorization.
- Precedent to read first: `## Invariants` and `## Per-task cycle` step 5, quoted
  in Prior art above.
- In `## Invariants`, replace "Max 4 implementation attempts per task." with:

```
- Max 4 implementation attempts per task. An objection round is an
  IMPLEMENTATION ATTEMPT unless the principal classifies it as an
  EVIDENCE-CORRECTION ROUND under step 5; evidence-correction rounds are capped
  at 2 per task and consume no implementation attempt.
```

- Keep the following sentence ("The SAME error appearing in 2 consecutive
  attempts blocks the task immediately") byte-identical, and add after it:

```
  The same rule covers evidence-correction rounds: an evidence defect that
  survives its correction round blocks the task instead of consuming the second.
```

- In step 5 **Objections**, replace "Each objection round consumes one attempt."
  with:

```
   The principal classifies each objection round before dispatching it. A round
   is an EVIDENCE-CORRECTION ROUND only when every objection from BOTH reviewers
   can be resolved by correcting records, evidence files, or provenance, and
   neither reviewer indicates that an implementation edit is required. Such a
   round is dispatched to whoever owns the defective evidence — the principal or
   the mechanical executor — not to the implementation role, and it consumes no
   implementation attempt. At most 2 are allowed per task.

   Every other objection round is an IMPLEMENTATION ATTEMPT and consumes one, as
   before. If either reviewer requires a code, test, scope, or constraint change,
   the round is an implementation attempt regardless of what the other found.

   Record the classification, its justification, and the reviewer wording it
   rests on. An unrecorded classification is an evidence gap. Either way the
   correction invalidates prior gates and approvals: re-run QA, all gates, and
   both reviews.
```

- DO NOT change what reviewers may reject, automatic rejection rule 7, or the
  requirement that both reviewers return APPROVED over unchanged state.
- DO NOT let a classification be made by the implementer or by a reviewer about
  its own objection.

**Accept**
```
grep -c "EVIDENCE-CORRECTION ROUND" DOCS/guides/manual-loop.md && grep -c "capped at 2 per task" DOCS/guides/manual-loop.md && grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
```

### T02 — Record the classification requirement in the authoring templates

- **Allowed write paths:** `manual-loops-templates/README.md`,
  `manual-loops-templates/spec-simple-template.md`,
  `manual-loops-templates/spec-canonical-template.md`.
- **Non-goals:** Existing SPECs under `manual-loops/`, the engine, role
  contracts, `.codex/**`, and any gate id or label.
- In `README.md`, add to the `## Blocker records` section added by the
  predecessor loop:

```
A blocker record states, per attempt, whether the round was an implementation
attempt or an evidence-correction round, and on what reviewer wording the
classification rests. A record that shows a budget exhausted without saying what
each round was spent on cannot be audited.
```

- In BOTH templates, extend the Progress boilerplate sentence that already reads
  "Record actual gate commands/output/statuses, reviewed-state identity, ..." so
  it also names "the classification of each objection round (implementation
  attempt or evidence-correction round) and its justification".
- DO NOT alter gate ids, labels, or the ordering established by the predecessor.

**Accept**
```
grep -c "evidence-correction round" manual-loops-templates/README.md && grep -c "classification of each objection round" manual-loops-templates/spec-simple-template.md manual-loops-templates/spec-canonical-template.md
```

### T03 — Require an explicit implementation-edit indicator from fp-reviewer (DEDICATED SCOPE)

- **Allowed write paths:** `.codex/agents/fp-reviewer.toml`,
  `.codex/manual-loop.lock.json`.
- **Non-goals:** Every other role definition, `.codex/config.toml`, the runner
  pin, `scripts/checks/check-codex-manual-loop.py`, `doc-code-guards.sh`, and the
  model, reasoning effort or sandbox mode of any role.
- **Runs only with the human sign-off recorded in Human boundaries below.**
  Without it, skip this task, record it as pending, and continue to T04.
- Precedent to read first: `.codex/agents/fp-reviewer.toml`, and
  `DOCS/guides/codex-manual-loop.md` for why this file is locked. Note that
  `developer_instructions` is a TOML single-quoted multiline literal (`'''`), so
  no escaping applies and a literal `'''` cannot appear inside it. Preserve
  `name`, `description`, `model`, `model_reasoning_effort` and `sandbox_mode`
  unchanged, and confirm that after editing.
- Append to `developer_instructions`, as its own paragraph:

```
End every REJECTED verdict with one line reading exactly "IMPLEMENTATION EDIT REQUIRED: yes" or "IMPLEMENTATION EDIT REQUIRED: no". Answer no only when every objection you raised can be resolved by correcting records, evidence files, or provenance without touching code, tests, scope, or constraints. This line reports what your own objections require; it does not classify the round, allocate attempts, or decide retry policy, all of which belong to the principal.
```

- Then, and only after the file bytes are final, refresh exactly one lock entry:
  1. Inspect `scripts/checks/check-codex-manual-loop.py` for a supported refresh
     path; if one exists, use it and record the command.
  2. Otherwise edit `.codex/manual-loop.lock.json` by hand, replacing only the
     `.codex/agents/fp-reviewer.toml` value with
     `sha256sum .codex/agents/fp-reviewer.toml`. Leave `version`, `algorithm`,
     key order and the other five entries untouched.
- Record the old hash
  (`3c1d2938403918b35a1050a0338e18252480336a345703cba3a93af5416a05f8`), the new
  hash, and confirmation that the other five entries are unchanged.
- **Known ordering effect, record it rather than working around it:** a running
  Codex session holds the old definition, so this task's own reviews run under it
  and the new instruction takes effect only in a fresh session (`codex -C <repo>`).
  Do not restart sessions or re-run earlier tasks to compensate.
- DO NOT edit the checker to accept the new bytes — automatic rejection.

**Accept**
```
python3 -c "import tomllib; d=tomllib.load(open('.codex/agents/fp-reviewer.toml','rb')); assert d['name']=='fp-reviewer'; assert 'IMPLEMENTATION EDIT REQUIRED' in d['developer_instructions']; print('ok')" && python3 -c "import json,hashlib; l=json.load(open('.codex/manual-loop.lock.json')); h=hashlib.sha256(open('.codex/agents/fp-reviewer.toml','rb').read()).hexdigest(); assert l['files']['.codex/agents/fp-reviewer.toml']==h, 'lock drift'; assert len(l['files'])==6; print('ok')" && python3 ./scripts/checks/check-codex-manual-loop.py
```

### T04 — Docs, index and decision record

- **Allowed write paths:** `DOCS/guides/codex-manual-loop.md`,
  `DOCS/archive/INDEX.md`.
- **Non-goals:** Runtime changes, historical rewrites, and edits to the J3
  blocker or its evidence.
- If T03 ran, add a dated line to `codex-manual-loop.md` recording the
  `fp-reviewer.toml` change, both hashes, that only that one lock entry changed,
  and the fresh-session effect. If T03 was skipped, record it as pending with the
  reason instead.
- Add an entry to `DOCS/archive/INDEX.md` linking this SPEC to its predecessors,
  and log the decision (rule, why, evidence, engram topic
  `manual-loop/attempt-budget`), citing the J3 exhaustion and the T01 objection
  round as the motivating cases.

**Accept**
```
grep -n "attempt-budget" DOCS/archive/INDEX.md && grep -n -E "fp-reviewer|pending" DOCS/guides/codex-manual-loop.md
```

---

## Progress

- [ ] T01 classify objection rounds in manual-loop.md
- [ ] T02 classification requirement in the templates
- [ ] T03 fp-reviewer implementation-edit indicator + lock (dedicated scope)
- [ ] T04 docs, index and decision record

Record actual gate commands, output, exit statuses and natively reported
durations; reviewed-state identity; implementer and both reviewer model/run
identities and verdicts; retries, fallbacks, skips and exceptions. Reviewers must
be no weaker than the implementer. Missing evidence blocks completion.

Record additionally for this queue: the reasoning for declaring no cluster gates
and no dev-mode precondition; the classification of every objection round in this
loop under the rule it introduces, which is the first live test of it; whether
T03 ran or was recorded as pending; and, if it ran, both hashes and the
fresh-session effect.

## Out of scope (explicit)

- Raising or lowering the four-attempt maximum.
- Any change to reviewer severity, automatic rejection rules, gate classes, or
  closure conditions.
- The J3 offline repair blocker and its TypeScript error.
- Retroactive reclassification of rounds in completed loops, including the
  predecessor's T01 attempt 1, which stays recorded as it happened.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- **Human signs off on T03 specifically**, as dedicated configuration scope over
  `.codex/agents/fp-reviewer.toml` and the lock. Without it, T03 is skipped and
  recorded as pending; the rest of the queue still delivers.
- Human confirms the lock refresh before it is committed; a lock change is never
  a routine side effect.
- Raising the evidence-correction cap above 2, or changing the four-attempt
  maximum, requires human sign-off before code lands.
