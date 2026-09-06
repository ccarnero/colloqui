# SPEC: Uniform engineering contract

> Origin: user authorization on 2026-09-05 to implement a consistent, KISS
> engineering scheme; global fp-architecture v2.0 confirmed by the user.
> Engram topic: architecture/uniform-engineering-contract

## Goal

Every new change receives the same repository rules, stays within an approved
scope, and supplies reproducible verification and independent review evidence.
This task establishes the workflow; it does not certify or migrate all services.

## User decisions

1. KISS repository guards remain the default.
2. Functional core / imperative shell applies across frameworks. Keep existing
   libraries; adopting Effect or migrating a service requires separate scope.
3. Tests and independent review precede a completion claim.

## Constraints

- Preserve existing tests, contracts, prior changes, and historical records.
- Keep one normative source in AGENTS.md; the global skill is authoring input,
  not a filesystem dependency for other developers or CI.
- Pure calculations accept data and return values or typed failures. I/O,
  logging, time, randomness, and exception conversion belong in the shell.
- Framework classes may be thin shells. Existing deviations are recorded with
  paths and remediation scope; they are not permission to copy the deviation.
- No service rewrites, dependency additions, deployments, destructive cleanup,
  remote configuration changes, or commits in this task.
- English artifacts; bash 3.2 for shell commands.

## Gates

```sh
/bin/bash -n scripts/checks/doc-code-guards.sh
/bin/bash scripts/checks/doc-code-guards.sh
```

These are documentation/workflow checks. Service and cluster tests do not apply
because runtime code is unchanged. Record failures; do not weaken guards.

## Task queue

### T01: Align the constitution, engine, agents, and templates

Update AGENTS.md, .claude/commands/manual-loop.md, both .claude/agents files,
and manual-loops-templates/README.md and both templates. Add a lightweight
GitHub workflow running the existing KISS guard on pull requests and pushes.
Use a pinned checkout action, read-only permissions, and no secrets or deploy.

Deliver the constitution with every agent task, resolve rule precedence,
require explicit scope and verification evidence, require reviewers no weaker
than implementers, preserve blocked work instead of automatic deletion, and
invalidate reviews whenever reviewed files change. Require pinned runtime and
frozen lockfile installation evidence for affected build changes. Require
boundary/invariant tests for affected persistent writes and migrations.
Avoid a new framework or redundant numbered guard catalogue.

**Accept:** The Gates above succeed, two independent reviewers approve the
task changes, and Progress records actual evidence and outstanding exceptions.
CI installation is distinct from remotely required branch-protection status;
do not claim merge enforcement unless remote settings were verified.

## Progress

- [x] T01: Align the engineering contract and record verification evidence.

Execution notes (2026-09-05):

- This governance update is being applied to the existing collaborative
  workspace, not run through the engine's clean-checkout/commit cycle. Prior
  modifications are preserved. The implementer and two independent reviewers
  are used for this task; their actual results will be recorded below.
- No Engram connector is exposed in this session. This SPEC is the persistent
  decision record; no successful memory save is claimed.
- CI workflow creation does not enable a remote required check. Remote branch
  protection is unverified, so bypass prevention is not certified.

Verification and review (2026-09-05, final state after Retry1):

- Implementer run: `01a071da-b8c1-7672-86da-9d0f68bbb114`.
- `/bin/bash -n scripts/checks/doc-code-guards.sh`: exit 0, both attempts.
- `/bin/bash scripts/checks/doc-code-guards.sh`: exit 0, both attempts;
  `KISS doc/code guards passed.` The DI check scanned zero modified files;
  this supplies no service-wide DI assurance.
- `yq eval '.' .github/workflows/engineering-guards.yml >/dev/null`: exit 0
  after Retry1. Parent YAML parsing also passed.
- Parent parsed both workflow run blocks and checked them with `/bin/bash -n`:
  exit 0, `Workflow shell syntax passed (2 run blocks)`.
- Verification helper retry: the first Ruby helper used `filter_map`, which
  the installed Ruby does not support (exit 1). Replaced it with `map` plus
  `compact`; the helper then passed. No repository change was needed.
- Review attempt 1: reviewer A approved; reviewer B rejected missing `fd` in
  the CI environment. Retry1 changed only the workflow to install missing
  `ripgrep`/`fd-find` and expose `fdfind` as `fd` through a job-local PATH.
- Reviewer A: `01a071df-4f6e-76c1-b156-caeba81b5a8b`, refreshed APPROVED.
- Reviewer B: `01a071df-4fcb-7850-a040-24f6aae6c032`, refreshed APPROVED.
- All three agents inherited the parent model; no weaker-model override was
  used. Reviews assessed the current contract and supplied verification
  evidence. No isolated baseline diff was supplied, so change ownership and
  full diff coverage are not certified. This is a documented exception to
  the normal loop, not permission for subsequent tasks to omit diff review.
- Remote dependency installation and GitHub Actions execution were not run.
  Runtime, migration, and cluster tests were not run: no runtime code changed.
  No commit, push, deploy, or remote settings change was performed.

Reviewed artifact identities (SHA256, supplied by implementer after Retry1):

```text
350910aa5727a6982581f5551a9c83ae4946e77ae6c7c3641eb9a60a60dad090  AGENTS.md
e9314246f35427cb1862f83b6490aa229a16dd3856effe66520bff698b1815b0  .claude/commands/manual-loop.md
76055c7d12fc20967ab31ccae58e20eb37f0e3ded99f89361c8c605f3584dd0e  .claude/agents/implementer.md
cf7b133068c140a414b7566e38d696e896c22659843b5ca80ffb651005f92414  .claude/agents/reviewer.md
86cd1c5a41905ee43476637276eba6c395a288f4f2382ca4e2fee299b5b8ca50  manual-loops-templates/README.md
9f268aa3b27598fd34adebd4c136694e40d810d3954d65c1d8e0fbc63eba258d  manual-loops-templates/spec-simple-template.md
bd1ba190408c77d6f537c3e3a6b7fb48f6d0986fd5228a0acf7e3c8129aaa159  manual-loops-templates/spec-canonical-template.md
bd7c59dde16e26982370ff621b7f7bb2a6a24d125c653e0abc023065495b926f  .github/workflows/engineering-guards.yml
```

## Out of scope

Repository-wide runtime migration, byte-identical build certification, remote
branch protection changes, and retroactive certification of existing code.

## Human boundaries

The user authorized this scheme and confirmed fp-architecture v2.0 in the
conversation. New libraries, service migrations, production actions, and
destructive operations remain separate decisions.
