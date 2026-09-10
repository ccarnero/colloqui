# Project-local Codex manual-loop configuration

Class: descriptive
Summary: The Codex role set for the manual loop, how it stays identical to the Claude Code agents, and how to run it.

The repository ships native Codex roles in `.codex/agents/*.toml`; `.codex/config.toml`
enables subagents and sets the defaults. The procedure the principal follows is
[manual-loop.md](manual-loop.md); the role texts are in [agent-roles.md](agent-roles.md).

## Roles

| Role | Used by the loop | Write boundary |
| --- | --- | --- |
| `fp-dev` | Every task: implements one task and its regression tests. | `workspace-write` |
| `fp-reviewer` | Every task, two in parallel: reviews the unchanged diff. | `read-only` |
| `fp-qa` | Only when the SPEC declares `QA: fp-qa` (absent = none): completes missing tests after implementation, before gates. | `workspace-write` |
| `fp-architect` | Only when a task has a material design decision. | `read-only` |
| `script-runner` | Only when the SPEC says `Gate executor: script-runner`: runs the gate commands verbatim on a cheap model and returns exit codes and trimmed output, keeping build and E2E logs out of the principal's context. | `workspace-write` |

The principal runs the gates itself unless the SPEC delegates them to the runner.
The runner is an executor, not a role with judgment: it does not diagnose, retry,
edit or decide. The cost-tier, provenance and evidence-packet rules that surrounded
it in September were retired on 2026-09-09; the model pin is plain configuration.

## One text per role

`fp-dev.toml` and `fp-reviewer.toml` carry, byte for byte, the same instructions as
`.claude/agents/implementer.md` and `.claude/agents/reviewer.md` (the Claude Code
file adds only its front matter). `scripts/checks/check-loop-roles-sync.py` compares
them and G19 fails on any difference — so the two engines cannot drift. Edit the
role once, in either place, and copy it to the other; the checker tells you which
one is stale. The former SHA-256 lock froze the bytes instead of syncing them and
made every role edit a configuration SPEC; it was retired with the runner.

## Usage

Start a fresh Codex session in the repository so the project configuration and the
native role selector are loaded:

```sh
codex -C /Users/chris/sources/yoizen/platform-cluster
```

Then ask the principal in plain language to execute the manual loop for a concrete,
human-approved SPEC:

```text
Execute the manual loop for manual-loops/<area>/<approved-spec>.md, task T01 only.
```

Omit the task id to process the approved queue. The same SPEC runs unchanged in
Claude Code with `/manual-loop <spec> [task]`.

