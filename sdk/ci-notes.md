# SDK CI Notes (Proposal)

Status: **proposal, not wired**. This file documents the CI jobs the SDK
should get once the org's CI is actually turned on for this repo. No
pipeline file is created by this change — see "Why no pipeline file yet"
below for the evidence.

## Why there's no pipeline file yet

This repo has no live/wired CI pipeline anywhere, for any service. Confirmed
by direct inspection (re-verified 2026-08-03 — three of the original bullets
had rotted and are corrected here):

- `find .github -type f` → **zero files**. The directory still exists but is
  empty; the `.github/prompts/*.md` SDD tooling prompts this note originally
  cited are gone. No `.github/workflows/*.yml` exists (this inspection cannot
  speak to what may have existed historically — check `git log` if that
  matters).
- `fd -H -i 'azure-pipelines' .` (repo-wide) → **no matches at all**. The
  `skills/devops/assets/azure-pipelines.yml` / `azure-pipelines-dev.yml`
  template assets this note used to cite no longer exist — there is no
  `skills/devops` skill any more (`ls skills` → `_shared`, `angular`,
  `envelope-messages`, `git-commit`, `judgment-day`, `multi-tenant`,
  `playwright`, `skill-registry`, `yz-ui`). So the repo now contains not even
  a *template* pipeline to imitate.
- No `azure-pipelines.yml` at the repo root, no `.azure-pipelines`
  directory, no `devops/` directory anywhere.
- The root `package.json` is a bare devDependency holder — `@playwright/test`,
  `@yoizen/database`, `@yoizen/shared`, `ioredis`, `mongodb`, `nats`,
  `postgres`, `reflect-metadata`, `tsx`, `typescript` — with no `scripts`
  block at all, so there is no root-level `test`/`ci`/`build` convention to
  extend.
- No `services/*/azure-pipelines*.yml` and no `services/*/.github`
  anywhere under `services/`.
- No `lefthook` config anywhere (`fd -H -i lefthook .` → nothing). The
  `.claude/CLAUDE.md` that used to mention it no longer exists either; the
  repo's normative doc is now the root `AGENTS.md`.
- Per-service `package.json` scripts (checked `services/workflow-service`)
  show a de facto *local* test convention (`bun test`, `test:unit`,
  `test:integration`) but this is invoked manually/locally — nothing runs
  it in CI, since there is no CI.

Conclusion (stronger than when this was written): there is no existing CI
convention anywhere in this repo to extend, and no template to mirror either.
Per the SDK growth plan's own fallback instruction, this document proposes the
SDK's CI jobs instead of inventing a pipeline file with nothing real behind
it. The stage/job naming below is plain Azure DevOps convention — the
`skills/devops` assets it was originally modelled on are gone, so treat the
shape as illustrative, not as alignment with an existing house style.

## Proposed jobs for `sdk/`

1. **Typecheck**
   - Command: `cd sdk && npm ci && npm run build` (runs `tsc`, TS strict
     mode — the SDK has no separate `lint`/`typecheck` script; `build`
     *is* the typecheck since `tsc` emits nothing but type errors fail
     the build).
   - Trigger: every PR touching `sdk/**`.

2. **Unit tests**
   - Command: `cd sdk && npm ci && npm test` (`bun test src/ test/`, 407
     tests across 52 files, verified 2026-08-06). Fully offline — no cluster,
     no network dependency, safe to run on every PR.
   - **The runner is Bun, so the job needs a Bun install step** (e.g.
     `oven-sh/setup-bun`, or `curl -fsSL https://bun.sh/install | bash` on a
     self-hosted agent) before `npm test`. `npm ci` still installs the dev
     deps that `build` and `test:e2e` need.
   - Trigger: every PR touching `sdk/**`.
   - Why not tsx: the old `tsx --test 'test/**/*.test.ts'` glob missed the 14
     co-located CLI specs under `src/cli/**/*.test.ts`, leaving the whole
     `yoizen` CLI untested by the documented command (E15) — and 10 tests
     inside two of those files (2 in `read-manifest-file.test.ts`, all 8 in
     `manifest-gaps-cli-compat.test.ts`) exercise the real `Bun.YAML`
     manifest parser, so tsx/Node cannot run them at all (whole suite under
     tsx: 397 pass / 10 fail). See sdk/README.md "Why Bun runs the unit
     suite".
   - Do not simplify the command to bare `bun test`: it also picks up
     `dist/**/*.test.js` after a build, re-running the 14 CLI files from
     stale compiled output (471 tests / 66 files on a built checkout vs
     407 / 52 on a fresh clone). If the Typecheck job above shares a
     workspace with this one, that is exactly the ordering that would hit it.

