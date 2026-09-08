# SPEC — Blocker handoff diagnosis (manual-loop engine + Codex role configuration)
 
> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/architecture/codex-manual-loop-repair.md` (read for
> current native-role evidence status; this SPEC does not reopen it).
> Origin: user decision 2026-09-08 (Cowork session, after the J3 offline repair
> T01 blocker was unreadable and carried no proposed fix).
> Engram topic: 'manual-loop/blocker-handoff'.
 
**SCOPE CLASS: dedicated human-approved configuration scope.** T03 edits
`.codex/agents/fp-dev.toml` and `.codex/manual-loop.lock.json`. Per AGENTS.md and
`DOCS/guides/codex-manual-loop.md`, a normal feature SPEC cannot authorize this;
this SPEC exists to carry that authorization explicitly and for nothing else.
It does not change the runner pin, the checker, guard wiring, the role set, or
any other role definition.
 
---
 
## Goal
 
A blocked manual-loop task produces a record whose first screen tells a human what
broke and what the candidate fixes are, without changing the four-attempt budget,
the closure rules, or any authorization boundary.
 
Observable outcomes:
 
1. `fp-dev`, on a final failed attempt, returns a handoff note: plain-language
   failure, root cause with `file:line` and quoted code, and 1-3 candidate fixes
   with concrete diffs and risk.
2. A BLOCKED record opens with a "For humans" section and that handoff note;
   full evidence follows it rather than preceding it.
3. Non-causal execution exceptions are labeled as non-causal.
4. `.codex/manual-loop.lock.json` matches the changed `fp-dev.toml` bytes and the
   Codex policy checker reports no drift.
## User decisions (human boundary — do not reinterpret)
 
1. The handoff note is **analysis only**. It allocates no attempt, creates no
   budget, and creates no continuation SPEC. Any wording that could read as
   authorization to retry is a defect.
2. The maximum of 4 implementation attempts per task is unchanged. The
   same-error-twice immediate block is unchanged.
3. The mechanical executor, the principal, and both reviewers keep their existing
   prohibitions on diagnosis and remediation. `fp-dev` is the only role gaining
   diagnostic output, because it is the only role that already reasoned about the
   code.
4. Only `fp-dev.toml` changes among the role definitions. The runner pin
   (`gpt-5.6-luna`, low effort), the checker, and guard wiring are untouched.
5. The lock refresh is deliberate and human-approved, not an automatic side effect.
## Prior art (validated 2026-09-08 — REUSE, do not duplicate)
 
The engine does not forward this section. Repeat each citation inside the task
that uses it.
 
- `DOCS/guides/manual-loop.md` — `## Per-task cycle` step 7 **Block.** Already
  requires spec file, task id, date, attempt count, failing gate/objection,
  trimmed error output, and what was tried per attempt. T01 reorders and extends
  this list; it does not remove any existing requirement.
- `DOCS/guides/agent-roles.md` — `## Implementation (fp-dev)` → `### Return`.
  The existing return contract ends with "Implementation alone is not done...".
  T02 appends after that sentence.
- `DOCS/guides/agent-roles.md` — `## Mechanical gate execution` states "do not
  diagnose, remediate, edit, retry". Unchanged. The handoff note must not create
  a second diagnostic path that conflicts with it.
- `.codex/agents/fp-dev.toml` — `developer_instructions` is a single-quoted TOML
  multiline literal (`'''`). Its second paragraph ends with "Return changed paths,
  deviations, blockers, and requested-versus-observed model/run provenance to the
  principal." T03 appends a third paragraph after it.
- `.codex/manual-loop.lock.json` — `version: 1`, `algorithm: sha256`, six entries
  keyed by repo-relative path. Verified 2026-09-08: all six hashes match the
  files on disk. Only the `.codex/agents/fp-dev.toml` value may change.
- `DOCS/guides/codex-manual-loop.md` — "The checker reports drift and never
  rewrites or refreshes the lock." The refresh is a separate deliberate act.
- `manual-loops-templates/spec-simple-template.md` and
  `spec-canonical-template.md` — both declare `G1 = tests`, `G2 = typecheck`.
  T04 swaps them and updates the gate-id convention prose that names them.
## Constraints (apply to every task)
 
- AGENTS.md is normative; these Constraints specialize it without weakening it.
- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Preserve preexisting and blocked work; report scope expansion before editing.
  The J3 offline repair blocker and its evidence are read-only inputs here: do
  not edit, close, re-run, or re-open that loop.
- **No historical rewrites.** Existing BLOCKED records, completed SPECs, and
  frozen evidence keep their current shape. The new format applies to records
  written after this SPEC lands.
- The new text must not weaken any existing prohibition. If any proposed wording
  could be read as authorizing a retry, extra attempt, self-approval, file edit
  during a block, or gate execution by a role that may not run gates, stop and
  report instead of softening it.
- Routine build, test, and E2E commands use the configured mechanical executor
  below both the implementation/QA tier and the economical coding tier. It runs
  the exact commands in order, stops on first failure, and reports evidence
  without diagnosis, edits, retries, scope changes, or closure decisions. Record
  approved cost exceptions or delegation blockers before execution.
- `.codex/**` is writable in T03 only. In every other task it is read-only, and
  an edit there is scope creep.
- The lock file is never regenerated wholesale and never "refreshed to make the
  checker pass". Only the single `.codex/agents/fp-dev.toml` value changes, and
  only after its new bytes are final.
## Gates (the `/manual-loop` command runs these verbatim, in order)
 
One executor owns each command. Handoffs transfer the existing process/run
identity and completion evidence; they never duplicate a command. Persist full
sanitized output, status, duration, tested-state identity, and requested and
observed executor model/session/turn; keep the summary concise.
 
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
 
- **Cheapest check first.** These gates are ordered so the fastest and most
  likely failure runs first. This SPEC's own T04 applies the same principle to
  the templates.
