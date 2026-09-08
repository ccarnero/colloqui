# SPEC — Certification of the blocker-handoff-diagnosis committed state

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/architecture/blocker-handoff-diagnosis.md`
> (historical commits 612285ef..820221a9; isolated target rejected in T02).
> Current certification target: integrated commit
> `9fde0baa9fbae768fc97133731eeb2744f90516e`, human-approved in revision 4.
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

> REVISION 4 (2026-09-08, human-approved after T02 attempt 1): certify the
> integrated commit `9fde0baa9fbae768fc97133731eeb2744f90516e` with new gates and
> two independent reviews. The original target `820221a9` was NOT self-consistent:
> its lock referenced six files, four role files were not committed, its committed
> config differed from the locked bytes, and the policy checker was absent.
> Reviewer A detected this dependency-boundary defect and caused the T02 block.
> The human resolved it by committing pending configuration repair, not by
> reinterpreting the old target: `07e1d466`, `51689ecd`, `e111957b`, then `9fde0baa`
> (the last commit also preserves all 82 predecessor evidence files).
> Human root-cause finding: this was a composition failure. Each loop correctly
> committed only its allowed paths, but a lock landed without its referents;
> no loop failed in isolation. This composition finding does not erase the
> separate recorded deviations A and B. The old rejection and all attempt-1
> evidence remain preserved. Attempt 2 must prove the new target in a clean,
> detached worktree, without relying on uncommitted main-worktree files.

**This SPEC certifies an already-committed integrated state. It changes no
behavior.** The initial verification premise referred to the dirty working tree;
it did not prove that isolated commit `820221a9` contained the required files.
Revision 4 records that defect and requires independent committed-tree proof.

---

## Goal

The integrated committed state `9fde0baa9fbae768fc97133731eeb2744f90516e` carries
a complete, accurate certification record: two independent verdicts over that
exact state, a Progress section
containing real evidence rather than template instructions, and an honest account
of the two contract deviations found in its evidence directory.

Nothing in the predecessor is reimplemented or reverted. Its 82 evidence files
remain the source for historical claims; this SPEC indexes and audits them.
Fresh revision-4 checks are new integrated-state evidence, never replacements
for missing historical records or retroactive approval of `820221a9`.

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
6. Revision 4 resumes T02 as attempt 2 against integrated `9fde0baa`, with new
   gates and two independent reviews. Preserve the historical rejection and the
   human composition finding above. The old task packet is preserved as
   `T02-attempt1-certification-packet.md`; prior evidence is never overwritten.

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
- **No reconstruction.** Every historical recorded value must be quoted or cited from an
  existing file in the predecessor's evidence directory, with the file name. A
  value that cannot be cited is written as "not recorded" with a one-line note.
  Recomputing a duration, a hash, or a model identity after the fact and
  presenting it as the original record is falsification.
  Fresh integrated-tree inspections and attempt-2 gates are separately dated and
  sourced as current observations. The principal owns SPEC amendments and
  uniquely named execution evidence; the developer owns the T02 packet only.
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

For **T02 attempt 2 only**, after these three main-worktree gates and before its
Accept, run the following additional commands verbatim, in order, with working
directory `/tmp/platform-cluster-certification-9fde0baa` (a separately created
detached worktree of the exact committed target; no working-copy files copied in):

```sh
git rev-parse HEAD
test "$(git rev-parse HEAD)" = "9fde0baa9fbae768fc97133731eeb2744f90516e"
certification_status="$(git status --porcelain --untracked-files=all)" && test -z "$certification_status"
python3 ./scripts/checks/check-codex-manual-loop.py
certification_status="$(git status --porcelain --untracked-files=all)" && test -z "$certification_status"
```

These commands are the integrated-tree commit gate: exact HEAD, clean before,
checker exit 0, clean afterwards. The original T02 Accept then runs in the main
workspace. Persist native results under `T02-attempt2-*`; no attempt-1 gate or
verdict file is overwritten. Success in the dirty main workspace alone is
insufficient. Worktree creation is preparation, not a substitute for these gates.

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

For **T02**, both reviewers must retain the original historical target and its
attempt-1 rejection, and additionally assess the integrated resolution. The
original commands remain part of the packet, not the current certification target:

```
git diff 3fe4263c..820221a9 -- DOCS/ .codex/ manual-loops-templates/
git log --oneline 3fe4263c..820221a9
```

Revision 4 adds these read-only review inputs:

```sh
git diff 820221a9..9fde0baa -- .codex/ scripts/ AGENTS.md DOCS/ manual-loops/README.md manual-loops/architecture/codex-manual-loop-repair.md manual-loops/architecture/codex-manual-loop-repair/ manual-loops/architecture/blocker-handoff-diagnosis-evidence/
git log --oneline 820221a9..9fde0baa
git ls-tree -r 9fde0baa -- .codex/ scripts/checks/ scripts/tests/
```

Review the integrated committed roles/config/lock, checker and guard wiring,
tests, policy and repair records, and committed predecessor evidence, together
with clean-worktree gate output. Both reviewers must explicitly assess the
historical defect AND the integrated resolution, as well as the unchanged current
packet and SPEC. Approval certifies `9fde0baa`, never rehabilitates isolated
`820221a9`. A reviewer who assesses only the packet and not these targets has not
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
  any gate as retroactive predecessor evidence, and recomputing any historical
  recorded value. Revision-4 integrated-state gates are fresh current evidence.
- **Revision 4 amendment:** preserve all historical T01-T05 sections and holes,
  and add an explicit integrated-target section. Retain the isolated `820221a9`
  lock/config/checker defect, reviewer A's blocking discovery, resolution by
  the four integration commits, and the human composition finding. Cite new
  clean-worktree evidence separately and never assert it passed before execution.
  The principal preserves the unchanged attempt-1 packet before implementation.
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
- [x] T02 certification packet and independent verdicts over the committed state
- [x] T03 predecessor Progress amended with real evidence
- [x] T04 predecessor T01 Accept annotated per T01's DEVIATION A finding
- [x] T05 index and decision record

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
T01 commit: `4e26001a`. Git exited 0 and reported an automatically configured
committer identity; no identity configuration or history rewrite was performed.

### T02 blocked after independent review — 2026-09-08

#### For humans

The committed predecessor lacks configuration dependencies present in the working
copy that passed validation. One independent reviewer rejected certification on
that basis; the other approved. Dual approval is absent, so certification stops.
The human must decide how to resolve the committed target's dependency boundary.
No predecessor repair, history rewrite, or next task is authorized by this stop.

#### Execution and evidence

T02 attempt 1 produced the packet and passed QA and all four commands. The
human-boundary rule for rejection of the predecessor on its merits stops this
queue; this is not attempt-budget exhaustion and no retry was launched.
T02 remains unchecked and uncommitted. T03-T05 were not started. Both reviewers
explicitly assessed the T02 artifacts/evidence AND the full predecessor committed
diff/log. Their exact verdicts follow and are also preserved in
`T02-review-verdicts.md`. No majority or principal verdict substitutes for dual
approval. The packet is preserved unchanged for the human decision.
Human-readable blocker and implementer diagnosis:
`blocker-handoff-certification-evidence/BLOCKED.md` and `T02-handoff.md`.
The read-only handoff confirms the missing committed roles/checker/guard wiring
and mismatched committed config bytes; it recommends completing the existing
configuration-repair scope before certifying an integrated committed state.
No repair or continuation SPEC was authored. Historical findings remain preserved.

- `./scripts/checks/doc-code-guards.sh` — exit 0; native duration `0.914468791` seconds; full result/output: `T02-gate-01.json` / `T02-gate-01.stdout.txt`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — exit 0; native duration `0.000004167` seconds; full result/output: `T02-gate-02.json` / `T02-gate-02.stdout.txt`.
- `./scripts/checks/doc-code-guards.sh --full` — exit 0; native duration `3.36880725` seconds; full result/output: `T02-gate-03.json` / `T02-gate-03.stdout.txt`.
- `test -f manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "Missing from the predecessor record" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md` — exit 0; native duration `0.000003083` seconds; full result/output: `T02-gate-04.json` / `T02-gate-04.stdout.txt`.

Current reviewed state: `27a4eb92bfd3155d55bfd5bb3b18659455e3a7219cdcc122bd389d9ba1461894`.
Implementation/QA: native Sol medium, actual turns in `T02-dev-provenance.json`
and `T02-qa-provenance.json`; implementer run `01a0829d-e800-7471-8aba-1c214c1d0982`,
QA run `01a08276-3683-7af0-9e31-bb72d4933875`. Runner: native Luna low,
run `01a08287-4e02-7f50-a8ae-5418bc1f3d83`, actual turn and native raw results
in `T02-gates.json`. Reviewer native follow-up identities are in
`T02-review-provenance.json`. No implementation/gate retry, model fallback,
skipped declared command, or rebuild. Reviewer read truncations were recovered;
B also recovered an inspection parser schema mismatch. These were non-causal
inspection exceptions, not the committed-dependency blocker.

#### Historical holes retained in Progress

- T01 final-state dual independent reviewer verdicts: **not recorded**. The only
  verdicts are Reviewer A APPROVED and Reviewer B REJECTED for attempt 1; no
  verdict exists for attempt 2.
- T02 final-state independent reviewer verdicts: **not recorded**.
- T03 final-state independent reviewer verdicts: **not recorded**.
- T04 final-state independent reviewer verdicts: **not recorded**.
- T05 final-state independent reviewer verdicts: **not recorded**.
- `T02-preservation.json`: **not recorded**; the required file is absent.
- `T05-preservation.json`: **not recorded**; the required file is absent.
- Requested gate-executor session and turn for T01-T05: **not recorded**; those
  fields are absent from every `requested` object.
- Observed per-gate session and turn for T01-T05: **not recorded**; the gate
  records use `unavailable`, which does not supply either identity.
- Task-specific fp-dev turns for T01, T03, and T04, and the T05 attempt-2
  correction: **not recorded**.
- Task-specific fp-qa turns for T01-T04: **not recorded**.
- Reviewer B's T01 attempt-1 task turn: **not recorded** in the verdict document.
- Reviewer model/run/turn identities and verdicts for T01 attempt 2 and T02-T05:
  **not recorded**.
- Approval-time predecessor SPEC bytes or original command, editor identity,
  edit time, and evidence distinguishing runner substitution from a mid-flight
  SPEC edit: **not recorded**, as established in `deviations.md`.
- The guard integration finding above as a predecessor-run finding: **not
  recorded**; it is distinguished as a current source inspection.



#### Reviewer A — verbatim

REJECTED

1. `.codex/manual-loop.lock.json:5–10` in predecessor commit `820221a9` requires four role files absent from that commit, and its `.codex/config.toml` hash does not match the committed file. `scripts/checks/check-codex-manual-loop.py` is also absent from the commit despite the new guide referencing it. The recorded green checks cover the working tree containing uncommitted configuration-repair dependencies, not this committed state. This violates AGENTS.md’s tested/reviewed-state evidence requirement and automatic rejection rule 7. Certification requires a human decision resolving the committed target’s dependency boundary; this SPEC does not authorize integrating or repairing those files.

Assessed both targets: complete T02 packet/evidence and full predecessor diff/log `3fe4263c..820221a9`. Current T02 state `27a4eb92bfd3155d55bfd5bb3b18659455e3a7219cdcc122bd389d9ba1461894` is unchanged; all four current commands exited 0 with matching native evidence. Baseline work is preserved.

Requested/observed reviewer: `fp-reviewer`, Astra high; run `01a08291-3ac0-7d80-95bf-c9c9f1b5558b`, turn `01a082a9-5963-7631-b491-1b79478fef25`. Sol implementation/QA and Luna runner provenance verified. No edits, repeated gates or sibling verdict consulted; truncated reads were recovered through targeted inspection.

#### Reviewer B — verbatim

APPROVED

Reviewed both required targets:

- Complete T02 packet and execution evidence, frozen state `27a4eb92bfd3155d55bfd5bb3b18659455e3a7219cdcc122bd389d9ba1461894`; all 3,856 recorded file hashes match.
- Full predecessor diff `3fe4263c..820221a9 -- DOCS/ .codex/ manual-loops-templates/` and five-commit log, verified against Git. Assessed implementation on its merits: handoff boundaries, role restrictions, lock update, template ordering and decision records are consistent.

Packet SHA `1c5617dba36c44c348bda325dd5e26813154d9c563cb0771776a04040974e6db`. Citations, historical gate values, hashes and missing-record declarations match their sources. Historical certification gaps remain explicitly disclosed; this approval does not invent earlier verdicts.

T02’s four commands ran verbatim and sequentially, all exit 0; persisted outputs/durations match native results. Sol medium implementation and QA, QA before gates, and Luna low execution are established. Baseline work is preserved.

Reviewer B: requested/observed `fp-reviewer`, `gpt-6-astra`, high; run `01a08291-8561-7551-98a7-44eff5bfcee6`, turn `01a082a9-a0ce-75f1-98ef-7e7d16a1eb58`. No sibling verdict consulted, edits or gate reruns. Truncated reads and one inspection parser’s schema mismatch were recovered with targeted reads. Runtime tests/builds are inapplicable.


### Human integration update — 2026-09-08

The human committed the predecessor evidence as
`9fde0baa9fbae768fc97133731eeb2744f90516e`. Current read-only Git-object inspection
confirmed all 82 committed evidence files match their recorded baseline hashes.
The preceding commits `07e1d466`, `51689ecd`, and `e111957b` also introduce the
locked roles/config, checker/guard wiring, and delivery-policy/repair records.
All six protected files in the current committed tree exist and match its lock;
the checker is now tracked. These are new observations of the integrated tree,
not reconstructed predecessor execution evidence or new gate/reviewer verdicts.

The binding T02 review target remains `3fe4263c..820221a9`. Later commits do not
alter that historical tree or supersede the recorded rejection. Certification of
the integrated state requires an explicitly approved target update, applicable
gates, and two independent reviews. T02 remains unchecked; no gates, review
round, repair, or commit was performed during this read-only integration check.

Record actual gate commands, output, exit statuses and natively reported
durations; reviewed-state identity; implementer and both reviewer model/run
identities and verdicts; retries, fallbacks, skips and exceptions. Reviewers must
be no weaker than the implementer. Missing evidence blocks completion.

Record additionally for this queue: the reasoning for declaring no cluster gates
and no dev-mode precondition; both reviewers' verdicts for T02 verbatim, with
confirmation that each assessed the predecessor's committed diff and not only the
packet; and every item written as "not recorded", so the holes are visible in the
Progress section itself rather than only in the evidence directory.

### Revision 4 — T02 attempt 2 completed, 2026-09-08

The human explicitly approved the integrated target
`9fde0baa9fbae768fc97133731eeb2744f90516e`. This supersedes the target for current
certification, not the historical rejection. Isolated `820221a9` was not
self-consistent: six lock referents, four missing roles, mismatched config and
absent checker/G19 wiring. Reviewer A detected this and blocked attempt 1.
Pending configuration repair was committed through `07e1d466`, `51689ecd`,
`e111957b`, and `9fde0baa`; this is a composition resolution, not reinterpretation.
Human root-cause finding: each loop correctly committed only its allowed paths,
but a lock landed without its referents; no loop failed in isolation. Separate
historical deviations A/B remain recorded. Attempt-1 records, including BLOCKED.md,
remain immutable historical evidence; this dated entry records their resolution.

Current reviewed-state SHA-256:
`275c436f3fa8b75efe0575f33866103f87bcbfa15fdd7dba64c4254635d30900`.
Packet SHA-256:
`64384e65f840a54d55a22d21ef81b0163fc6b5d5e72d68882bfb59ac2b68a20b`.
All 3,892 frozen hashes matched after gates and both reviews. The amendment below
is evidence-only Progress; the reviewed contract and implementation are unchanged.
Full records live under `blocker-handoff-certification-evidence/T02-attempt2-*`.
The nine gate results establish a clean detached worktree at exact HEAD before
and after checker exit 0, without borrowing files from the dirty main workspace.

- `./scripts/checks/doc-code-guards.sh` — cwd `/Users/chris/sources/yoizen/platform-cluster`, exit 0; raw output and native duration: `T02-attempt2-gate-01.json`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — cwd `/Users/chris/sources/yoizen/platform-cluster`, exit 0; raw output and native duration: `T02-attempt2-gate-02.json`.
- `./scripts/checks/doc-code-guards.sh --full` — cwd `/Users/chris/sources/yoizen/platform-cluster`, exit 0; raw output and native duration: `T02-attempt2-gate-03.json`.
- `git rev-parse HEAD` — cwd `/tmp/platform-cluster-certification-9fde0baa`, exit 0; raw output and native duration: `T02-attempt2-gate-04.json`.
- `test "$(git rev-parse HEAD)" = "9fde0baa9fbae768fc97133731eeb2744f90516e"` — cwd `/tmp/platform-cluster-certification-9fde0baa`, exit 0; raw output and native duration: `T02-attempt2-gate-05.json`.
- `certification_status="$(git status --porcelain --untracked-files=all)" && test -z "$certification_status"` — cwd `/tmp/platform-cluster-certification-9fde0baa`, exit 0; raw output and native duration: `T02-attempt2-gate-06.json`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — cwd `/tmp/platform-cluster-certification-9fde0baa`, exit 0; raw output and native duration: `T02-attempt2-gate-07.json`.
- `certification_status="$(git status --porcelain --untracked-files=all)" && test -z "$certification_status"` — cwd `/tmp/platform-cluster-certification-9fde0baa`, exit 0; raw output and native duration: `T02-attempt2-gate-08.json`.
- `test -f manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "Missing from the predecessor record" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md && grep -c "5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5" manual-loops/architecture/blocker-handoff-certification-evidence/certification-packet.md` — cwd `/Users/chris/sources/yoizen/platform-cluster`, exit 0; raw output and native duration: `T02-attempt2-gate-09.json`.

Full native evidence/provenance: `T02-attempt2-gates.json`; runner Luna/low run
`01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e`, turn
`01a082e9-b016-76c3-8a40-6c63a627036a`. Developer Sol/medium run
`01a082e0-880b-7362-bf33-46d5d8673b1d`, turn
`01a082e0-884f-7683-b60e-78e15d58b1b7`. QA Sol/medium run
`01a082d6-d7a4-7211-be99-542a79729f10`, postimplementation turn
`01a082e5-cc7e-7230-bc45-6c85fb391139`. Native role/model/effort were observed,
not inferred from config. Astra/high reviewers are no weaker than the implementer.

Non-causal exceptions: expired agent path required new same-model native
instances; worktree post-checkout hook emitted a log-path warning; ChatGPT login
reported a PATH-alias warning but succeeded; developer repeated one read-only
hash inspection after zsh special-variable lookup failures. Runner prose
misstated gate 8 duration; persisted native evidence is exactly `0.400039667`,
without recomputation or rerun. Reviewers recovered truncated reads and used
direct source/Git inspection where codegraph was unavailable. Reviewer A's
non-blocking navigation observation is retained verbatim below. No gate retry,
model fallback, test weakening, cluster gate, or service rebuild occurred.
No cluster/dev-mode/build/frozen-install applies to this Markdown-only scope.
Engram unavailable: this SPEC and evidence are the durable topic record.

Historical holes remain visible (quoted from the packet, not backfilled):


- T01 final-state dual independent reviewer verdicts: **not recorded**. The only
  verdicts are Reviewer A APPROVED and Reviewer B REJECTED for attempt 1; no
  verdict exists for attempt 2.
- T02 final-state independent reviewer verdicts: **not recorded**.
- T03 final-state independent reviewer verdicts: **not recorded**.
- T04 final-state independent reviewer verdicts: **not recorded**.
- T05 final-state independent reviewer verdicts: **not recorded**.
- `T02-preservation.json`: **not recorded**; the required file is absent.
- `T05-preservation.json`: **not recorded**; the required file is absent.
- Requested gate-executor session and turn for T01-T05: **not recorded**; those
  fields are absent from every `requested` object.
- Observed per-gate session and turn for T01-T05: **not recorded**; the gate
  records use `unavailable`, which does not supply either identity.
- Task-specific fp-dev turns for T01, T03, and T04, and the T05 attempt-2
  correction: **not recorded**.
- Task-specific fp-qa turns for T01-T04: **not recorded**.
- Reviewer B's T01 attempt-1 task turn: **not recorded** in the verdict document.
- Reviewer model/run/turn identities and verdicts for T01 attempt 2 and T02-T05:
  **not recorded**.
- Approval-time predecessor SPEC bytes or original command, editor identity,
  edit time, and evidence distinguishing runner substitution from a mid-flight
  SPEC edit: **not recorded**, as established in `deviations.md`.
- The guard integration finding above as a predecessor-run finding: **not
  recorded**; it is distinguished as a current source inspection.


Both reviewers independently assessed the historical committed diff AND the
integrated resolution, not merely the packet. Exact verdicts follow.

#### T02 attempt 2 independent verdicts — verbatim

##### Reviewer A

APPROVED

Reviewed integrated commit `9fde0baa9fbae768fc97133731eeb2744f90516e`, state SHA-256 `275c436f3fa8b75efe0575f33866103f87bcbfa15fdd7dba64c4254635d30900`, packet SHA-256 `64384e65f840a54d55a22d21ef81b0163fc6b5d5e72d68882bfb59ac2b68a20b`.

- Independently assessed the full historical diff and confirmed `820221a9` has six lock references, four missing roles, mismatched config bytes, and no checker/G19 wiring. Its rejection remains valid. The four integration commits resolve those configuration dependencies. The human composition finding and separate deviations A/B remain intact.
- Assessed committed roles/config/lock, checker, guard wiring, tests, policy, repair records, and all 82 predecessor evidence files. Pure validation uses data and diagnostic values; filesystem operations and reporting remain in the shell. Existing tests are preserved. The committed checker, guard, and test bytes match the repair’s recorded passing suites.
- All nine current commands ran verbatim, sequentially, with native exit 0. Verified native outputs/durations, including gate 8’s `0.400039667`. Separate-checkout evidence establishes exact HEAD, clean-before, checker success, and clean-after.
- All 3,892 frozen hashes match. Only authorized SPEC/packet content changed; historical records and unrelated baseline work are preserved. QA finished before gates. Native Sol/medium implementation and Luna/low execution are verified.

Reviewer requested/observed: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn `01a082eb-4f06-7f72-80a7-1b2415c0caa6`.

No edits, gate reruns, delegation, or current sibling verdict consulted. Codegraph unavailable; direct source/Git inspection substituted. Truncated reads and inventory assumptions about ignored logs/empty JSON artifacts were recovered.

Non-blocking: `manual-loops/README.md:18` links to an evaluation draft absent from the committed target; this preserved navigation issue does not affect the certified configuration.

##### Reviewer B

APPROVED

Reviewed integrated commit `9fde0baa9fbae768fc97133731eeb2744f90516e`, the complete historical diff/log, committed configuration repair and evidence, and unchanged T02 artifacts.

- Historical `820221a9` remains defective: six lock references, four absent roles, mismatched config, and missing checker/G19 wiring. Reviewer A’s discovery and blocking rejection remain preserved. The four integration commits resolve that dependency boundary; the human’s composition finding and separate deviations A/B remain intact.
- Integrated roles/config match all six lock entries. Checker decisions are pure; filesystem access, exception conversion, and diagnostics remain in the shell. Existing validation is reused, tests are preserved, and passing evidence covers the unchanged checker/guard/tests: 16 generic and 18 policy tests.
- All nine current commands exited 0. Native evidence confirms sequential execution, exact target HEAD, clean detached worktree before/after checker success, and gate 8 duration `0.400039667`.
- All 3,892 frozen file hashes match; only authorized SPEC/packet changes differ from baseline. All 82 committed predecessor evidence files match their working copies. Historical missing records remain disclosed.

Reviewed state SHA-256: `275c436f3fa8b75efe0575f33866103f87bcbfa15fdd7dba64c4254635d30900`.
Packet SHA-256: `64384e65f840a54d55a22d21ef81b0163fc6b5d5e72d68882bfb59ac2b68a20b`.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-9590-7740-9bb1-215ae4c32518`, turn `01a082eb-95c8-70b1-9702-5ee781e6623c`. Native Sol/medium implementation and QA, Luna/low execution, and reviewer provenance verified directly.

