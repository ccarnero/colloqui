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

- ONE task in flight at a time. Never start a task with a dirty `git status`.
- Max 4 implementation attempts per task. The SAME error appearing in 2 consecutive
  attempts blocks the task immediately (do not spend the remaining attempts).
- A task has a token ceiling, declared in the SPEC's Progress. Crossing it blocks
  the task exactly like an exhausted attempt budget.
- A task is committed ONLY when all gates are green AND both reviewers returned APPROVED.
- Anything else at the end of the budget → block (step 7).
- Gates marked "from Txx onward" only run once that task exists in the queue history.
- AGENTS.md wins over Constraints, this procedure, roles, and templates.

This procedure depends on no tool to hold these. The monitor (agentes-en-vivo)
reads the session rollouts and alerts when a task crosses its attempts, its
tokens, or repeats an error; the human stops the loop.

## Per-task cycle

1. **Preflight.** `git status --porcelain` must be empty. If not, STOP and report —
   never discard changes you did not create. Read the task's section from the SPEC.

2. **Implement.** Launch the implementer role (`fp-dev` in Codex, `implementer` in
   Claude Code) with: the full task text and acceptance criteria, the SPEC's
   Constraints section, and (on retries) the exact gate/review failures from the
   previous attempt. Nothing else.

3. **QA (only when the SPEC asks for it).** Launch the QA role (`fp-qa`) with the
   task, its acceptance criteria, Constraints, and the implementer's report. It
   completes missing tests within allowed paths and finishes before any gate runs.

4. **Gates.** Run the SPEC's Gates in order, then the task's own **Accept** commands,
   verbatim. The orchestrator runs them itself. First failure ends the attempt. Two
   gate classes, per the SPEC's labels:
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

7. **Commit.** Gates green + 2× APPROVED → check the task off in the SPEC's Progress
   list, include the SPEC in the same commit, and commit with a conventional message
   scoped to the task, e.g. `feat(workflow-service): T03 block disabled executions`.
   No Co-Authored-By.

8. **Block.** Attempt budget or token ceiling exhausted, or same error twice in a row:
   - Ask the implementer for its handoff note (plain-language failure, root cause
     with `file:line`, one to three candidate fixes with diff and risk). Analysis
     only: it allocates no attempt and authorizes no retry.
   - Preserve the work and leave the tree clean for the next task:
     `git stash push -m "BLOCKED <spec> <task>"` scoped to the paths the task touched.
   - Append to `BLOCKED.md` (repo root): the handoff note first, then spec file,
     task id, date, attempt count, the exact failing gate/objection, error output
     (trimmed), and what was tried per attempt.
   - Report to the user and STOP the loop — do not continue to the next task.

9. **Next.** After a successful commit: `git status` clean again → proceed to the next
   unchecked task (unless a task id was pinned — then stop and report).

## Reporting

At the end of the run, report: spec file, tasks completed (with commit hashes), task
blocked (if any) with the BLOCKED.md pointer, and which services need a rebuild.

## What is deliberately not here

No cost tiers, model provenance, mechanical executor, evidence packets, or record
certification. Those lived in this procedure between 2026-09-06 and 2026-09-09; in
that week the orchestrator spent 59 % of 591 M tokens, the implementer wrote reports
instead of code, and ten loops ran about the loop and none about the product. Model
selection is repository configuration (`.codex/config.toml`, `.codex/agents/*.toml`);
no role is asked to prove it. A SPEC about the loop itself is not a task queue: it is
a configuration change and goes through the human directly.
