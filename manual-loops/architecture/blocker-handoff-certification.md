# SPEC — Certification of the blocker-handoff-diagnosis committed state

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/architecture/blocker-handoff-diagnosis.md`
> (committed 612285ef..820221a9; implementation correct, certification incomplete).
> Origin: user decision 2026-09-08 (Cowork session, after an audit of the
> predecessor's evidence directory).
> Engram topic: 'manual-loop/blocker-handoff'.

> REVISION 2 (2026-09-08, before first execution): QA blocked revision 1 with
> three defects, all confirmed and corrected here. (a) T01 instructed the
> implementer to state that no APPROVED exists, contradicting
> `T01-review-attempt1.md`, which records Reviewer A APPROVED. (b) T03 and T04
> chained a required-zero `grep -c` with `&&`; `grep -c` exits 1 on a zero count,
> so those Accepts failed precisely when the task succeeded. (c) T04 assumed the
> predecessor's Accept still read `"Para humanos"`, presupposing the outcome that
> T01 exists to establish; QA found it already reads `"For humans"`. No gates,
> attempts or commits were spent. The block was correct behavior: this SPEC
> forbids adapting a defective command, and QA reported instead of adapting.
>
> REVISION 3 (2026-09-08, before first execution): QA blocked revision 2 with a
> fourth defect, also confirmed. The Constraints section had imported the generic
> template requirement that the mechanical executor sit below BOTH the
> implementation/QA tier and the economical coding tier. This repository holds a
> human-approved cost-policy exception, recorded in
> `DOCS/guides/codex-manual-loop.md`, under which its runner may equal the
> economical coding tier; the approved pin `gpt-5.6-luna` sits at that tier, not
> below it. As written, the SPEC forbade its own approved runner and would have
> blocked gate execution. Corrected in Constraints. The templates' own warning
> covers this case: "Do not copy executable examples without checking
> applicability." Still no gates, attempts or commits spent.

**This SPEC certifies an already-committed state. It changes no behavior.** The
predecessor's implementation was verified independently before this SPEC was
written: `.codex/manual-loop.lock.json` matches `.codex/agents/fp-dev.toml`
(`5b009539…`), `check-codex-manual-loop.py` exits 0, and the three intended text
changes are present. What is missing is the record that certifies it.

---

## Goal

The predecessor's committed state carries a complete, accurate certification
record: two independent verdicts over that exact state, a Progress section
containing real evidence rather than template instructions, and an honest account
of the two contract deviations found in its evidence directory.

Nothing is reimplemented, reverted, or re-executed to produce this. The
predecessor's 82 evidence files are the source; this SPEC indexes, audits, and
completes them.

## User decisions (human boundary — do not reinterpret)

1. The predecessor's commits stay. No revert, no rebase, no history rewrite.
2. No task of the predecessor is reopened or reimplemented.
3. Where a required record does not exist in the predecessor's evidence, write
   "not recorded" and say what is missing. **Never reconstruct a value from
   memory, inference, or recomputation and present it as an original record.** A
   declared hole is the acceptable outcome; a plausible invention is not.
4. The `"Para humanos"` → `"For humans"` change to the section header is
   accepted on its merits — the guide is written in English. What requires
   correction is that the approved Accept command was not what executed.
5. Attempt-budget rules are unchanged by this SPEC. A separate SPEC addresses them.

## Prior art (validated 2026-09-08 — REUSE, do not duplicate)

The engine does not forward this section. Repeat each citation inside the task
that uses it.

- `manual-loops/architecture/blocker-handoff-diagnosis-evidence/` — 82 files.
  Per predecessor task: `T0N-gates.json`, `T0N-gate-NN.txt` or
  `T0N-gate-NN.stdout.txt`, `T0N-task.diff`, `T0N-staged.diff`,
  `T0N-unstaged.diff`, `T0N-state.json`, `T0N-preservation.json`,
  `T0N-implementation-qa.md`. Plus `baseline-status.txt`, `baseline-staged.diff`,
  `baseline-unstaged.diff`, `preflight-provenance.json`.
- `…-evidence/T01-attempt2-gate-04.txt` — records
  `COMMAND: grep -n "For humans" …`, `EXIT_STATUS: 0`. The approved SPEC's T01
  Accept specified `grep -n "Para humanos" …`. This is DEVIATION A.
- `…-evidence/independent-review-verdicts.json` — two runs
  (`01a08230-49e4-7700-bf92-c2ccaef49efb`,
  `01a08230-94f8-7673-89b0-e35ee7090c30`), both with `final_verdicts: []`.
  No final APPROVED exists for any of the predecessor's five tasks.
  This is DEVIATION B.
- `…-evidence/T01-review-attempt1.md` — the only verdict document in existence.
  Reviewer A APPROVED; Reviewer B REJECTED over an Accept duration recorded as
  `0.000003666` against a native `0.000003875`, and an omitted runner
  evidence-write failure at 18:01:21–18:01:27 UTC. It closes with "No
  implementation edit is currently indicated by either verdict."
- `DOCS/guides/manual-loop.md` step 6 — "A task is committed ONLY when
  authorized, all gates are green, and both reviewers returned APPROVED for the
  unchanged task state." Step 4 — "Missing review coverage or independent
  provenance blocks completion."
- `DOCS/guides/agent-roles.md`, `## Mechanical gate execution` — "Execute only
  the exact commands supplied by the approved SPEC."
