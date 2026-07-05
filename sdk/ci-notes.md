# SDK CI Notes (Proposal)

Status: **proposal, not wired**. This file documents the CI jobs the SDK
should get once the org's CI is actually turned on for this repo. No
pipeline file is created by this change — see "Why no pipeline file yet"
below for the evidence.

## Why there's no pipeline file yet

This repo has no live/wired CI pipeline anywhere, for any service, as of
this writing. Confirmed by direct inspection:

- `find .github -type f` → only `.github/prompts/*.md` (SDD tooling
  prompts for Copilot/agents), no `.github/workflows/*.yml`.
- `fd -i 'azure-pipelines' .` (repo-wide) → the only matches are
  `skills/devops/assets/azure-pipelines.yml` and
  `skills/devops/assets/azure-pipelines-dev.yml`. These are **scaffolding
  template assets** bundled with the `skills/devops` Claude Code skill
  (used to *generate* pipelines for other projects on request) — they
  contain placeholder values (`your-product-name`,
  `your-acr-service-connection`, `yourregistry.azurecr.io`, generic
  `api1`/`api2`/`api3` matrix entries) and are not referenced by any Azure
  DevOps project pointed at this repo.
- No `azure-pipelines.yml` at the repo root, no `.azure-pipelines`
  directory, no `devops/` directory at the repo root (only
  `skills/devops`, which is skill infrastructure, not project infra).
- `fd -d 1 -t f '^(Makefile|package\.json)$' .` → only a root
  `package.json`. It is a bare devDependency holder
  (`@playwright/test`, `reflect-metadata`, `tsx`, `typescript`) with no
  `scripts` block at all — no root-level `test`/`ci`/`build` convention
  to extend.
- No `services/*/azure-pipelines*.yml` and no `services/*/.github`
  anywhere under `services/`.
- No `lefthook` config found in the repo despite being mentioned in
  `.claude/CLAUDE.md` — that reference describes an intended workflow,
  not something currently wired.
- Per-service `package.json` scripts (checked `services/workflow-service`)
  show a de facto *local* test convention (`bun test`, `test:unit`,
  `test:integration`) but this is invoked manually/locally — nothing runs
  it in CI, since there is no CI.

Conclusion: there is no existing CI convention anywhere in this repo to
extend. Per the SDK growth plan's own fallback instruction, this document
proposes the SDK's CI jobs instead of inventing a pipeline file with
nothing real behind it. The stage/job naming and structure below mirror
`skills/devops/assets/azure-pipelines.yml` / `azure-pipelines-dev.yml` so
that if/when this org wires up real CI, the SDK stage slots in with the
same conventions already established for other services.

## Proposed jobs for `sdk/`

1. **Typecheck**
   - Command: `cd sdk && npm ci && npm run build` (runs `tsc`, TS strict
     mode — the SDK has no separate `lint`/`typecheck` script; `build`
     *is* the typecheck since `tsc` emits nothing but type errors fail
     the build).
   - Trigger: every PR touching `sdk/**`.

2. **Unit tests**
   - Command: `cd sdk && npm ci && npm test` (`tsx --test 'test/**/*.test.ts'`,
     276 tests as of Phase 2). Fully offline — no cluster, no network
     dependency, safe to run on every PR.
   - Trigger: every PR touching `sdk/**`.

3. **E2E tests** (env-gated, NOT on every PR)
   - Command: `cd sdk && SDK_E2E=1 npm run test:e2e`
     (`tsx --test --test-concurrency=1 'test/e2e/**/*.e2e.ts'`, 53 tests).
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

The following is illustrative only, styled after the stage/job/pool
conventions in `skills/devops/assets/azure-pipelines.yml` and
`azure-pipelines-dev.yml`. It is **not** created as an actual
`azure-pipelines.yml` anywhere in this repo — this fenced block is the
entire extent of it.

```yaml
# PROPOSAL — illustrative only, not a live pipeline file.
# Mirrors the stage/job naming conventions used in
# skills/devops/assets/azure-pipelines.yml for consistency if/when
# real CI is wired up for this repo.

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
          - script: |
              cd sdk
              npm ci
              npm test
            displayName: 'npm test (276 tests, offline)'

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
            displayName: 'SDK_E2E=1 npm run test:e2e (53 tests)'
            env:
              SDK_E2E_TENANT_CREDENTIALS: $(SdkE2ETenantCredentials) # pipeline secret

  # SdkPublish stage intentionally omitted: sdk/package.json has
  # "private": true and no registry/publish flow is wired yet. See
  # sdk/CHANGELOG.md for the intended future flow.
```
