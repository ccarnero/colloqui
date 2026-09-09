# SPEC — Economical manual-loop gate execution

> Status: SUPERSEDED — T01 was not executed; the configured, human-approved Luna exception governs.
> Origin: Chris explicitly requested persisting economical build/E2E delegation in this project's manual-loop SPECs on 2026-09-07.
> Engram topic: `platform-cluster/economical-gate-execution`.

## Goal

Routine script execution uses a configured mechanical executor cheaper than both
Sol and Luna, with availability and cost eligibility checked before launch. The principal
coordinates and decides, receiving concise results backed by complete evidence.
Existing and future SPECs inherit the rule without rewriting historical records.

## User decisions

- Delegate builds, tests and E2E to an economical agent instead of consuming
  principal context on routine commands and verbose logs. The script role must
  cost less than both Sol and Luna; Sol implementation/QA and Astra judgment remain
  separate. Do not pin or alter global provider/model choices. A script executor
  only reports command output, exit status and evidence; it does not diagnose,
  fix code or decide retries.
- Preserve existing gate commands, order, acceptance, retry budgets, permissions,
  cleanup boundaries and independent review requirements.
- No global configuration edits, runtime changes, commits or historical rewrites.

## Constraints

- AGENTS.md is normative. Principal authors this SPEC/evidence, fp-dev edits docs,
  fp-qa supplies acceptance and validation, two independent Astra reviewers judge
  the same final state. The user's explicit request approves this bounded scope.
- Allowed implementation paths: `AGENTS.md`, `DOCS/guides/manual-loop.md`,
  `DOCS/guides/agent-roles.md`, `manual-loops-templates/README.md`,
  `manual-loops-templates/spec-simple-template.md`,
  `manual-loops-templates/spec-canonical-template.md`.
- Principal may edit this SPEC and its sibling `economical-gate-execution/`
  evidence directory. Do not edit evaluation code, historical SPECs, the preexisting
  loop-index change, global/tool profiles, libraries or product source.
- The economical executor runs exact supplied gates sequentially, stops on first
  failure, preserves full sanitized output/status/duration/state/model provenance,
  and returns a concise summary with evidence paths. It owns no independent retry,
  scope expansion, gate weakening or task closure. Principal owns those decisions.
- Transfer monitoring of an in-flight command using its process/run identity;
  never duplicate a build, E2E invocation or mutating gate during handoff.
- Check configured script-model availability and the user's explicit cost ceiling
  before launch. If no eligible model is available, report the script-executor
  prerequisite as blocked. No automatic fallback to Sol, Luna or Astra; exceeding
  the cost ceiling requires a separate human decision. A documented principal
  fallback cannot override that ceiling. Missing runtime permissions remain
  prerequisites, never a reason to skip gates or misdiagnose a stopped runtime.
- Keep existing frameworks and all verification/approval rules. No new runtime
  tests for prose; run repository guards, whitespace and targeted contract checks.

## Gates

Docs QA validates this change from repository root with `/bin/bash -o pipefail`
as part of its substantive contract review. This does not authorize a Sol build
or E2E script-executor role; that role remains pending eligible-model availability.

```bash
./scripts/checks/doc-code-guards.sh
git diff --check
python3 - <<'PY'
from pathlib import Path
paths = ['AGENTS.md', 'DOCS/guides/manual-loop.md', 'DOCS/guides/agent-roles.md', 'manual-loops-templates/README.md', 'manual-loops-templates/spec-simple-template.md', 'manual-loops-templates/spec-canonical-template.md']
for path in paths:
    text = Path(path).read_text()
    assert 'economical' in text.lower(), path
    assert 'gate' in text.lower(), path
print('Economical gate delegation documented on all six contract/template surfaces')
PY
```

## Task queue

### T01 — Persist economical gate execution in shared contracts and SPEC templates

- Allowed paths and non-goals are exactly Constraints above.
- Read full AGENTS.md, shared roles/manual-loop procedure and both templates.
- Make gate delegation the default in the constitution, execution procedure and
  role contracts; templates include the rule in forwarded Constraints and identify
  gate executor policy and required evidence. The README explains inherited
  applicability to existing/resumed SPECs and new authoring.
- Keep one coordinator, exact gate semantics and strong independent reviews.
- Acceptance: all gates pass; QA confirms delegation, evidence, handoff and fallback
  requirements without weaker verification or a new provider lock-in; two
  independent reviewers APPROVED for identical final content.

## Progress

- Achieved: economical executor policy proposal captured.
- Remaining: none; the proposal was superseded by the configured, human-approved Luna exception.
- Blocked: no closure is claimed for this draft.
- Attempts: T01 0/4.
- Validation: draft gates and reviews were not run.
- Evidence: detailed draft packet retired by Chris on 2026-09-09; see economical-gate-execution/SUMMARY.md.