- `DOCS/guides/agent-roles.md`, `## Implementation (fp-dev)` — "do not touch the
  SPEC file."
- `DOCS/guides/manual-loop.md` step 6 — "Evidence-only Progress updates do not
  invalidate implementation review; changes to code, task scope, rules, or gate
  commands do." This is why T03 below is safe and T04 is not evidence-only.

## Constraints (apply to every task)

- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- **No runtime change.** No task here edits `.codex/**`, `DOCS/guides/manual-loop.md`
  body rules, `DOCS/guides/agent-roles.md`, `manual-loops-templates/`, any script,
  or any service. An edit to those paths is scope creep and an automatic rejection.
- **No reconstruction.** Every recorded value must be quoted or cited from an
  existing file in the predecessor's evidence directory, with the file name. A
  value that cannot be cited is written as "not recorded" with a one-line note.
  Recomputing a duration, a hash, or a model identity after the fact and
  presenting it as the original record is falsification.
- Preserve preexisting and blocked work. The J3 offline repair loop and its
  evidence are read-only here and are not addressed by this SPEC.
- Routine build, test, and E2E commands use the configured mechanical executor.
  **This project's human-approved cost-policy exception applies**, as recorded in
  `DOCS/guides/codex-manual-loop.md`: its runner may EQUAL the economical coding
  tier while remaining below the implementation/QA tier, and the approved pin is
  `gpt-5.6-luna` at low reasoning effort. Do not import the generic template
  wording that requires the executor to sit below both tiers; taken literally it
  forbids this repository's own approved runner. The executor runs the exact
  commands in order, stops on first failure, and reports evidence without
  diagnosis, edits, retries, scope changes, or closure decisions. Before gates,
  verify the runner's native callability and its applicable cost basis; public
  API pricing alone does not establish billing. There is no automatic fallback to
  a higher-cost model, and exceeding the ceiling needs a separate human approval.
- **Run every Accept and gate byte-for-byte as written here.** If a command fails
  because this SPEC is wrong, that is a blocker to report — not a command to
  adapt. Adapting a command to make it pass is the exact defect this SPEC exists
  to correct, and doing it here is an automatic rejection.

## Gates (the `/manual-loop` command runs these verbatim, in order)

One executor owns each command. Handoffs transfer the existing process/run
identity and completion evidence; they never duplicate a command. Persist full
sanitized output, status, duration, tested-state identity, and requested and
observed executor model/session/turn. Record durations as reported natively; do
not round, retype, or recompute them.

