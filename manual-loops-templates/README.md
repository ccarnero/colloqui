# Manual-loop templates

Start with `spec-simple-template.md`. Use `spec-canonical-template.md` only
when the work needs dependencies, a prior-art registry, or additional gate
instructions. Remove template notes and unused examples before approval.

[AGENTS.md](../AGENTS.md) is normative. The shared
[manual-loop procedure](../DOCS/guides/manual-loop.md) defines execution and
[agent-roles.md](../DOCS/guides/agent-roles.md) defines specialist responsibilities.
This folder owns SPEC authoring format only.

## KISS defaults

- G0 is `./scripts/checks/doc-code-guards.sh`, which defaults to KISS.
  Use `--full` only for an explicitly scoped broader audit and explain why.
- KISS selects the repository guards. It does not replace service tests,
  typechecks, task acceptance checks, or applicable cluster e2e gates.
- Include concrete commands for the services and behavior in scope. Remove
  template placeholders before running a SPEC. Never weaken existing tests.
- Keep Constraints short: specialize AGENTS.md without duplicating or weakening it.
- Use one acceptance block per task for its specific outcome. Do not repeat
  commands already covered by shared gates unless a different check is needed.
- Preserve existing task IDs, decisions, acceptance criteria, and progress.
  Do not turn reference notes or historical reports into executable SPECs
  merely to give every Markdown file identical headings.
- For FP-scoped work, record QA acceptance cases before implementation, require
  the developer's regression tests, and leave QA's final test edits before the
  gates and dual review. Manual-loop owns retries and closure.

## Authoring contract

Every agent receives full AGENTS.md, task body with allowed paths/non-goals and
Accept, all Constraints, applicable gates/conditions, and baseline ownership.
Reviewers also receive staged/unstaged diffs, full untracked new file content,
actual gate output/statuses, and implementation/model provenance. Retry failures
go to implementers. Repeat needed decisions/prior art from other sections in tasks.
AGENTS.md wins; Constraints specialize it; skills and precedent are advisory.
FP role prompts are specialist instructions; they do not create a competing loop
or replace the manual-loop engine.

| Section | What to include |
|:---|:---|
| Preamble | Origin, Engram topic, and dependencies when applicable |
| Goal | Observable outcome |
| User decisions | Approved choices the loop must preserve |
| Constraints | Rules that apply to every task |
| Gates | Self-contained commands and their execution conditions |
| Task queue | Stable IDs, allowed write paths, non-goals, tests, and Accept blocks |
| Progress | Checkboxes, gate output/statuses, model/run provenance, reviews, debt |
| Out of scope | Explicit exclusions |
| Human boundaries | SPEC approval and any destructive or business decisions |

Prior art and additional context sections are optional. Keep them only when
needed; they are not automatically forwarded to agents.
Keep framework shells thin, business calculations pure with typed failures, and
logging in the shell. For affected builds require pinned tools, frozen lockfile
installation/build evidence; persistent writes/migrations need boundary tests.

## Approval and handoff

Create `manual-loops/<area>/<name>.md`, fill in executable gates and acceptance
checks, and obtain human SPEC approval. Then pass the approved path and optional
task ID to the principal using the [shared procedure](../DOCS/guides/manual-loop.md).
A tool's slash command is an adapter, not a requirement for running the procedure.
Declare applicable environment preconditions in Gates, including dev-mode
validation and built-image conditions where needed; see the
[dev-mode guide](../DOCS/guides/dev-mode.md). Do not copy executable examples
without checking applicability or invent commands from placeholders.

## Maintaining a loop

Append new tasks without renumbering existing ones. Record findings, retries,
and approved design changes in Progress. Keep completed evidence intact.
Declare the Engram topic and save decisions and the final outcome there when
memory is available; report unavailable memory rather than claiming a save.
The human runs the first destructive `--apply`.

Update active SPECs when their workflow changes. Leave frozen records intact;
put subsequent corrections in a dated follow-up record.