No edits, gates, delegation, or current sibling verdict consulted. Truncated reads were recovered; direct reads and `rg` supplied codegraph-equivalent checks. Runtime builds and cluster gates are inapplicable.


### T03 attempt 1 — rejected attribution, 2026-09-08

T03 gates G0/G19a/G19b/Accept all exited 0. Native full output/duration/model/run/
turn and unchanged state are preserved in `T03-gates.json`, `T03-state.json`,
and associated files under the certification evidence directory. State SHA
fab86a416f274b57e9f28562ff8c3ec9e1a6706b844e1e4b187fce14570f181b.
Reviewer A approved; B rejected attribution of the timestamp caveat to gate
records instead of later Preflight prose. This is a documentation evidence defect,
not a gate failure. T03 remains unchecked and uncommitted. Engine permits attempt
2 to correct attribution within the existing scope; all prior files and a complete
preimage are preserved. QA and all gates/reviews must repeat after correction.
Non-causal runner prose duration error is disclosed in T03-review-inputs.md;
persisted native Accept duration remains0.000003292. No gate or model fallback.

#### T03 attempt 1 independent verdicts — verbatim

##### Reviewer A

APPROVED

Reviewed T03 state SHA-256 `fab86a416f274b57e9f28562ff8c3ec9e1a6706b844e1e4b187fce14570f181b`; amended file SHA-256 `fd65e4508e7c5297a86790c87b565ec44180bcea679d1a5cdc8f3293f7d3230c`.