- **No cluster gates apply.** This queue changes Markdown guides, SPEC templates,
  one Codex role definition, and one lock file. No service source, no persistent
  writes, no migrations, no built image. Per `manual-loop.md`, a
  documentation-scoped SPEC does not invent cluster gates. Therefore G1-G5b are
  absent. Do not renumber; do not substitute.
- **No dev-mode precondition.** `./scripts/validate-dev-mode.sh --with-e2e` is not
  required and is not skipped debt, because no iteration or built-image gate is
  declared. Record this reasoning in Progress rather than silently omitting it.
- `DOCS/guides/codex-manual-loop.md` states that G19 is invoked by the guards in
  both KISS and full modes. **Verify that claim before relying on it**: read
  `scripts/checks/doc-code-guards.sh` and confirm it actually invokes
  `check-codex-manual-loop.py` in each mode. If it does not, report the
  discrepancy as a finding; G19a above still runs the checker directly, so the
  policy is covered either way.
- After T03, G19a MUST be green. A drift report there means the lock and the file
  disagree — fix the lock or the file, never suppress the checker.
---
 
## Task queue
 
### T01 — Blocker record shape in the manual-loop engine
 
- **Allowed write paths:** `DOCS/guides/manual-loop.md`.
- **Non-goals:** Any change to attempt budget, closure conditions, gate classes,
  reviewer independence, commit authorization, or the Reporting section. No edits
  to `agent-roles.md`, templates, or `.codex/**`.
- Precedent to read first: `DOCS/guides/manual-loop.md`, `## Per-task cycle`,
  step `7. **Block.**`. It currently has three bullets. Preserve all three
  requirements; the second bullet is reordered and extended, not replaced.
- Replace the second bullet ("Record in authorized Progress/BLOCKED.md...") with:
```
   - Record in authorized Progress/BLOCKED.md, or return to the orchestrator if
     those paths are not allowed. The record OPENS with a "## For humans"
     section — at most 10 lines, plain language, no run IDs and no gate numbers:
     what was attempted, what failed, and what decision is pending. It is
     followed by the implementer's HANDOFF NOTE (plain-language cause,
     `file:line`, candidate fixes). Only then comes the evidence: spec file,
     task id, date, attempt count, the exact failing gate/objection, error
     output (trimmed), and what was tried per attempt.
   - Label execution exceptions that did not cause the failure as non-causal, so
     they are not read at the same level as the actual cause.
   - The handoff note is analysis, not authorization. It allocates no attempt,
     creates no budget, and creates no continuation SPEC. Requesting it does not
     reopen a closed or exhausted loop.
```
 
- DO keep bullets one and three of step 7 byte-identical.
- DO NOT introduce a new role, a new phase, or a new document. The note is
  produced by the existing implementer role and lands in the existing record.
- DO NOT add the note to the `## Reporting` section; a blocked run's user-facing
  report already points at the record.
**Accept**
> ACCEPT ALTERED AFTER APPROVAL (recorded 2026-09-08 under
> manual-loops/architecture/blocker-handoff-certification.md): the human-approved
> record says this block read `grep -n "Para humanos"`, while the current block
> and both recorded executions read `grep -n "For humans"`. The predecessor
> evidence has no approval-time SPEC copy or original command, editor identity,
> or edit time, and does not establish whether the runner substituted the command
> or the SPEC changed during execution. The current English command matches the
> guide and is left in place under the human decision accepting that header. What
> is corrected here is the record: this divergence is DEVIATION A in
> `blocker-handoff-certification-evidence/deviations.md`, supported by
> `blocker-handoff-diagnosis-evidence/T01-gates.json`,
> `blocker-handoff-diagnosis-evidence/T01-gate-04.stdout.txt`, and
> `blocker-handoff-diagnosis-evidence/T01-attempt2-gate-04.txt`.
```
grep -n "For humans" DOCS/guides/manual-loop.md && \
grep -n "non-causal" DOCS/guides/manual-loop.md && \
grep -n "creates no budget" DOCS/guides/manual-loop.md && \
grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
```
 
### T02 — Handoff note in the shared fp-dev return contract
 
- **Allowed write paths:** `DOCS/guides/agent-roles.md`.
- **Non-goals:** Any change to the Principal, fp-qa, Mechanical gate execution,
  fp-architect, or fp-reviewer sections. No change to the automatic-rejection
  list. No edits to `manual-loop.md`, templates, or `.codex/**`.
- Precedent to read first: `DOCS/guides/agent-roles.md`,
  `## Implementation (fp-dev)` → `### Return`. Append a new paragraph after the
  existing final sentence "Implementation alone is not done: gates and two
  independent approvals must cover unchanged content."
- Text to append verbatim:
```
On a final failed attempt — the orchestrator states that the attempt budget is
exhausted or that the same error repeated — also return a HANDOFF NOTE
containing: the failure in one plain-language sentence, with no gate numbers and
no run IDs; the root cause with `file:line` and the relevant code quoted; and one
to three candidate fixes, each with a concrete diff, its risk, and whether it
would invalidate findings already corrected in earlier attempts. The note is
analysis, not authorization: do not apply it, do not edit files, do not run
gates, and do not request a retry. Writing it consumes no attempt and creates
neither budget nor a continuation SPEC. If you have no supportable diagnosis, say
so plainly; a speculative fix is worse than none.
```
 