3. **E2E tests** (env-gated, NOT on every PR)
   - Command: `cd sdk && SDK_E2E=1 npm run test:e2e`
     (`tsx --test --test-concurrency=1 'test/e2e/**/*.e2e.ts'`, 9 files /
     62 `test()` cases, verified 2026-08-03).
   - Trigger: **manual or scheduled only** — explicitly not on every PR,
     because it requires a live dev cluster reachable from the runner
     (via port-forward or a directly reachable dev gateway URL), which
     hosted/ephemeral CI runners do not have by default.
   - Prerequisites to actually wire this job up:
     - A reachable gateway URL for the dev cluster (either a
       runner-to-cluster network path, or a port-forward step run as
       part of the job).
     - Tenant credentials supplied as pipeline secrets (not committed
       anywhere), matching whatever `SDK_E2E` tests expect for auth.
     - A decision on cadence (e.g. nightly schedule) if not purely
       manual, to avoid burning cluster resources on every commit.

4. **Publishing — not wired**
   - The package stays `private: true` in `sdk/package.json`. No publish
     job exists or is proposed here yet.
   - See `sdk/CHANGELOG.md` (path referenced; written by a parallel
     effort — see that file directly for its "Future: publishing" notes
     on the intended registry/publish flow) for the intended direction
     once the org is ready to drop `private: true`.

## Proposal sketch (NOT a live file)

The following is illustrative only. It is **not** created as an actual
`azure-pipelines.yml` anywhere in this repo — this fenced block is the
entire extent of it.

```yaml
# PROPOSAL — illustrative only, not a live pipeline file.
# Plain Azure DevOps stage/job conventions; there is no in-repo pipeline
# (or pipeline template) left to mirror.

trigger:
  branches:
    include:
      - main
  paths:
    include:
      - sdk/**

stages:
  - stage: SdkVerify
    displayName: 'SDK — Typecheck & Unit Tests'
    jobs:
      - job: Typecheck
        displayName: 'SDK Typecheck (tsc strict)'
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          - script: |
              cd sdk
              npm ci
              npm run build
            displayName: 'npm ci && npm run build'

      - job: UnitTests
        displayName: 'SDK Unit Tests'
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          # `npm test` is `bun test src/ test/` — Bun must be on PATH.
          - script: curl -fsSL https://bun.sh/install | bash
            displayName: 'install bun'
          - script: |
              cd sdk
              npm ci
              PATH="$HOME/.bun/bin:$PATH" npm test
            displayName: 'npm test (407 tests, offline)'

  - stage: SdkE2E
    displayName: 'SDK — E2E (manual/scheduled, needs dev cluster)'
    dependsOn: SdkVerify
    condition: eq(variables['Build.Reason'], 'Manual') # or a schedule trigger
    jobs:
      - job: E2ETests
        displayName: 'SDK E2E against dev cluster'
        pool:
          vmImage: 'ubuntu-latest'
        steps:
          # Prerequisite: port-forward or direct network path to the dev
          # gateway must be established here (self-hosted runner, VPN
          # step, or similar — hosted Microsoft-provided runners cannot
          # reach an internal dev cluster without one).
          - script: |
              cd sdk
              npm ci
              SDK_E2E=1 npm run test:e2e
            displayName: 'SDK_E2E=1 npm run test:e2e (9 files / 62 cases)'
            env:
              SDK_E2E_TENANT_CREDENTIALS: $(SdkE2ETenantCredentials) # pipeline secret

  # SdkPublish stage intentionally omitted: sdk/package.json has
  # "private": true and no registry/publish flow is wired yet. See
  # sdk/CHANGELOG.md for the intended future flow.
```