- Only the two authorized Progress paragraphs changed. All five checkboxes, preceding content, and later Preflight remain byte-identical.
- Historical commands, durations, hashes, provenance, and missing records match the sources. Deviation A remains uncertain; isolated `820221a9` remains rejected. Later certification correctly identifies `9fde0baa` as target and `b9764a6a` as the certification-record commit.
- All four commands ran verbatim and sequentially, exit 0. Native output and durations match persisted evidence, including Accept duration `0.000003292`.
- All 3,924 frozen hashes match. Native Sol/medium implementation and QA are verified; QA completed before Luna/low gates. No runtime changes, weakened tests, secrets, or applicable build/cluster requirements.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn `01a0830e-97e3-72b3-a1e0-3ae8c573d9f7`.

No edits, gate reruns, delegation, or current sibling verdict consulted. Truncated displays were recovered through targeted reads and structured comparisons.

##### Reviewer B

REJECTED

1. `manual-loops/architecture/blocker-handoff-diagnosis.md:419` incorrectly says the attempt-2 gate record notes that `started_utc` contains completion timestamps. Neither `T01-attempt2-gates.json` nor its four output files contains that note; it appears only in the preserved later Preflight prose at line 590. This violates the SPEC’s **No reconstruction** constraint and automatic rejection rule **7, contract/evidence gaps**. Attribute the interpretation explicitly to that later Preflight assertion instead of presenting it as original gate-record evidence.