- DO verify that this does not contradict `## Mechanical gate execution` ("do not
  diagnose, remediate, edit, retry"). That prohibition binds the runner, not the
  implementer. If the two sections now read ambiguously about who may diagnose,
  report it rather than editing the runner section.
- DO NOT weaken "Do not start other tasks, do not commit, do not touch the SPEC
  file" earlier in the same section.
**Accept**
```
grep -n "HANDOFF NOTE" DOCS/guides/agent-roles.md && \
grep -n "consumes no attempt" DOCS/guides/agent-roles.md && \
grep -c "do not diagnose, remediate, edit, retry" DOCS/guides/agent-roles.md
```
 
### T03 — Codex fp-dev role definition and lock refresh
 
- **Allowed write paths:** `.codex/agents/fp-dev.toml`,
  `.codex/manual-loop.lock.json`.
- **Non-goals:** Any other role definition, `.codex/config.toml`,
  `scripts/checks/check-codex-manual-loop.py`, `doc-code-guards.sh`, the runner
  pin, the model or reasoning effort of any role, and the sandbox mode.
- Precedent to read first: `.codex/agents/fp-dev.toml`. `developer_instructions`
  is a TOML single-quoted multiline literal (`'''`), so no escaping applies and a
  literal `'''` cannot appear inside it. It currently holds two paragraphs; the
  second ends with "...requested-versus-observed model/run provenance to the
  principal."
- Also read `DOCS/guides/codex-manual-loop.md` before editing: this file is
  hash-locked, the checker never refreshes the lock, and AGENTS.md requires
  dedicated human-approved scope — which THIS SPEC provides and nothing else does.
- Append a third paragraph to `developer_instructions`, separated by one blank
  line, keeping the existing two paragraphs byte-identical:
```
On a final failed attempt, when the principal states that the attempt budget is exhausted or that the same error repeated, also return a handoff note: the failure in one plain-language sentence without gate numbers or run IDs; the root cause with file:line and the relevant code quoted; and one to three candidate fixes, each with a concrete diff, its risk, and whether it would invalidate findings already corrected in earlier attempts. The note is analysis, not authorization: do not apply it, do not edit files, do not run gates, and do not request a retry. Writing it consumes no attempt and creates neither budget nor a continuation SPEC. If you have no supportable diagnosis, say so plainly.
```
 
- Do not change `name`, `description`, `model`, `model_reasoning_effort`, or
  `sandbox_mode`. Confirm after editing that all five keys are unchanged.
- Then, and only after the file bytes are final, refresh exactly one lock entry:
  1. Inspect `scripts/checks/check-codex-manual-loop.py` for a supported refresh
     path. If one exists, use it and record the command.
  2. If none exists, edit `.codex/manual-loop.lock.json` by hand, replacing only
     the `.codex/agents/fp-dev.toml` value with
     `sha256sum .codex/agents/fp-dev.toml`. Leave `version`, `algorithm`, key
     order, and the other five entries untouched.
- Record in the implementation report: the old hash
  (`d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5`), the new
  hash, and confirmation that the other five entries are unchanged.
- **Known ordering effect, record it rather than working around it:** an already
  running Codex session holds the old `fp-dev` definition. The gates for this task
  therefore execute under the pre-change definition, and the new instructions take
  effect only in a fresh session (`codex -C <repo>`). Do not restart sessions or
  re-run earlier tasks to compensate. Note it in the report; T05 records it.
- DO NOT edit the checker to accept the new bytes. A checker change is outside
  this SPEC's authorized scope and is an automatic reviewer rejection.
**Accept**
```
python3 -c "import tomllib,sys; d=tomllib.load(open('.codex/agents/fp-dev.toml','rb')); assert d['name']=='fp-dev'; assert d['model']=='gpt-5.6-sol'; assert d['model_reasoning_effort']=='medium'; assert d['sandbox_mode']=='workspace-write'; assert 'handoff note' in d['developer_instructions']; print('ok')" && \
python3 -c "import json,hashlib; l=json.load(open('.codex/manual-loop.lock.json')); h=hashlib.sha256(open('.codex/agents/fp-dev.toml','rb').read()).hexdigest(); assert l['files']['.codex/agents/fp-dev.toml']==h, 'lock drift'; assert l['files']['.codex/config.toml']=='0e2aafb360454df9f511fe0ff65e0abb783ef5e533b17410d67b341e4d164e94'; assert len(l['files'])==6; print('ok')" && \
python3 ./scripts/checks/check-codex-manual-loop.py
```
 
### T04 — Blocker format in the authoring templates, and cheapest-gate-first ordering
 
- **Allowed write paths:** `manual-loops-templates/README.md`,
  `manual-loops-templates/spec-simple-template.md`,
  `manual-loops-templates/spec-canonical-template.md`.
- **Non-goals:** Any change to existing SPECs under `manual-loops/`, to the
  engine, to role contracts, or to `.codex/**`. No renumbering of gate ids.
- In `README.md`, add a new section after `## Maintaining a loop`:
```
## Blocker records
 
A BLOCKED record is read by a human first and an auditor second. Order it that
way: "For humans" (at most 10 lines, plain language, no run IDs or gate
numbers), then the implementer's handoff note with candidate fixes, then the full
evidence. Label execution exceptions that did not cause the failure as
non-causal. The handoff note is analysis only: it authorizes no retry, allocates
no budget, and creates no continuation SPEC. The engine owns this contract; see
the manual-loop procedure.
```
 
- In BOTH templates, swap the two primary-service gates so the cheaper check runs
  first under stop-on-first-failure:
```
# G1 — <primary service> typecheck (cheapest failure first)
cd services/<svc> && bunx tsc -p tsconfig.json --noEmit
# G2 — <primary service> tests
cd services/<svc> && bun test
```
 
- In `spec-simple-template.md`, update the gate-id convention sentence that
  currently reads "G1/G2 = primary service tests/typecheck" to
  "G1/G2 = primary service typecheck/tests (cheapest failure first)".
- Add one line to the `## KISS defaults` list in `README.md`: "Order gates so the
  cheapest and most likely failure runs first; stop-on-first-failure then costs
  the least."
- DO NOT change the placeholder `Accept` blocks that chain `bun test && bunx tsc`;
  a single Accept command is not a gate sequence and reordering it gains nothing.
- DO NOT alter G0, G3, G4, G5a, or G5b, their labels, or their ids.
**Accept**
```
grep -n "Blocker records" manual-loops-templates/README.md && \
grep -n "cheapest failure first" manual-loops-templates/spec-simple-template.md manual-loops-templates/spec-canonical-template.md && \
grep -n "G5b" manual-loops-templates/spec-canonical-template.md
```
 
### T05 — Docs, index, and decision record
 
- **Allowed write paths:** `DOCS/guides/codex-manual-loop.md`,
  `DOCS/archive/INDEX.md`.
- **Non-goals:** Runtime changes, historical record rewrites, and any edit to the
  J3 offline repair blocker or its evidence.
- In `codex-manual-loop.md`, add a dated line to the section describing validation
  and native evidence, recording: that `fp-dev.toml` changed under this SPEC's
  dedicated configuration scope on the completion date, the old and new SHA-256,
  that only that one lock entry changed, and that the new instructions take effect
  in a fresh Codex session only.
- Add an entry to `DOCS/archive/INDEX.md` pointing at this SPEC.
- Log the decision (rule, why, evidence, engram topic `manual-loop/blocker-handoff`)
  tying back to "User decisions" and the preamble.
**Accept**
```
grep -n "blocker-handoff" DOCS/archive/INDEX.md && \
grep -n "fresh Codex session" DOCS/guides/codex-manual-loop.md
```
 
---
 
## Progress
 
- [x] T01 blocker record shape in manual-loop.md
- [x] T02 handoff note in agent-roles.md fp-dev return contract
- [x] T03 fp-dev.toml third paragraph + single lock entry refresh
- [x] T04 templates: blocker format + cheapest-gate-first
- [x] T05 docs + index + decision record
### EVIDENCE AMENDMENT (2026-09-08, under manual-loops/architecture/blocker-handoff-certification.md)

This dated amendment replaces the template instructions with records sourced
from
`blocker-handoff-certification-evidence/certification-packet.md`, the complete
certification evidence directory, and this SPEC's preserved later Preflight
section. It was written after the original run. It is an evidence-only Progress
update and does not invalidate the predecessor implementation review. It does
not reconstruct missing predecessor evidence.

#### Historical task commands and state

Every recorded command below exited 0. T01 has two separate executions because
its attempt-1 objection concerned evidence while the implementation was already
correct. Each attempt ran these first three commands in order:

1. `./scripts/checks/doc-code-guards.sh`
2. `python3 ./scripts/checks/check-codex-manual-loop.py`
3. `./scripts/checks/doc-code-guards.sh --full`

The native durations, without rounding or recomputation, were:

| Task execution | Command 1 | Command 2 | Command 3 | Accept |
| --- | ---: | ---: | ---: | ---: |
| T01 attempt 1 | `0.966425083` | `0.000003666` | `3.568641917` | `0.000003875` |
| T01 attempt 2 | `1.1002217079512775` | `0.05402770801447332` | `4.096122290939093` | `0.012824874953366816` |
| T02 | `1.1473162920447066` | `0.05121437495108694` | `3.7107051250059158` | `0.009795458056032658` |
| T03 | `1.136267332942225` | `0.05670841608662158` | `4.528973625041544` | `0.10642837500199676` |
| T04 | `1.1580222920747474` | `0.05660045810509473` | `4.268370833015069` | `0.012333500082604587` |
| T05 attempt 2 | `1.2320749580394477` | `0.05279429198708385` | `4.2168731660349295` | `0.011029041022993624` |

The exact Accept commands were:

- T01 attempts 1 and 2: `grep -n "For humans" DOCS/guides/manual-loop.md && grep -n "non-causal" DOCS/guides/manual-loop.md && grep -n "creates no budget" DOCS/guides/manual-loop.md && grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md`.
- T02: `grep -n "HANDOFF NOTE" DOCS/guides/agent-roles.md && grep -n "consumes no attempt" DOCS/guides/agent-roles.md && grep -c "do not diagnose, remediate, edit, retry" DOCS/guides/agent-roles.md`.
- T03: `python3 -c "import tomllib,sys; d=tomllib.load(open('.codex/agents/fp-dev.toml','rb')); assert d['name']=='fp-dev'; assert d['model']=='gpt-5.6-sol'; assert d['model_reasoning_effort']=='medium'; assert d['sandbox_mode']=='workspace-write'; assert 'handoff note' in d['developer_instructions']; print('ok')" && python3 -c "import json,hashlib; l=json.load(open('.codex/manual-loop.lock.json')); h=hashlib.sha256(open('.codex/agents/fp-dev.toml','rb').read()).hexdigest(); assert l['files']['.codex/agents/fp-dev.toml']==h, 'lock drift'; assert l['files']['.codex/config.toml']=='0e2aafb360454df9f511fe0ff65e0abb783ef5e533b17410d67b341e4d164e94'; assert len(l['files'])==6; print('ok')" && python3 ./scripts/checks/check-codex-manual-loop.py`.
- T04: `grep -n "Blocker records" manual-loops-templates/README.md && grep -n "cheapest failure first" manual-loops-templates/spec-simple-template.md manual-loops-templates/spec-canonical-template.md && grep -n "G5b" manual-loops-templates/spec-canonical-template.md`.
- T05 attempt 2: `grep -n "blocker-handoff" DOCS/archive/INDEX.md && grep -n "fresh Codex session" DOCS/guides/codex-manual-loop.md`.

Full outputs are in `T0N-gates.json` and the corresponding
`T0N-gate-NN*.txt` files. T01 attempt-1 originals remain under `attempt1/`, and
attempt 2 is recorded separately as `T01-attempt2-*`. T05 attempt 1 stopped at
QA for two wording corrections before any gate ran.

The committed task sequence and recorded state identities are:

| Task | Commit | Recorded reviewed-state identity |
| --- | --- | --- |
| T01 | `612285ef` | `DOCS/guides/manual-loop.md` SHA-256 `009b949a88a2205d9c7f39b3cdf7735738eec6da3e21a7035e19671c0615258b` |
| T02 | `35b656a7` | `DOCS/guides/agent-roles.md` SHA-256 `8270bad50214b821efc8f19475be5f2dbccd6b25175d82a3a7197984365a3904` |
| T03 | `26c78b79` | `fp-dev.toml` SHA-256 `5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5`; lock SHA-256 `e400b7badccf6d6c15779bd0142f0a10531da9e00ca13407e534122f5ed21701` |
| T04 | `ec8a9abd` | README `0e1af50d371bdc3bac9bccfb4ebdfea71cad5bd5df2e4fa4cfc640d6355114e9`; simple template `2de695ca8a7ec3a2d79e9dbb4760eaf3c481bdb19da9414923c26c6076464ffe`; canonical template `6f573b25b805deb2bd34431387a3fcda62283e88fa92dbd9e8df2a23b8dc00b9` |
| T05 | `820221a9` | guide `56ca347cfae38b6b4e0ad2da5aacf32239826f47ad9982698d86e9bac5073fb6`; index `87e5e73c9ceff99949e817f7df59d2821272cf3b2250e71f047d471429f73930` |

`T01-preservation.json` records 3,731 baseline files and the two expected
changed paths. `T03-preservation.json` records the same baseline count and the
five accumulated T01-T03 paths. `T04-preservation.json` records the same count
and eight accumulated paths. T02 and T05 have no preservation file, as recorded
below. Each `T0N-implementation-qa.md` records exact scope and that no prose-only
test applied; T05 alone required a pre-gate QA correction. No existing test was
weakened or deleted.

Historical implementation and QA used native `gpt-5.6-sol` / `medium`:
fp-dev run `01a0822a-ac72-7102-9608-7f1099e5bb24` and fp-qa run
`01a08228-815f-7351-81a7-cc78f1e234ff`. T02 records developer task turn
`01a08237-52b2-7ab1-91cf-d1a6fa1e13d4`; T05 records developer task turn
`01a08253-3ba9-7c03-a2a4-fb907560b0e3` and final QA turn
`01a08257-8a3e-70d2-bb21-beb11a9154cb`. Other missing task turns remain listed
below. Every historical gate record requests `gpt-5.6-luna` / `low` and observes
script-runner run `01a08228-5aa1-7c92-afdb-dd55fdbc8be8` with that model and
effort; the missing requested and observed session/turn fields remain holes.

T01 attempt 1 records Reviewer A `APPROVED` and Reviewer B `REJECTED` in
`blocker-handoff-diagnosis-evidence/T01-review-attempt1.md`. B objected to the
miscopied Accept duration and omitted evidence-write failure; the record states
that no implementation edit was indicated by either verdict. The objection
round was therefore consumed by evidence defects while implementation was
already correct. The original outputs were preserved, evidence was corrected,
and attempt 2 repeated QA, all commands, and review without changing
implementation bytes. The attempt-2 gate record contains its `started_utc`
fields and native elapsed durations; the preserved later Preflight assertion
interprets those `started_utc` fields as completion timestamps and states that
the measured elapsed durations remain valid. That interpretation is not present
in the native gate files. Final attempt-2 verdicts are not recorded in the
predecessor evidence.

Other recorded non-causal exceptions were: a malformed T02 coordination call,
principal interruption and recovered provenance truncation; T03's malformed
grouped read, cancelled stalled protected patch, authorized write retries and
permission-status race; and T05's expected `diff` exit 1 stopping an `&&` read
chain. T04 records no exception. No historical gate retry, model fallback,
session restart, service build, cluster mutation, or push is recorded.

#### Deviations and missing predecessor records

DEVIATION A is the difference between the human-approved T01 Accept containing
`grep -n "Para humanos"` and both recorded executions containing
`grep -n "For humans"`. The attempt-1 record shows the difference predates its
objection round. The predecessor evidence has no approval-time SPEC copy or
original command, editor identity, or edit time, so it does not establish who
changed the command, when it changed, or whether the cause was runner
substitution or a SPEC edit. `blocker-handoff-certification-evidence/deviations.md`
records that uncertainty. DEVIATION B is the absence of final independent
verdicts: `independent-review-verdicts.json` has only the two T01 attempt-1 run
IDs, each with `final_verdicts: []`.

Every certified historical hole remains explicit:

- T01 final-state dual independent reviewer verdicts: **not recorded**. The
  only verdicts are A APPROVED and B REJECTED for attempt 1; no verdict exists
  for attempt 2.
- T02 final-state independent reviewer verdicts: **not recorded**.
- T03 final-state independent reviewer verdicts: **not recorded**.
- T04 final-state independent reviewer verdicts: **not recorded**.
- T05 final-state independent reviewer verdicts: **not recorded**.
- `T02-preservation.json`: **not recorded**; the required file is absent.
- `T05-preservation.json`: **not recorded**; the required file is absent.
- Requested gate-executor session and turn for T01-T05: **not recorded**.
- Observed per-gate session and turn for T01-T05: **not recorded**; the records
  use `unavailable`.
- Task-specific fp-dev turns for T01, T03 and T04, and the T05 attempt-2
  correction: **not recorded**.
- Task-specific fp-qa turns for T01-T04: **not recorded**.
- Reviewer B's T01 attempt-1 task turn: **not recorded**.
- Reviewer model/run/turn identities and verdicts for T01 attempt 2 and T02-T05:
  **not recorded**.
- Approval-time predecessor SPEC bytes or original command, editor identity,
  edit time, and evidence distinguishing runner substitution from a mid-flight
  SPEC edit: **not recorded**.
- Guard integration as a predecessor-run finding: **not recorded**.

The later Preflight section below is preserved verbatim and asserts two
APPROVED reviews for final T01-T05 states. Those later prose assertions do not
create the missing persisted verdict documents and are not presented here as
contemporaneous predecessor evidence.

#### Required operational findings

No cluster gate or dev-mode precondition applied because this queue changed
documentation, templates and local role configuration without changing a
service, migration, built image or cluster behavior. This was declared scope,
not skipped dev-mode debt; no service rebuild was required.

Current source inspection, separate from the predecessor-run record, shows that
`scripts/checks/doc-code-guards.sh` defines `g19_codex_manual_loop`, calls
`check-codex-manual-loop.py`, and invokes G19 after the KISS/full branch rejoins.
The checker therefore runs in both current modes. This is the current source
finding whose predecessor-era absence remains listed above.

T03 changed the `fp-dev.toml` source hash from
`d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5` to
`5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5`.
The five other lock entries remained:

- `.codex/config.toml`: `0e2aafb360454df9f511fe0ff65e0abb783ef5e533b17410d67b341e4d164e94`
- `.codex/agents/fp-architect.toml`: `1640055b7754993d2133b1a9b5df3a99271ae2df91fe2278631c71b6abacda4d`
- `.codex/agents/fp-qa.toml`: `38e65b353624c7abd7a5e81113e32b19c0bba8c4cebc7ad32f85bb65c5f5e3c8`
- `.codex/agents/fp-reviewer.toml`: `3c1d2938403918b35a1050a0338e18252480336a345703cba3a93af5416a05f8`
- `.codex/agents/script-runner.toml`: `c25e15631146484210f3d5d027baa34a709e2f438233125663f30a0435c70710`

The already-running session retained the old loaded fp-dev definition; the new
instructions took effect only in a fresh `codex -C <repo>` session. No restart
or earlier-task rerun was used to work around that ordering effect.

#### Later integrated certification

The isolated historical target `820221a9` was not self-consistent: its lock
named six files, four role files were absent, its committed config differed from
the locked bytes, and the checker and G19 guard wiring were absent. Reviewer A
found this and blocked certification attempt 1; Reviewer B approved. Their
separate verdicts are preserved in
`blocker-handoff-certification-evidence/T02-review-verdicts.md`.

The human resolved the dependency boundary by committing the pending repair as
`07e1d466`, `51689ecd`, `e111957b`, then `9fde0baa`, rather than reinterpreting
the defective isolated target. The human root-cause finding is composition:
each loop correctly committed only its allowed paths, but a lock landed without
its referents; no isolated loop failed. That finding does not erase the separate
DEVIATION A and DEVIATION B records.

Revision 4 of
`manual-loops/architecture/blocker-handoff-certification.md` made integrated
`9fde0baa9fbae768fc97133731eeb2744f90516e` the current certification target.
Its reviewed-state SHA-256 is
`275c436f3fa8b75efe0575f33866103f87bcbfa15fdd7dba64c4254635d30900`;
the packet SHA-256 is
`64384e65f840a54d55a22d21ef81b0163fc6b5d5e72d68882bfb59ac2b68a20b`.
All 3,892 frozen hashes matched. Nine attempt-2 commands ran sequentially and
exited 0 with native durations recorded in
`blocker-handoff-certification-evidence/T02-attempt2-gates.json`:

| Command | Working directory | Native duration |
| --- | --- | ---: |
| `./scripts/checks/doc-code-guards.sh` | main workspace | `0.772555125` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | main workspace | `3.333e-06` |
| `./scripts/checks/doc-code-guards.sh --full` | main workspace | `3.323310792` |
| `git rev-parse HEAD` | detached target worktree | `0.388331709` |
| exact-HEAD equality test for `9fde0baa9fbae768fc97133731eeb2744f90516e` | detached target worktree | `0.323493458` |
| fail-closed clean-status test before checker | detached target worktree | `0.675057958` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | detached target worktree | `0.443782834` |
| fail-closed clean-status test after checker | detached target worktree | `0.400039667` |
| T02 packet Accept | main workspace | `4.542e-06` |

This proves exact integrated HEAD, clean before, checker exit 0, and clean after
without borrowing dirty main-worktree files. The runner was native Luna/low run
`01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e`, turn
`01a082e9-b016-76c3-8a40-6c63a627036a`; developer was native Sol/medium run
`01a082e0-880b-7362-bf33-46d5d8673b1d`, turn
`01a082e0-884f-7683-b60e-78e15d58b1b7`; QA was native Sol/medium run
`01a082d6-d7a4-7211-be99-542a79729f10`, postimplementation turn
`01a082e5-cc7e-7230-bc45-6c85fb391139`.

Both independent Astra/high reviewers approved integrated `9fde0baa` after
assessing the original defect, resolution, current packet/SPEC and clean-tree
evidence. Their verbatim verdicts and native identities are in
`blocker-handoff-certification-evidence/T02-attempt2-review-verdicts.md`:
Reviewer A run `01a082eb-4ec2-7ee1-b85b-44047c7cef35`, turn
`01a082eb-4f06-7f72-80a7-1b2415c0caa6`; Reviewer B run
`01a082eb-9590-7740-9bb1-215ae4c32518`, turn
`01a082eb-95c8-70b1-9702-5ee781e6623c`. The certification SPEC's Progress
contains the complete current record and exceptions. Commit `b9764a6a` records
that certification; it is not the certified target.
 
## Out of scope (explicit)
 
- The J3 offline repair blocker (`platform-evaluation-j3-offline-repair.md`) and
  its TypeScript error — a separate approved continuation SPEC addresses it. This
  SPEC changes the format of future records only.
- Retroactive reformatting of existing BLOCKED records — frozen records stay intact.
- The runner pin, the checker script, guard wiring, `.codex/config.toml`, and every
  role definition other than `fp-dev.toml`.
- Any change to the attempt budget, closure conditions, or reviewer independence.
- Adding a diagnostic capability to the principal, the mechanical executor, or the
  reviewers.
## Human boundaries for this change
 
- Human approves this SPEC before the first run, and specifically approves T03 as
  dedicated configuration scope over `.codex/agents/fp-dev.toml` and the lock.
- Human confirms the lock refresh is intended before it is committed; a lock
  change is never a routine side effect of a feature task.
- Any wording change that would alter the attempt budget, closure rules, or a role
  prohibition requires human sign-off before code lands.
### Preflight — 2026-09-08

- T05 validated on attempt 2: G0/G19a/G19b/Accept all exit 0, durations 1.232074958 / 0.052794292 / 4.216873166 / 0.011029041 seconds. Full outputs and stable hashes: `blocker-handoff-diagnosis-evidence/T05-gates.json`. Final guide SHA-256 56ca347cfae38b6b4e0ad2da5aacf32239826f47ad9982698d86e9bac5073fb6; index SHA-256 87e5e73c9ceff99949e817f7df59d2821272cf3b2250e71f047d471429f73930. Two independent APPROVED Astra-high reviews: run 01a08230-49e4-7700-bf92-c2ccaef49efb, turn 01a08258-dd72-7152-b43b-8dbf30a29ff6; run 01a08230-94f8-7673-89b0-e35ee7090c30, turn 01a08259-1c0a-73b0-b8ba-07f39bb93b09. Both verified dated scope, exact hashes/single-entry change, fresh-session limitation, decision record/link, publication-time wording, QA-before-gates, and unchanged reviewed state.
- Final inventory qualification: all 3,731 initially hashed files reconcile to nine approved target files plus this SPEC. Initial is_file inventory omitted seven directory/dangling symlinks; no initial target snapshot exists, so their target preservation is unverified. Current mtimes predate the run but do not prove original target identity. Both independent reviewers acknowledged this evidence-only limitation, maintained APPROVED for unchanged task hashes, and found no concrete task blocker. No task edit to these links is evidenced. See `blocker-handoff-diagnosis-evidence/final-preservation.json`.
- Queue validation complete: T01-T05 each have actual passing gates and two independent approvals. T01 used two attempts (evidence correction); T05 used two attempts (pre-gate wording correction); other tasks used one. Native execution exceptions, permission handling and read retries are documented above and in per-task reports. No higher-cost model fallback, session restart, runtime build, cluster mutation, commit or push occurred. No service needs rebuilding. New fp-dev instructions activate only in a fresh Codex session. Engram was unavailable; the guide, index, SPEC and evidence directory are the durable record. Existing uncommitted work remains preserved separately; this validation does not certify or commit the broader baseline.
- T05 attempt 1 QA found two wording issues before any gates: the guide split literal Accept phrase `fresh Codex session` over lines, and the archive heading/body claimed T05 pending without an explicit publication-time qualifier. QA requires a one-line literal phrase and historical publication-time status pointing to current SPEC Progress. All other scoped additions/baseline preservation pass. Developer assigned correction attempt 2; no gate failed or was skipped, no tests changed. Engram discovery found no available tool; decision is persisted in allowed repository documentation.
- T04 validated on attempt 1: G0/G19a/G19b/Accept all exit 0, durations 1.158022292 / 0.056600458 / 4.268370833 / 0.012333500 seconds. Full outputs and stable hashes: `blocker-handoff-diagnosis-evidence/T04-gates.json`; three target hashes in `T04-state.json`. Two independent APPROVED Astra-high reviews: run 01a08230-49e4-7700-bf92-c2ccaef49efb, turn 01a08251-b28b-7d41-9c32-4f58f6d345c1; run 01a08230-94f8-7673-89b0-e35ee7090c30, turn 01a08251-d983-7c70-9721-07ce60ceb113. Both verified exact additions/swaps/convention, unchanged other gates/Accept chains/baseline, QA before gates and actual provenance. No implementation/gate retries, exceptions or commits. Cumulative preservation: `T04-preservation.json`.
- T03 validated on attempt 1: G0/G19a/G19b/Accept all exit 0, durations 1.136267333 / 0.056708416 / 4.528973625 / 0.106428375 seconds. Full outputs and stable target/SPEC hashes: `blocker-handoff-diagnosis-evidence/T03-gates.json`. Two independent APPROVED Astra-high reviews: run 01a08230-49e4-7700-bf92-c2ccaef49efb, turn 01a0824c-79c3-7d22-9c4d-7463495d5531; run 01a08230-94f8-7673-89b0-e35ee7090c30, turn 01a0824c-ae37-7750-9f49-061ba788900c. Both confirmed exact paragraph, prior paragraphs/pins preserved, single lock entry, native approvals, QA, gates and provenance. `T03-preservation.json` confirms only T01-T03 targets and SPEC changed among baseline files. No commits, service builds or cluster gates. This supersedes earlier pending T03 entries; all execution exceptions remain recorded.
- T03 permission resolved: both native escalations succeeded and the user reconfirmed authorization to edit. The prior pending-status message raced with completion and was corrected on observing disk hashes; no mutation was duplicated. Developer finished the exact third paragraph and single lock value. Old role SHA-256 d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5; new role SHA-256 5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5. Lock SHA-256 changed from a2b07aa23d06e135738f88f896d79da57b9b68e11577e454f64de71eb16e23a5 to e400b7badccf6d6c15779bd0142f0a10531da9e00ca13407e534122f5ed21701. Other five entries and all role pins remain unchanged. Current session retains the old loaded definition; no session restart or earlier-task rerun. QA/gates/reviews pending. Non-causal additional exception: malformed grouped-read JavaScript failed before any shell command; developer reported the cancelled direct write lasted 285.7 seconds and one approved retry followed, then separate approval for the lock update.
- T03 attempt 1 is pending native sandbox approval, not complete. Developer inspected checker arguments (`--root`, `--codex-dir` only; no refresh operation) and confirmed both baseline hashes. First protected apply_patch call stalled without a result; principal interrupted it, and the developer observed explicit `aborted by user` cancellation. Disk role hash remains d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5; lock hash remains a2b07aa23d06e135738f88f896d79da57b9b68e11577e454f64de71eb16e23a5. No partial write or gate occurred. Developer then requested the standard `require_escalated` execution approval for the exact T03 paragraph; that request is pending. This is an execution/permission exception, not a gate failure or an additional implementation attempt. Do not duplicate the pending operation. T04/T05 have not started. Baseline preimages are now also durable under `blocker-handoff-diagnosis-evidence/baseline-files/` (nine files).
- T02 validated on attempt 1: G0/G19a/G19b/Accept all exit 0, durations 1.147316292 / 0.051214375 / 3.710705125 / 0.009795458 seconds. Full outputs and stable hashes: `blocker-handoff-diagnosis-evidence/T02-gates.json`. Target SHA-256 8270bad50214b821efc8f19475be5f2dbccd6b25175d82a3a7197984365a3904. Two independent APPROVED Astra-high reviews: run 01a08230-49e4-7700-bf92-c2ccaef49efb, turn 01a0823e-2699-78e3-8e4d-a76273ecf165; run 01a08230-94f8-7673-89b0-e35ee7090c30, turn 01a0823e-63d3-7a73-9a9c-922917f1dbec. Both confirmed exact paragraph, preserved roles/baseline/T01, analysis-only authority, QA before gates, and actual provenance. Implementation/QA and non-causal coordination exceptions: `blocker-handoff-diagnosis-evidence/T02-implementation-qa.md`. No implementation retry or gate fallback; no commit performed.
- T01 validated on attempt 2: G0 exit 0 (1.100221708 s), G19a exit 0 (0.054027708 s), G19b exit 0 (4.096122291 s), Accept exit 0 (0.012824875 s). Full captured outputs and before/after hashes: `blocker-handoff-diagnosis-evidence/T01-attempt2-gates.json`. Implementation SHA-256 009b949a88a2205d9c7f39b3cdf7735738eec6da3e21a7035e19671c0615258b. Two independent APPROVED reviews: Astra high run 01a08230-49e4-7700-bf92-c2ccaef49efb, turn 01a08235-671c-7343-8ce4-7ef11668ed94; Astra high run 01a08230-94f8-7673-89b0-e35ee7090c30, turn 01a08235-9c66-7a20-b2cd-7f86580db0d9. Both verified unchanged implementation and SPEC, exact replacement, QA and baseline preservation. Non-blocking note from both: attempt-2 `started_utc` fields are completion times; measured elapsed durations are valid. Preserve reviewed evidence as written and interpret those fields accordingly. No commit performed; preexisting uncommitted work remains separate from this task's validation.
- T01 attempt 1: implementation and QA complete; G0, G19a, G19b and Accept all exit 0. Reviewer A (Astra high, 01a08230-49e4-7700-bf92-c2ccaef49efb) APPROVED; reviewer B (Astra high, 01a08230-94f8-7673-89b0-e35ee7090c30) REJECTED evidence for a miscopied Accept duration and an omitted evidence-write exception. Full verdicts: `blocker-handoff-diagnosis-evidence/T01-review-attempt1.md`. Original outputs preserved under `attempt1/`. No task closure.
- T01 attempt 2: developer confirms no implementation correction needed. Its follow-up hash text was malformed; actual file identity remains independently verified from disk. The runner clarified Accept duration as 0.000003875 seconds (native tool report) and the non-causal failed/corrected apply_patch output write. Principal corrected evidence; no implementation bytes changed. Repeat QA, all gates and two independent reviews before closure. No gate retry occurred within attempt 1.
- Preimplementation QA (fp-qa, actual Sol medium, run 01a08228-815f-7351-81a7-cc78f1e234ff) returned GO for T01. Cases: compare against frozen baseline rather than HEAD; preserve step-7 first/final bullets and all outside text byte-for-byte; require heading/10-line limit, handoff before full legacy evidence, non-causal label, and unchanged retry/budget/closure prohibitions. For T02-T05, QA requires exact insertions, single-entry lock refresh, unchanged role pins and template Accept chains, and dated evidence only within allowed paths. No test edits or gates occurred in preimplementation QA.
- Durable evidence directory: `manual-loops/architecture/blocker-handoff-diagnosis-evidence/`. Initial baseline and sanitized native provenance are preserved there; temporary preimages remain under `/tmp/blocker-handoff-run/baseline/` during execution.
- User authorized execution and the replacement of the Spanish heading with `For humans` throughout this SPEC, including Accept. No attempt has started.
- Baseline: 3,731 tracked/untracked file hashes captured in `/tmp/blocker-handoff-run/baseline.json`; staged/unstaged diffs, status and copies of target files are retained alongside it. Preexisting changes belong to earlier work and are preserved.
- G19 is called after the KISS/full branch in `doc-code-guards.sh`; both modes invoke it.
- Evidence-writing correction: shell interpolation removed three inline-code spans from this preflight note and emitted command-not-found/permission-denied diagnostics. The principal restored the exact spans using apply_patch. No gate or implementation command ran.
- Cluster gates and dev-mode validation do not apply: this queue changes documentation, templates and local role configuration, with no service build, migration or cluster behavior. No skipped dev-mode debt is claimed.
- Runner callability probe: native script-runner run 01a08228-5aa1-7c92-afdb-dd55fdbc8be8, actual turn context gpt-5.6-luna low. Its self-report lacked reliable model identification; actual telemetry resolves it. The approved Luna cost-tier exception and Codex subscription credit basis are recorded in the predecessor repair SPEC (Final runner selection, 2026-09-07); no model/provider fallback is used.
