# Project-local Codex manual-loop configuration

Class: descriptive
Summary: The installed Codex role layout, its validation and protection layers, and the evidence required before use.

The repository uses standalone native role definitions in `.codex/agents/*.toml`.
`.codex/config.toml` enables subagents and selects the project principal default.
Each role file supplies a complete name, description, model, reasoning effort,
sandbox, and developer instruction set; it does not inherit a partial global role
definition. The exact approved pins are executable policy in
[`check-codex-manual-loop.py`](../../scripts/checks/check-codex-manual-loop.py)
and the accepted file bytes are recorded in `.codex/manual-loop.lock.json`.
The subagent default uses the implementation/QA tier as a defensive default;
manual-loop work still selects a named role, whose complete definition wins, and
an unnamed fallback cannot satisfy native role-loading evidence.
The selected mechanical runner pin is `gpt-5.6-luna` with low reasoning effort,
following the human's explicit cost-policy decision. Its configured value still
requires a harmless native invocation before it may execute gates.

## Roles and ownership

| Native role | Responsibility | Write boundary |
| --- | --- | --- |
| `fp-dev` | Implement one approved task and its regression tests. | SPEC-allowed paths only. |
| `fp-qa` | Plan acceptance coverage, then complete missing tests before gates. | SPEC-allowed test paths only. |
| `fp-architect` | Advise on a material design decision. | Read-only. |
| `fp-reviewer` | Independently assess one unchanged state and its evidence. | Read-only. |
| `script-runner` | Execute approved mechanical gates verbatim and report evidence. | Artifacts produced by those commands and requested evidence only. |

The principal remains the sole coordinator. Native roles do not own retries,
scope changes, commits, or closure, and they do not create another orchestration
engine. The runner cannot diagnose, edit, retry, or choose a fallback model.

## Usage

Start a fresh Codex session in the repository so the project configuration and
native `agent_type` role selector are loaded:

```sh
codex -C /Users/chris/sources/yoizen/platform-cluster
```

Then ask the principal in plain language to execute the manual loop for a concrete,
human-approved SPEC, for example:

```text
Execute the manual loop for manual-loops/<area>/<approved-spec>.md, task T01 only.
```

Replace the placeholder with an actual approved SPEC path and omit the task ID to
process its approved queue. An already-running session may retain an older tool
schema without native `agent_type`; start a fresh session instead of inventing a
launcher, slash command, or fallback role route.

## Validation and native evidence

`check-fp-delivery.py` remains the generic structural validator and accepts a
project with no local overrides. `check-codex-manual-loop.py` adds this project's
mandatory policy: exact role set and pins, local regular files, canonical contract
references, retired Claude role absence, and SHA-256 lock integrity. G19 invokes
the mandatory checker in both KISS and full guard modes. The checker reports drift
and never rewrites or refreshes the lock.

A fresh Codex CLI session on 2026-09-07 loaded the project principal configuration,
exposed native `agent_type` selection, resolved `fp-dev`, and created a child whose
recorded role and observed model/effort matched its definition. The repair SPEC's
evidence directory records the command, sanitized output, run identities, and
provenance. The already-running desktop conversation retained its older tool
schema; it is not negative evidence about the fresh session. Harmless fresh-session
probes subsequently loaded `script-runner`, `fp-qa`, `fp-architect`, and
`fp-reviewer`; recorded instruction hashes and actual turn context matched every
configured role, model, and effort, and the children made no tool calls. These five
native role observations do not replace repository-content QA, mechanical gate
execution, or two independent approvals; the
[repair SPEC](../../manual-loops/architecture/codex-manual-loop-repair.md) records
their current status. Files on disk or copied role packets alone do not satisfy
native loading proof.

On 2026-09-08, the human-approved
[blocker handoff diagnosis SPEC](../../manual-loops/architecture/blocker-handoff-diagnosis.md)
used dedicated configuration scope to change `fp-dev.toml` from SHA-256
`d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5` to
`5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5`;
only that file's lock entry changed. The new instructions take effect only in a
fresh Codex session. The decision is that a final failed-attempt handoff is
analysis only: it authorizes no retry, allocates no attempt or budget, and creates
no continuation SPEC. `fp-dev` supplies the diagnosis because it already reasoned
about the code; the principal, mechanical executor, and reviewers retain their
existing prohibitions. This gives the human a concise cause and candidate fixes
before audit evidence without changing retry or closure rules. The SPEC's Progress
records the validation evidence and current T05 status. Engram topic:
`manual-loop/blocker-handoff` (durable record here; no memory tool was available).

## Protection boundaries

The current repair session observed the project sandbox reject a write-open of
`.codex/config.toml`; its before/after hash was unchanged. That demonstrates the
active session's sandbox boundary only. The hash lock and G19 detect deletion or
content drift when guards run. AGENTS.md requires dedicated human-approved scope
for edits to the role definitions, runner, lock, checker, or guard integration.
These layers do not make files immutable on the host and do not establish remote
branch protection.

Configuration selects intent; it does not prove that a model is callable or that
its applicable account cost satisfies the mechanical-executor ceiling. Before
gates, the principal verifies the configured runner's native invocation and actual
cost basis. A refusal or cost mismatch blocks gate execution unless the human
approves a different pin or a scoped cost exception. There is no automatic model
or provider fallback.