Reviewed state: `fab86a416f274b57e9f28562ff8c3ec9e1a6706b844e1e4b187fce14570f181b`; file SHA-256: `fd65e4508e7c5297a86790c87b565ec44180bcea679d1a5cdc8f3293f7d3230c`.

All 3,924 frozen hashes match. Only the two authorized paragraphs changed; five checkboxes and later Preflight remain byte-identical. Four commands passed with matching native outputs/durations, including Accept `0.000003292`. QA preceded gates; Sol/medium implementation/QA and Luna/low execution provenance verified.

Reviewer requested/observed: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-9590-7740-9bb1-215ae4c32518`, turn `01a0830e-c9d2-7991-80c4-87399a9429c9`. No edits, gates, delegation, or current sibling verdict consulted.


### T03-attempt2 completed — 2026-09-08

Unchanged reviewed state SHA-256 `27818b998008fbdaf308d1287db2d145ce3f5da0e6e0ff434ec17b6134c6e4e0`; all 3958 frozen hashes match after gates and both reviews.
Evidence-only Progress closure; reviewed implementation and contracts unchanged.

- `./scripts/checks/doc-code-guards.sh` — exit 0; complete output and exact native duration: `T03-attempt2-gate-01.json`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — exit 0; complete output and exact native duration: `T03-attempt2-gate-02.json`.
- `./scripts/checks/doc-code-guards.sh --full` — exit 0; complete output and exact native duration: `T03-attempt2-gate-03.json`.
- `grep -q "EVIDENCE AMENDMENT" manual-loops/architecture/blocker-handoff-diagnosis.md && grep -q "not recorded" manual-loops/architecture/blocker-handoff-diagnosis.md && ! grep -q "Additionally record for this queue" manual-loops/architecture/blocker-handoff-diagnosis.md` — exit 0; complete output and exact native duration: `T03-attempt2-gate-04.json`.

Native runner gpt-5.6-luna/low, run `01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e`, turn `01a08313-a5bd-7d33-8d00-df52ae084504`.
Implementation/QA actual Sol/medium identities and evidence: `T03-attempt2-preflight-provenance.json`, `T03-attempt2-qa-provenance.json`, `T03-attempt2-implementation.md`, `T03-attempt2-qa.md`.
Both native Astra/high reviewers are no weaker than the implementer; identities
and exact verdicts are below and in `T03-attempt2-review-provenance.json`.
All evidence paths are under `blocker-handoff-certification-evidence/`.

No gate retries, new tests, service build, cluster gate or dev-mode precondition
applies to this Markdown-only scope. Engram unavailable; this is the durable
record for manual-loop/blocker-handoff. Preexisting work is preserved.

Execution exceptions and read recoveries are recorded in `T03-attempt2-review-inputs.md`, `T03-attempt2-qa-plan.md` and `T03-attempt2-implementation.md`. Persisted gate durations are native results; prose transcription errors never replace them.

#### T03-attempt2 independent reviews — verbatim

##### Reviewer A

APPROVED

Reviewed T03 attempt 2 state SHA-256 `27818b998008fbdaf308d1287db2d145ce3f5da0e6e0ff434ec17b6134c6e4e0`; file SHA-256 `28f2c6426043a63c371a0ee3f378fbf544c93bf5c6853cba3d13e4dc9c83ada7`.

- The timestamp interpretation is now correctly attributed to later Preflight prose, explicitly distinguished from native gate evidence.
- Reviewed the complete amendment. Historical records and gaps, uncertain deviation A, rejected `820221a9`, and later certification of `9fde0baa` remain accurate and distinct.
- Only the authorized Progress replacement changed. Five checkboxes, preceding content, and later sections remain byte-identical. Attempt-1 evidence is preserved.
- All four fresh commands ran verbatim and sequentially, exit 0; native outputs, durations, and provenance match. Sol/medium QA finished before Luna/low gates.
- All 3,958 frozen hashes match. No runtime changes, weakened tests, secrets, or applicable build/cluster requirements.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn `01a08314-6024-7df2-a3bd-31701e20dada`.

No edits, gate reruns, delegation, or current sibling verdict consulted.

##### Reviewer B

APPROVED

Reviewed T03 attempt 2 state `27818b998008fbdaf308d1287db2d145ce3f5da0e6e0ff434ec17b6134c6e4e0`; file SHA-256 `28f2c6426043a63c371a0ee3f378fbf544c93bf5c6853cba3d13e4dc9c83ada7`.

- Attribution objection resolved: the timestamp interpretation is explicitly a later Preflight assertion, absent from native gate files.
- Complete amendment preserves historical records, missing evidence, uncertain deviation A, and the distinction between rejected `820221a9` and certified `9fde0baa`.
- Only the two original template paragraphs are replaced; five checkboxes and all surrounding text remain byte-identical. Prior attempt evidence and unrelated work are preserved.
- All 3,958 frozen hashes match. Four fresh commands ran verbatim and sequentially, exit 0; native outputs and durations match. Sol/medium QA finished before Luna/low gates.
- No runtime changes, weakened tests, secrets, or applicable build/cluster requirements.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-9590-7740-9bb1-215ae4c32518`, turn `01a08314-8403-7920-ac7d-4a9a42837ffe`. Provenance verified against native records.

