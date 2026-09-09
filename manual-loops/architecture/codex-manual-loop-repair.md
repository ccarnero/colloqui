# SPEC — Restore and protect Codex manual-loop configuration

Origin: Chris approved the displayed repair plan and then "ok adelante entonces con los cambios", 2026-09-07.
Engram topic: `architecture/codex-manual-loop-repair`.

## Goal

Restore durable project-local Codex roles for the existing manual-loop engine,
detect their removal or model drift, and establish native loading and execution
evidence without restarting any application evaluation. Files installed is not
equivalent to roles loaded, models available, or a completed repair.

## User decisions and approval

The user's approval covers this bounded implementation of the previously shown
plan, configuration-only checks, harmless role/model probes and dual review.
No new approval is inferred for application builds, E2E, provider/auth changes,
API integration, global tooling changes, commits or pushes. This SPEC does not
restart or replenish any predecessor budget. Recovery R01 remains exhausted.

| Responsibility | Model | Effort |
| --- | --- | --- |
| Principal for future loops | gpt-6-astra | medium |
| fp-architect | gpt-6-astra | high |
| fp-dev and fp-qa | gpt-5.6-sol | medium |
| Two independent fp-reviewer runs | gpt-6-astra | high |
| script-runner | gpt-5.6-luna | low |

## Constraints

- Full AGENTS.md and the shared manual-loop/role contracts apply. The principal
  writes SPEC/evidence only; fp-dev implements and owns regression tests. QA
  finishes edits before gates, then two independent reviewers assess one state.
- Preserve all existing tests. Keep structural inheritance validation usable as
  a generic function, and add mandatory project policy validation. Do not change
  a passing absence test to conceal a weakened check or delete historical tests.
- Restore native standalone TOML roles from retained installation artifacts,
  adapting approved pins and removing obsolete role references. No competing
  orchestration engine or custom API runner. Use the installed native mechanism.
- Protect configuration from routine-loop edits. Explicit repair authorization
  covers this SPEC only. Documentation must distinguish sandbox enforcement,
  drift detection and human policy; do not claim absolute immutability or remote
  branch protection without evidence. No global permission/ownership changes.
- All baseline changes are preserved. Evidence baseline lists 3,547 tracked and
  untracked paths. Frozen SPECs and all evaluation harness/evidence are read-only.
- Existing shared-doc edits are a preserved unvalidated baseline, not this repair's
  implementation. Make only a narrow additive Codex exception/protection notice
  where needed; identify the baseline separately in review packets.
- Initial Sol QA/dev and Astra reviewer delegation may use the explicitly reported
  native conversation fallback to repair the missing mechanism. It is NOT evidence
  of named-role loading. Record requested and observed model/run separately.
- Mechanical gates require verified selected-runner callability and applicable cost
  basis, or a separate explicit user cost exception. A failed selected-runner probe is a
  prerequisite blocker, not permission to substitute Sol/Luna/Astra. Continue
  unaffected preparation/implementation; do not claim gates or closure complete.
- No product builds or dependency installs apply to this configuration-only scope.
  Record actual Python/Codex versions. No cluster commands, deletion, reset or
  recovery invocation. No secrets in captured output.

## Gates

Working directory: repository root. One eligible executor owns exact commands,
in order, stops at first failure, and returns output/status/duration/state/run
evidence. Maximum four implementation attempts; repeated same error twice blocks.

```sh
/bin/bash scripts/checks/doc-code-guards.sh
python3 scripts/checks/check-fp-delivery.py
python3 scripts/checks/check-codex-manual-loop.py
python3 -m unittest discover -s scripts/tests -p 'test_fp_delivery.py'
python3 -m unittest discover -s scripts/tests -p 'test_codex_manual_loop.py'
git diff --check
```

Native config parsing, role discovery, harmless invocation and non-mutating
protected-path checks are additional acceptance evidence. Record the exact
commands before running them; configuration probes are not application gates.
Model or tools-list text copied from AGENTS.md is not discovery evidence. A
missing native selector or unsupported model remains a blocker. Preserve raw
sanitized failures rather than retrying with another provider/model.

## Task queue

### T01 — Restore native roles, pin policy and document verified invocation