```
# G0 — repo guards, KISS default (ITERATION, every attempt)
./scripts/checks/doc-code-guards.sh
# G19a — Codex manual-loop policy checker, invoked directly (ITERATION, every attempt)
python3 ./scripts/checks/check-codex-manual-loop.py
# G19b — full guard mode (COMMIT GATE, once per task, after G0 and G19a are green)
./scripts/checks/doc-code-guards.sh --full
```

Gate rules (self-contained — the engine runs THIS file verbatim; never inherit
rules by reference to another SPEC):

- **No cluster gates apply.** This queue writes Markdown records only. No service
  source, no config, no persistent writes, no built image. G1-G5b are absent by
  declaration, not omission. Do not renumber and do not substitute.
- **No dev-mode precondition.** No iteration or built-image gate is declared, so
  `./scripts/validate-dev-mode.sh --with-e2e` is neither required nor skipped
  debt. Record this reasoning in Progress.
- G19a must stay green throughout. This SPEC touches no locked file, so a drift
  report here means something outside its scope changed: stop and report.

## Review packet (binding, additional to the engine default)

For **T02 only**, the two independent reviewers must additionally receive the
predecessor's full committed change set as their review target:

```
git diff 3fe4263c..820221a9 -- DOCS/ .codex/ manual-loops-templates/
git log --oneline 3fe4263c..820221a9
```

T02's purpose is to obtain two independent verdicts over that state. A reviewer
who assesses only the certification packet and not the predecessor's diff has not
performed the required review; the principal must reject that verdict as
incomplete coverage rather than count it.

---

## Task queue

### T01 — Establish and record the two deviations (report only, no correction)

- **Allowed write paths:**
  `manual-loops/architecture/blocker-handoff-certification-evidence/deviations.md`
  (new file and its parent directory).
- **Non-goals:** Correcting either deviation, editing the predecessor SPEC, and
  any judgement about blame or intent. Findings only.