No edits, gates, delegation, or current sibling verdict consulted.


### T04 attempt 1 — pre-gate correction, 2026-09-08

No gates ran. QA detected that principal's T04-implementation.md quoted T02's
Accept instead of T01. Principal also detected annotation placement before the
opening fence instead of after the closing fence, contrary to QA's placement-pass
report. Both findings are preserved in T04-qa.md and T04-attempt1-predecessor.md.
Attempt2 moves unchanged annotation to its required position and corrects the new
evidence quote; all original files remain frozen. No new human approval is needed:
existing outcome-driven branch1 scope is unchanged. T04 remains unchecked.

### T04-attempt2 completed — 2026-09-08

Unchanged reviewed state SHA-256 `b469750e265190c16238d34f6c14fae58e6cde1cc06f4bb2036af93cf3fc8d24`; all 3996 frozen hashes match after gates and both reviews.
Evidence-only Progress closure; reviewed implementation and contracts unchanged.

- `./scripts/checks/doc-code-guards.sh` — exit 0; complete output and exact native duration: `T04-attempt2-gate-01.json`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — exit 0; complete output and exact native duration: `T04-attempt2-gate-02.json`.
- `./scripts/checks/doc-code-guards.sh --full` — exit 0; complete output and exact native duration: `T04-attempt2-gate-03.json`.
- `grep -n "For humans" DOCS/guides/manual-loop.md && \
grep -n "non-causal" DOCS/guides/manual-loop.md && \
grep -n "creates no budget" DOCS/guides/manual-loop.md && \
grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md` — exit 0; complete output and exact native duration: `T04-attempt2-gate-04.json`.
- `grep -q -E "ACCEPT ALTERED AFTER APPROVAL|ACCEPT CORRECTED" manual-loops/architecture/blocker-handoff-diagnosis.md && grep -q "DEVIATION A" manual-loops/architecture/blocker-handoff-diagnosis.md` — exit 0; complete output and exact native duration: `T04-attempt2-gate-05.json`.

