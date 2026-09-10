# Manual-loop procedure

Class: prescriptive
Summary: One task at a time, gates run verbatim, two independent reviews, commit per green task. The same procedure for Codex and Claude Code.

[AGENTS.md](../../AGENTS.md) is normative. This is the engine that closed queues in
July and August 2026 (`983e6c10`), written once for every tool: Codex runs it as the
principal with the native roles in `.codex/agents/`; Claude Code runs it as the
`/manual-loop` command with the agents in `.claude/agents/`. The role texts are the
same bytes in both places (see [codex-manual-loop.md](codex-manual-loop.md)).

The orchestrator — the assistant in the main conversation — coordinates. It NEVER
implements, reviews, or fixes code itself. All code work goes through the
implementer and reviewer roles. It may read and explain a failure; it may not
repair it.

## Inputs

- A SPEC file path (e.g. `manual-loops/workflow-toggle.md`) and optionally a task
  id (e.g. `T03`) to run only that task. A slash command parses its own arguments;
  the Codex principal receives them in plain language ("Execute the manual loop for
  `<spec>`, task T03 only").
- The SPEC file provides EVERYTHING repo-specific:
  - **Gates** section: commands to run verbatim, in order, plus per-task **Accept** blocks.
  - **Constraints** section: passed to the implementer with every task.
  - **Task queue**: tasks in order, each with acceptance criteria.
  - **Progress** checklist: source of truth for what is done, attempts, and the
    task's token ceiling.
- If no SPEC path is given, or the file lacks a Gates section or Progress checklist,
  STOP and report — never invent gates.

## Invariants

- ONE task in flight at a time. The working tree belongs to the human: whatever is
  uncommitted outside the task's files when it starts is theirs, and the loop neither
  touches, stages nor reports it. The task itself writes only inside its Allowed write
  paths, the SPEC's Progress and `BLOCKED.md`.
- The loop writes to the SPEC only inside its **Progress** section: the attempt
  counter and one line of result per task. No evidence tables, gate output, stash
  hashes, tool-availability notes or new sections — the rollout, `BLOCKED.md` and
  the commit are the record. Allowed write paths change only on the human's word.
- Max 4 implementation attempts per task. The SAME error appearing in 2 consecutive
  attempts blocks the task immediately (do not spend the remaining attempts).
- A task has a token ceiling, declared in the SPEC's Progress. Crossing it blocks
  the task exactly like an exhausted attempt budget.
- A task is committed ONLY when all gates are green AND both reviewers returned APPROVED.
- Anything else at the end of the budget → block (step 8).
- Gates marked "from Txx onward" only run once that task exists in the queue history.
- AGENTS.md wins over Constraints, this procedure, roles, and templates.

The orchestrator states the attempt count and the tokens spent when it launches
an attempt; the human stops the loop when they disagree with the record.

## Per-task cycle

1. **Preflight.** Run `python3 scripts/loop-commit.py <spec> <task> --check`. It
   records what is already uncommitted outside the task's files as the human's
   (ignored from here on) and lists any work already inside the task's paths (a
   task resumed after a block starts from it). It does not fail; never discard
   changes you did not create. Read the task's section from the SPEC.

2. **Implement.** Launch the implementer role (`fp-dev` in Codex, `implementer` in
   Claude Code) with: the full task text and acceptance criteria, the SPEC's
   Constraints section, and (on retries) the exact gate/review failures from the
   previous attempt. Nothing else.

3. **QA (only when the SPEC declares `QA: fp-qa`).** The line sits next to
   `Gate executor:`; absent or `QA: none` means no QA step. Launch the QA role (`fp-qa`) with the
   task, its acceptance criteria, Constraints, and the implementer's report. It
   completes missing tests within allowed paths and finishes before any gate runs.

4. **Gates.** Run the SPEC's Gates in order, then the task's own **Accept** commands,
   verbatim. The orchestrator runs them itself, or — when the SPEC says
   `Gate executor: script-runner` — hands the exact command list to the runner role
   (`script-runner`, a cheap model) and reads back exit codes and trimmed output, so
   build and E2E logs stay out of its own context. First failure ends the attempt.
   Two gate classes, per the SPEC's labels:
   - Gates labeled **ITERATION** run on EVERY attempt (fast feedback).
   - Gates labeled **COMMIT GATE** run ONCE per task, only after all iteration
     gates are green — immediately before dual review. A commit-gate failure is
     a failed attempt: fix, re-green iteration gates, re-run the commit gate.
   - Honor any PRECONDITION rules in the SPEC's Gates section before task 1.
   - Keep exit status and trimmed output per gate.

5. **Dual review.** Capture `git diff` (plus `git diff --stat`, and the full content
   of new files) and launch TWO reviewer roles (`fp-reviewer` in Codex, `reviewer`
   in Claude Code) IN PARALLEL, each receiving the same diff, the task text, and the
   SPEC's Constraints section. Nothing else — reviewers judge the diff against the
   task and the constraints, not against the whole SPEC. Do not show one reviewer
   the other's verdict.

6. **Objections.** If either reviewer returns REJECTED over code, tests, scope, or
   constraints, send the objections (verbatim, both reviewers merged) back to the
   implementer as a new attempt; then re-run gates and re-review. Each such round
   consumes one attempt. Notes about the record are not objections: the
   orchestrator fixes the record without spending an attempt.

7. **Commit — the human's call.** Gates green + 2× APPROVED → update the SPEC's
   Progress (attempt count, one line of result) and run
   `python3 scripts/loop-commit.py <spec> <task>` (dry run). It checks that every
   changed file is inside the task's Allowed write paths, prints status, diffstat and
   the exact conventional message (`feat(<scope>): T03 <title>`, SPEC and attempts in
   the body, no Co-Authored-By), and exits 2. Paste that output, then STOP the turn:
   the human commits with `--yes` from a terminal, or tells you to. A file outside the
   allowed paths is a failed attempt, not something to stage anyway.

8. **Block.** Attempt budget or token ceiling exhausted, or same error twice in a row:
   - Ask the implementer for its handoff note (plain-language failure, root cause
     with `file:line`, one to three candidate fixes with diff and risk). Analysis
     only: it allocates no attempt and authorizes no retry.
   - Leave the work in the tree exactly as it is: no stash, no revert, no WIP commit.
     The loop stops here, so nothing else needs a clean tree; the human decides
     whether to resume (the preflight accepts the task's own files), commit it as
     WIP or discard it.
   - Append to `BLOCKED.md` (repo root): the handoff note first, then spec file,
     task id, date, attempt count, the exact failing gate/objection, error output
     (trimmed), and what was tried per attempt.
   - Report to the user and STOP the loop — do not continue to the next task.

9. **Next.** Once the human has committed → proceed to the next
   unchecked task (unless a task id was pinned — then stop and report).

## Reporting

At the end of the run, report: spec file, tasks completed (with commit hashes), task
blocked (if any) with the BLOCKED.md pointer, and which services need a rebuild.

## What is deliberately not here

No cost tiers, model provenance, executor process-identity rules, evidence packets,
or record certification. Those lived in this procedure between 2026-09-06 and 2026-09-09; in
that week the orchestrator spent 59 % of 591 M tokens, the implementer wrote reports
instead of code, and ten loops ran about the loop and none about the product. Model
selection is repository configuration (`.codex/config.toml`, `.codex/agents/*.toml`);
no role is asked to prove it. A SPEC about the loop itself is not a task queue: it is
a configuration change and goes through the human directly.