- **DEVIATION A — altered Accept.** Determine which contract was breached, by
  reading both artifacts:
  1. The approved T01 Accept in `manual-loops/architecture/blocker-handoff-diagnosis.md`.
     Extract it with `grep -n -A6 '^\*\*Accept\*\*'` — a `sed` range ending at
     ``` matches the opening fence and returns nothing.
  2. `…-evidence/T01-attempt2-gate-04.txt`, which records the executed command.
  - If the SPEC still reads `"Para humanos"`, the runner did not execute the
    approved command verbatim (`agent-roles.md`, Mechanical gate execution).
  - If the SPEC reads `"For humans"`, the SPEC file was edited mid-flight, which
    `fp-dev` is forbidden to do and which required human sign-off.
  - Record which of the two it is, quoting both artifacts. If the evidence does
    not distinguish them, say so; do not pick the more comfortable reading.
  - Also check `T01-gate-04.stdout.txt` (attempt 1) for the same command and
    report whether the substitution predates the objection round.
- **DEVIATION B — absent final verdicts.** Quote `independent-review-verdicts.json`
  in full. Confirm by enumeration that no other verdict document exists
  (`ls -1 …-evidence | grep -i review`). State precisely what is and is not on
  record:
  - `T01-review-attempt1.md` records TWO verdicts for T01 attempt 1 — Reviewer A
    APPROVED, Reviewer B REJECTED.
  - Both runs in `independent-review-verdicts.json` carry `final_verdicts: []`.
  - Therefore no predecessor task has two recorded APPROVED verdicts over its
    final state, and no verdict of any kind exists for T01 attempt 2 or for
    T02-T05.
  Do NOT write that no APPROVED exists anywhere. Reviewer A's approval of T01
  attempt 1 is on record and must be reported as such. The defect is the absence
  of dual approval over final state, not the absence of all approval.
- **Also record, without editorialising:** that `T01-review-attempt1.md` states
  "No implementation edit is currently indicated by either verdict", and that the
  objection round was therefore consumed by evidence defects while the
  implementation was already correct. Note that the attempt-budget consequence is
  out of scope here and belongs to the separate SPEC.
- DO NOT propose fixes in this file. T02 through T04 carry the corrections.

**Accept**
```
test -f manual-loops/architecture/blocker-handoff-certification-evidence/deviations.md && grep -c "DEVIATION A" manual-loops/architecture/blocker-handoff-certification-evidence/deviations.md && grep -c "DEVIATION B" manual-loops/architecture/blocker-handoff-certification-evidence/deviations.md
```

### T02 — Certification packet and independent verdicts over the committed state

- **Allowed write paths:**
  `manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md`
  (new file).
- **Non-goals:** Editing the predecessor SPEC or its evidence files, re-running
  any predecessor gate, and recomputing any recorded value.
- Assemble one section per predecessor task T01-T05, each citing source files by
  name from `…-diagnosis-evidence/`:
  - the committed diff for that task (`git show <sha> --stat` and the task diff file)
  - the gate commands actually executed, with exit status and natively reported
    duration, quoted from `T0N-gates.json` and `T0N-gate-NN*.txt`
  - reviewed-state identity from `T0N-state.json`
  - baseline ownership from `T0N-preservation.json`
  - QA record from `T0N-implementation-qa.md`
  - implementer and reviewer model/run identity from `preflight-provenance.json`
    and any per-task provenance present
  - for T01 specifically: both attempts, and the objection round verbatim from
    `T01-review-attempt1.md`
  - for T03 specifically: the old hash
    `d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5`, the new
    hash `5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5`, and
    confirmation that the other five lock entries are unchanged
- Add a section "Missing from the predecessor record" listing every required item
  with no source file, each as "not recorded". Expect final verdicts for all five
  tasks to appear there.
- Add the finding requested but never recorded by the predecessor: whether
  `scripts/checks/doc-code-guards.sh` actually invokes
  `check-codex-manual-loop.py` in both KISS and full modes. Read the script and
  quote the relevant lines; do not infer it from `codex-manual-loop.md`'s claim.
- The two independent reviewers of THIS task receive the predecessor's committed
  diff per the Review packet section above. Their verdicts are the certification
  this SPEC exists to produce. The principal records both verbatim, with model and
  run identity, and does not substitute its own assessment for either.
- DO NOT mark any predecessor task as certified inside this file. The verdicts
  are recorded by the principal in Progress after review, not asserted by the
  implementer beforehand.

**Accept**
```
test -f manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "Missing from the predecessor record" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md
```

### T03 — Amend the predecessor's Progress with real evidence

- **Allowed write paths:** the `## Progress` section of
  `manual-loops/architecture/blocker-handoff-diagnosis.md` only.
- **Non-goals:** Every other section of that file, and in particular its Goal,
  User decisions, Constraints, Gates, Task queue and Accept blocks. Changing an
  Accept block there is T04's scope, not this task's.
- This is an evidence-only Progress update. Per `manual-loop.md` step 6 it does
  not invalidate the predecessor's implementation review. Say so in the amendment.
- Replace the template instruction paragraphs — the text beginning "Record actual
  gate commands…" and "Additionally record for this queue…" — with the actual
  records drawn from T02's certification packet. Keep the five `[x]` checkboxes.
- The amendment must state, in plain language and without softening:
  - that T01 required two attempts, and that the objection round was consumed by
    evidence defects with the implementation already correct
  - that no final independent verdicts were recorded at the time of commit
  - that DEVIATION A occurred, in the form T01 established it
  - that certification was completed afterwards under this SPEC, with a pointer
    to the certification evidence directory and to the verdicts recorded here
- Add a dated header to the amendment: "EVIDENCE AMENDMENT (<date>, under
  manual-loops/architecture/blocker-handoff-certification.md)". Do not present
  amended records as if they had been written during the original run.
- DO NOT delete or rewrite anything already present in Progress beyond the two
  template instruction paragraphs being replaced.

**Accept**
```
grep -q "EVIDENCE AMENDMENT" manual-loops/architecture/blocker-handoff-diagnosis.md && grep -q "not recorded" manual-loops/architecture/blocker-handoff-diagnosis.md && ! grep -q "Additionally record for this queue" manual-loops/architecture/blocker-handoff-diagnosis.md
```

