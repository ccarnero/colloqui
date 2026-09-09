# SPEC — Compact operational loop records

> Status: Cleanup applied; guards passed; formal closure blocked by unavailable provenance.
> Engram topic: `platform-cluster/compact-loop-records`.

## Goal

Keep achieved, remaining and blocked work visible without loading historical
execution files into agent context. Chris authorized direct cleanup of this test
environment, including untracked evidence deletion, without another approval.

## Constraints

- Allowed paths: AGENTS.md, DOCS/guides/manual-loop.md,
  DOCS/guides/agent-roles.md, manual-loops-templates/*.md,
  manual-loops/README.md, DOCS/archive/INDEX.md (retired evidence links only),
  and architecture loop records/evidence only.
- Preserve application code, tests, fixtures outside loop evidence, protected
  .codex configuration, existing budgets and actual validation outcomes.
- Detailed gate/review evidence is temporary during validation. Retain compact
  outcomes after closure/blocking; never fabricate missing approval or reset budgets.
- The cleanup supersedes historical evidence-retention instructions for these
  test records. Historical full SPEC contracts remain available when needed;
  summaries are the default entry point and execution contracts are read before work.
- Do not commit, push, build or execute product/runtime tests.

## Gates

```bash
git diff --check
./scripts/checks/doc-code-guards.sh
```

## Task queue

### T01 — Change retention policy and compact existing records

Acceptance: shared rules agree on temporary evidence and summary-first context;
each cleaned loop has a concise status summary; no product/config files change;
deleted evidence is explicitly marked retired rather than still available;
applicable gates pass and two independent reviews approve the final changes.

## Progress

- Achieved: 737 execution files (19,267,637 bytes; 415 tracked and 322
  untracked) and six dangling symlinks retired from eight evidence roots and replaced by
  compact summaries. Shared retention/context policy updated. Untracked evidence
  has no Git recovery guarantee; Chris explicitly authorized its deletion.
- Remaining: no cleanup implementation work; formal approval remains unavailable.
- Blocked: both independent reviewers rejected formal closure solely because the
  collaboration tool does not expose observed model/turn provenance. Both found
  no remaining substantive content defects. No approval or runtime budget is inferred.
- Attempts: T01 4/4 exhausted; no automatic retry.
- Validation: final `git diff --check` and `./scripts/checks/doc-code-guards.sh`
  exited 0 (KISS guards passed); reviewed hashes unchanged and 3,358 baseline
  paths checked with no unexpected changes. No product tests/builds apply.