Native runner gpt-5.6-luna/low, run `01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e`, turn `01a08320-edd4-7163-92cc-1ed75ef7164f`.
Implementation/QA actual Sol/medium identities and evidence: `T04-attempt2-preflight-provenance.json`, `T04-attempt2-qa-provenance.json`, `T04-attempt2-implementation.md`, `T04-attempt2-qa.md`.
Both native Astra/high reviewers are no weaker than the implementer; identities
and exact verdicts are below and in `T04-attempt2-review-provenance.json`.
All evidence paths are under `blocker-handoff-certification-evidence/`.

No gate retries, new tests, service build, cluster gate or dev-mode precondition
applies to this Markdown-only scope. Engram unavailable; this is the durable
record for manual-loop/blocker-handoff. Preexisting work is preserved.

Execution exceptions and read recoveries are recorded in `T04-attempt2-review-inputs.md`, `T04-attempt2-qa-plan.md` and `T04-attempt2-implementation.md`. Persisted gate durations are native results; prose transcription errors never replace them.

#### T04-attempt2 independent reviews — verbatim

##### Reviewer A

APPROVED

Reviewed T04 attempt 2 state SHA-256 `b469750e265190c16238d34f6c14fae58e6cde1cc06f4bb2036af93cf3fc8d24`; file SHA-256 `cbafcedaf9c5caf67c1e883b2d0921e4f36be69e192474d495950179a5396bec`.