The third clause uses `! grep -q`, not `grep -c`. `grep -c` exits 1 when it
counts zero, so chaining a required-zero `grep -c` with `&&` fails exactly when
the task succeeded. `! grep -q` exits 0 when the template instruction paragraph
is absent, which is the required post-state.

### T04 — Annotate the predecessor's T01 Accept with what actually happened

- **Allowed write paths:** the T01 task block of
  `manual-loops/architecture/blocker-handoff-diagnosis.md` only — its `**Accept**`
  fence and the lines immediately following it.
- **Non-goals:** Every other Accept block, every other section, and any change to
  `DOCS/guides/manual-loop.md`. The `"## For humans"` header stays.
- **This task is outcome-driven, not assumption-driven.** Read T01's DEVIATION A
  finding before acting. An earlier draft of this SPEC assumed the predecessor's
  Accept still read `"Para humanos"`; QA established before execution that it
  reads `"For humans"`. Follow the finding, not this paragraph, if they differ.
- **Branch 1 — the predecessor's T01 Accept already reads `"For humans"`**
  (the expected case). Then the file was edited after approval, which `fp-dev` is
  forbidden to do ("do not touch the SPEC file") and which required human
  sign-off that was never recorded. **Change no command.** Insert immediately
  below the Accept fence:

```
> ACCEPT ALTERED AFTER APPROVAL (recorded <date> under
> manual-loops/architecture/blocker-handoff-certification.md): this block was
> approved reading `grep -n "Para humanos"`. It was changed to `grep -n "For
> humans"` during execution, without recorded human sign-off, and
> `…-diagnosis-evidence/T01-attempt2-gate-04.txt` shows the altered command
> exiting 0. The current text matches what executed and what the guide contains,
> and is therefore left in place. What is corrected here is the record: the
> alteration is DEVIATION A in the certification evidence, and the English
> header is accepted on its merits.
```

- **Branch 2 — it still reads `"Para humanos"`.** Then the runner did not execute
  the approved command verbatim. Change the command to `grep -n "For humans"` so
  the record is reproducible, and annotate it as a runner deviation instead,
  using the same block with the cause corrected.
- Record which branch applied and why, quoting the Accept block as found.
- Run the predecessor's T01 Accept as it stands after this task and record its
  native output and duration.
- DO NOT alter the predecessor's other four Accept blocks even if they would
  benefit from the same treatment. If one is also inconsistent with what
  executed, report it as a finding for a follow-up; do not fix it here.

**Accept**
```
grep -q -E "ACCEPT ALTERED AFTER APPROVAL|ACCEPT CORRECTED" manual-loops/architecture/blocker-handoff-diagnosis.md && grep -q "DEVIATION A" manual-loops/architecture/blocker-handoff-diagnosis.md
```

This Accept deliberately does not assert which string the command contains: both
branches are valid outcomes, and T01's finding decides between them. It asserts
only that the alteration is annotated and tied to DEVIATION A.

### T05 — Index and decision record

- **Allowed write paths:** `DOCS/archive/INDEX.md`.
- **Non-goals:** Runtime changes, edits to any guide, and historical rewrites.
- Add an entry for this SPEC linked to its predecessor, naming both deviations
  and stating that certification was completed after commit rather than before.
- Log the decision (rule, why, evidence, engram topic `manual-loop/blocker-handoff`).

**Accept**
```
grep -n "blocker-handoff-certification" DOCS/archive/INDEX.md
```

---

## Progress

### Revision 3 execution — 2026-09-08

The human approved revision 3 and explicitly signed both branches of T04.
The four prior defects were checked against the preserved findings, AGENTS.md
and `DOCS/guides/codex-manual-loop.md`; the current runner constraint matches
the proposed exception. No further contract change was required.

Preflight, cost basis, native runner/QA provenance, baseline ownership, and
execution exceptions are recorded in
`blocker-handoff-certification-evidence/preflight.md`,
`preflight-provenance.json`, `baseline-manifest.json`, and the baseline diffs.
The native runner loaded as `gpt-5.6-luna` / `low`; ChatGPT login and official
Codex credit rates establish eligibility under the approved exception.
No cluster gates or dev-mode precondition apply because this queue writes
Markdown records only; this is declared scope, not skipped iteration debt.
No service rebuild is required. Engram is unavailable; these files are the
durable record for `manual-loop/blocker-handoff`.

- [x] T01 deviations established and recorded
- [ ] T02 certification packet and independent verdicts over the committed state
- [ ] T03 predecessor Progress amended with real evidence
- [ ] T04 predecessor T01 Accept annotated per T01's DEVIATION A finding
- [ ] T05 index and decision record

T01 completed in one implementation attempt. `T01-gates.json` records the exact
commands and native result files: G0 exit 0 (`0.919999792` seconds), G19a exit 0
(`0.000002625`), G19b exit 0 (`3.727402542`), and Accept exit 0 (`0.000007584`,
output `1\n1\n`). Full raw results and outputs are `T01-gate-01` through
`T01-gate-04` in the certification evidence directory. Reviewed state:
`c115b02323a24498f07d1a2869c65afd9719bc95e96e9cabb6b2685af634303b`.
Both independent Astra/high reviewers returned APPROVED; their verbatim verdicts
are in `T01-review-verdicts.md` and native identities in `T01-review-provenance.json`:
A run `01a08291-3ac0-7d80-95bf-c9c9f1b5558b`, B run
`01a08291-8561-7551-98a7-44eff5bfcee6`. Implementer Sol/medium run
`01a08289-8b4d-7b53-a739-8a811abfc9ea`; QA Sol/medium run
`01a08276-3683-7af0-9e31-bb72d4933875`; runner Luna/low run
`01a08287-4e02-7f50-a8ae-5418bc1f3d83`. Corresponding provenance files record
actual child turns separately from inherited context.

T01 missing evidence: approval-time predecessor SPEC/original command, the
identity and timing of its editor, and whether the cause was runner substitution
or a SPEC edit are not recorded in predecessor evidence. Final dual approvals
for T01 attempt 2 and T02-T05 are not recorded. A's attempt-1 APPROVED and B's
attempt-1 REJECTED remain reported. No implementation or gate retry, model
fallback, skipped command, or service rebuild occurred. Reading truncations,
the withdrawn stale-text blocker and the pre-gate inventory correction are
recorded in `preflight.md`; both reviewers recovered truncated reads.
This completion entry and verdict files are evidence-only updates after review.
Commit preparation exception: the first `git add` exited 128 because the sandbox
denied `.git/index.lock`; the same scoped command succeeded with authorized
escalation (exit 0). No gate was retried and no reviewed artifact was changed.

Record actual gate commands, output, exit statuses and natively reported
durations; reviewed-state identity; implementer and both reviewer model/run
identities and verdicts; retries, fallbacks, skips and exceptions. Reviewers must
be no weaker than the implementer. Missing evidence blocks completion.

Record additionally for this queue: the reasoning for declaring no cluster gates
and no dev-mode precondition; both reviewers' verdicts for T02 verbatim, with
confirmation that each assessed the predecessor's committed diff and not only the
packet; and every item written as "not recorded", so the holes are visible in the
Progress section itself rather than only in the evidence directory.

## Out of scope (explicit)

- Attempt-budget rules, including whether an evidence-only objection round should
  consume an implementation attempt — a separate SPEC addresses this.
- The J3 offline repair blocker and its TypeScript error.
- Reverting, rebasing or amending the predecessor's five commits.
- Any change to `.codex/**`, scripts, guides' body rules, or templates.
- Retroactive reformatting of other completed SPECs' Progress sections.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- **Human signs off on T04 specifically**, as an edit to a completed SPEC's task
  block. Under branch 1 it only annotates; under branch 2 it also changes a gate
  command. Without that sign-off recorded, T04 does not run and the loop stops
  after T03 with DEVIATION A recorded in the certification evidence but not
  annotated in the predecessor SPEC.
- Human decides what follows if T02's reviewers reject the predecessor's committed
  state on its merits. This SPEC does not authorize reverting or reimplementing it.