Allowed implementation paths:
- `.codex/config.toml`, `.codex/agents/fp-{dev,qa,architect,reviewer}.toml`,
  `.codex/agents/script-runner.toml`, `.codex/manual-loop.lock.json`.
- `scripts/checks/check-fp-delivery.py`, `scripts/checks/check-codex-manual-loop.py`,
  `scripts/checks/doc-code-guards.sh` (one guard integration only).
- `scripts/tests/test_fp_delivery.py` (additive only),
  `scripts/tests/test_codex_manual_loop.py`.
- `AGENTS.md`, `DOCS/guides/manual-loop.md`, `DOCS/guides/agent-roles.md`
  (narrow Codex exception/protection notice, preserve existing edits),
  `DOCS/guides/codex-manual-loop.md`, `DOCS/archive/INDEX.md` (one truthful row).
- Temporary candidate files under `/tmp/codex-manual-loop-repair/` if protected
  installation needs separate sandbox approval. No out-of-scope final files.

Principal-only paths: this SPEC and `codex-manual-loop-repair/evidence/` beneath
this directory. Developer may return staged reports under the temporary root;
the principal persists evidence. No edits to old SPECs, evaluation files,
manual-loops/README.md, templates, global configuration or personal tooling.

Before writing, read full AGENTS.md, shared engine and roles, this complete task,
Constraints, Gates, baseline status/diff/hashes, and retained role definitions in
`/tmp/fp-delivery-integration/codex-staged/`. Inspect existing checker/tests.

QA acceptance cases supplied by `repair_qa_sol`, observed Sol medium, before
implementation:
1. Mandatory project validation fails for each missing role/config, empty config,
   malformed TOML, incorrect model/effort/name/sandbox and unexpected roles.
2. Preserve all generic structural validator tests; project pins are an additional
   invariant, not a replacement for validation of optional generic overrides.
3. Referenced canonical contract files exist; retired local Claude role paths
   and second retry/closure engines are rejected. Role files are local regular
   files, not mutable external symlinks. Hash drift/removal is detected.
4. Principal pins Astra medium; Sol medium dev/QA; Astra high architect/review;
   GPT-5.6 Luna low runner. Reviewer/architect read-only. Runner workspace-write is
   permitted for approved gates to persist artifacts, but no independent edits,
   diagnosis, retries, scope/closure decisions or duplicate process ownership.
5. Native role-loading evidence identifies requested role, resolved definition,
   model/effort and actual run. Generic copied role packets cannot satisfy it.
6. Selected-runner refusal records exact error and blocks mechanical gates; no automatic
   model/provider fallback. Billing/cost eligibility is separately evidenced.
7. Immutability claims name the enforcement layer and limits. Normal SPECs cannot
   authorize changes to their own runner/config/protections; dedicated human
   authorization is required. Guards never auto-update the accepted lock.
8. Existing evaluation history/harness/evidence and dirty baseline remain intact.
9. Gate results and two independent reviews cover identical final task artifacts;
   source/contract changes invalidate them. No review may certify missing evidence.

Accept: all Gates above, verified native loading and harmless execution for every
configured role, no silent substitutions, verified protected-path behavior,
baseline preservation, and two independent APPROVED reviews. Partial installation
with blocked execution is explicitly pending, never a completed manual loop.

## Progress

- Achieved: native roles, policy pin and checker protection restored and validated.
- Remaining: none in T01; product evaluation remains separate.
- Blocked: none.
- Attempts: T01 3/4.
- Validation: 16 generic and 18 policy tests plus all six gates passed; two independent Astra/high reviewers approved.
- Cost decision: historical 2026-09-07 “ok luna”; recorded Codex credit rates Luna 5/0.5/30 and Sol 100/10/500, not asserted current.
- Evidence: detailed packet retired by Chris on 2026-09-09; see codex-manual-loop-repair/SUMMARY.md.

## Human boundaries

This repair is approved. Sandbox escalation for exact project protected-file
installation may be needed; stage concrete files first. No global authentication
change or paid API integration is approved. An unavailable eligible executor needs
a user decision before gates, not an inferred exception. Engram is not exposed
as a tool in this session; this SPEC is the durable record until memory persistence
is available. Do not claim this repair complete or restart exhausted evaluations.
