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
```
grep -n "For humans" DOCS/guides/manual-loop.md && \
grep -n "non-causal" DOCS/guides/manual-loop.md && \
grep -n "creates no budget" DOCS/guides/manual-loop.md && \
grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md
```
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

- Achieved: T01-T05 changes were recorded; later certification validated the integrated state.
- Remaining: none in this historical queue.
- Blocked: predecessor evidence gaps remain historical; no missing approval is inferred.
- Attempts: T01 2/4, T02 1/4, T03 1/4, T04 1/4, T05 2/4; no budget is reset.
- Validation: integrated target 9fde0baa was later certified; see blocker-handoff-certification-evidence/SUMMARY.md.
- Evidence: detailed packet retired by Chris on 2026-09-09. Historical gates and baselines are not reusable.

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