- Exactly 13 annotation lines follow T01’s closing Accept fence. Removing them reproduces the baseline byte-for-byte; all five Accept blocks remain unchanged.
- Wording follows the authorized outcome-driven branch and preserves uncertainty about the editor, timing, and cause. Citations support the recorded divergence.
- The implementation report quotes the correct T01 command. All five commands ran sequentially with native exit 0; the required four-line Accept matches byte-for-byte. Outputs and durations match native records.
- Sol/medium QA finished before Luna/low gates. All 3,996 frozen hashes match. Prior placement/report defects and unrelated baseline work are preserved.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn `01a08321-f276-7dd0-96e9-ec94329f516a`.

No edits, gate reruns, delegation, or current sibling verdict consulted. No runtime tests, builds, or cluster gates apply.

##### Reviewer B

APPROVED

Reviewed T04 attempt 2 state `b469750e265190c16238d34f6c14fae58e6cde1cc06f4bb2036af93cf3fc8d24`; file SHA-256 `cbafcedaf9c5caf67c1e883b2d0921e4f36be69e192474d495950179a5396bec`.

- Exactly 13 annotation lines follow T01’s closing Accept fence. Removing them reproduces the original file byte-for-byte.
- Branch 1 preserves the command and follows the authorized outcome-driven rule. Sources support the annotation; editor, timing, and cause remain explicitly uncertain.
- The corrected implementation report quotes T01 accurately. Earlier placement and reporting defects remain preserved.
- All five commands ran verbatim and sequentially, exit 0. The predecessor Accept retains its exact four-line form. Native outputs, durations, and provenance match.
- All 3,996 frozen hashes match. Sol/medium QA finished before Luna/low gates. No runtime changes, weakened tests, secrets, or applicable build/cluster requirements.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-9590-7740-9bb1-215ae4c32518`, turn `01a08322-1b6a-7c10-ad18-df0e86342f32`.

No edits, gate reruns, delegation, or current sibling verdict consulted.


### T05 completed — 2026-09-08

Unchanged reviewed state SHA-256 `5bd582224d2fb45915703d2d61ff3a41452a15b4e622048e7932be8f6a32bc03`; all 4020 frozen hashes match after gates and both reviews.
Evidence-only Progress closure; reviewed implementation and contracts unchanged.

- `./scripts/checks/doc-code-guards.sh` — exit 0; complete output and exact native duration: `T05-gate-01.json`.
- `python3 ./scripts/checks/check-codex-manual-loop.py` — exit 0; complete output and exact native duration: `T05-gate-02.json`.
- `./scripts/checks/doc-code-guards.sh --full` — exit 0; complete output and exact native duration: `T05-gate-03.json`.
- `grep -n "blocker-handoff-certification" DOCS/archive/INDEX.md` — exit 0; complete output and exact native duration: `T05-gate-04.json`.

Native runner gpt-5.6-luna/low, run `01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e`, turn `01a0832a-0a31-7cf3-ba0d-d18a89ec894d`.
Implementation/QA actual Sol/medium identities and evidence: `T05-preflight-provenance.json`, `T05-qa-provenance.json`, `T05-implementation.md`, `T05-qa.md`.
Both native Astra/high reviewers are no weaker than the implementer; identities
and exact verdicts are below and in `T05-review-provenance.json`.
All evidence paths are under `blocker-handoff-certification-evidence/`.

No gate retries, new tests, service build, cluster gate or dev-mode precondition
applies to this Markdown-only scope. Engram unavailable; this is the durable
record for manual-loop/blocker-handoff. Preexisting work is preserved.

Execution exceptions and read recoveries are recorded in `T05-review-inputs.md`, `T05-qa-plan.md` and `T05-implementation.md`. Persisted gate durations are native results; prose transcription errors never replace them.

#### T05 independent reviews — verbatim

##### Reviewer A

APPROVED

Reviewed T05 state SHA-256 `5bd582224d2fb45915703d2d61ff3a41452a15b4e622048e7932be8f6a32bc03`; index SHA-256 `1eda2e3ae4423735225e2c481da33586033df694c2eaaa4f6681a40e3d24ca7a`.

- One dated section appended; every prior index byte, register classification, and append-only status is preserved. All six links resolve.
- Sources support the deviations, historical `820221a9` rejection, integrated `9fde0baa` certification, later record commit, composition finding, and decision. No premature T05 or whole-queue completion claim.
- All four commands ran verbatim and sequentially, exit 0. Outputs, durations, and actual native provenance match.
- Sol/medium QA finished before Luna/low gates. All 4,020 frozen hashes match; unrelated baseline work remains preserved.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn `01a0832a-cab9-76f1-bf6b-113d907dbc95`.

No edits, gate reruns, delegation, or current sibling verdict consulted. Runtime tests, builds, and cluster gates are inapplicable.

##### Reviewer B

APPROVED

Reviewed T05 state SHA-256 `5bd582224d2fb45915703d2d61ff3a41452a15b4e622048e7932be8f6a32bc03`; index SHA-256 `1eda2e3ae4423735225e2c481da33586033df694c2eaaa4f6681a40e3d24ca7a`.

- Only the authorized 40-line index append changed. Every prior index byte remains intact; all six links resolve.
- Source claims accurately distinguish rejected `820221a9`, certified integrated `9fde0baa`, and later certification-record commit `b9764a6a`. Reviewer discovery/block, four repair commits, human composition finding, separate deviations A/B, and unresolved historical evidence remain accurately represented.
- Decision, rationale, evidence links, and Engram topic are present. No premature T05 or whole-queue completion claim.
- All 4,020 frozen hashes match. Four commands ran verbatim and sequentially, exit 0; recorded outputs and durations match native results. Native Sol/medium QA finished before Luna/low gates.
- No runtime changes, weakened tests, secrets, or applicable build/cluster requirements.

Requested/observed reviewer: `fp-reviewer`, `gpt-6-astra`, high; run `01a082eb-9590-7740-9bb1-215ae4c32518`, turn `01a0832a-f2c7-76a0-a80d-96580ae3f58f`. Native provenance verified.

No edits, gate reruns, delegation, or current sibling verdict consulted.


### Queue closure — 2026-09-08

T01-T05 are complete with actual applicable gates and two independent approvals
for each final state. T01 commit4e26001a, T02 commitb9764a6a, T03 commitfbf7cfe6,
T04 commitf9f04535; T05's authorized commit contains this evidence-only closure.
The certified source target remains9fde0baa9fbae768fc97133731eeb2744f90516e, never
isolated820221a9. Its original defect/block and human composition resolution are
preserved in the SPEC, packet, predecessor amendment and index. Clean detached
HEAD/checker proof is T02-attempt2-gates.json; no dirty-workspace dependency.
Final successful task command counts: T01=4, T02=9, T03=4, T04=5, T05=4; all exit0.
T02 required the human integration/target decision; T03 had one attribution
review correction; T04 had one placement/report correction before gates. Original
failed/split/QA records remain preserved. Runner summary transcription errors
never replaced native output. No model/provider fallback, push, service rebuild,
cluster mutation or test weakening. Engram unavailable; topic persists in records.
Unrelated preexisting evaluation work is preserved and excluded from task commits.

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
