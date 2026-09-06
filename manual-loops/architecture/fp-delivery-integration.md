# FP delivery integration

Origin: user authorized implementing all changes in the reviewed delivery proposal, 2026-09-05.
Engram topic: `architecture/fp-delivery-integration`.

## Goal

One principal coordinates manual-loop, with economical FP development/QA,
independent capable reviewers, explicit gates, and persistent evidence. Align
repository contracts and personal OpenCode roles; configure project Codex roles.

## Approval and boundaries

The user's instruction "implementa TODOS estos cambios" approves implementing
the previously delivered proposal; this SPEC records that scope without asking
for duplicate approval. External/protected filesystem writes still need sandbox
approval. No service behavior changes, installs, cluster calls, commits, or changes
to the ywai vendor profile. Preserve preexisting changes in both repositories.
Model policy selected for the requested cost split: gpt-5.6-luna medium for dev/QA;
gpt-6-astra high for reviewers/architecture and medium for the principal.
These explicit choices supersede the all-opus default for this integration.

## Constraints

Full AGENTS.md applies. One task in flight; preparatory independent reads/staging
may run in parallel. Principal edits SPEC/evidence only, delegates implementation.
Tests and unchanged-state dual review required. Preserve existing rejection rules,
test guarantees, gate requirements, independent reviews and model provenance.
No fabricated runtime identity: requested model and observed model are separate.
Personal instructions cannot override repository rules. Keep framework/library
choices; no I/O callbacks in calculations. No provider fallback without reporting.

## Gates

Run from platform-cluster root:

```sh
/bin/bash scripts/checks/doc-code-guards.sh
python3 scripts/checks/check-fp-delivery.py
python3 -m unittest discover -s scripts/tests -p 'test_fp_delivery.py'
```

Personal installation verification: `/bin/bash /Users/chris/sources/personal/ai-setup/bin/oc-doctor`.
Inspect OpenCode resolved agents and Codex config parsing when supported. Record
actual results, version, unavailable provider/model execution. No application
build/cluster gates apply to this configuration-only change; this does not waive
them for subsequent feature tasks. Before closure, two independent reviewers see
combined diffs, complete new files, gate logs and state hashes.

## Task queue

### T01: Integrate the delivery contract and role routing

Allowed repository paths:
- AGENTS.md; .claude/commands/manual-loop.md; .claude/agents/{implementer,reviewer,fp-dev,fp-reviewer,fp-qa,fp-architect}.md.
- .codex/config.toml; .codex/agents/fp-{dev,qa,reviewer,architect}.toml.
- manual-loops-templates/{README,spec-simple-template,spec-canonical-template}.md.
- DOCS/guides/{manual-loop-fp-delivery,LOOP-PLAYBOOK}.md; DOCS/v_next/manual-loop-fp-delivery.md.
- DOCS/README.md; DOCS/archive/INDEX.md; manual-loops/README.md.
- scripts/checks/check-fp-delivery.py; scripts/tests/test_fp_delivery.py.
- This SPEC (principal only).

Allowed personal paths (stage first, install after required filesystem approval):
- ai-setup/mine/agents/fp-*.md and mine/agents/fallbacks/fp-*-opencode.md.
- ai-setup/mine/commands/fp-loop*.md; mine/skills/fp-architecture/SKILL.md.
- ai-setup/README.md and GUIA-JR.md (targeted delivery navigation/role corrections;
  preserve preexisting language outside the updated sections).

Accept:
- Single principal; manual-loop owns retries/closure when present. QA acceptance
  input before implementation; developer owns regression tests; QA finishes edits
  before final gates; all corrections revalidate before two independent reviews.
- Explicit model routing, no silent expensive inheritance, capable reviewers and
  no automatic provider fallback with unknown model support. Preserve profile purity.
- Principal can persist authorized Markdown evidence without permission to modify
  production code; optional architect; strict pending-vs-complete distinction.
- Codex role files use supported TOML format, not Claude/OpenCode YAML semantics.
  Document current-session explicit spawn fallback when named roles are unavailable.
- Checker validates role models, references and critical integration invariants;
  regression tests demonstrate rejection of incorrect model/routing configurations.
- Guide reflects configured state and honestly reports unverified live execution.

## Progress

- [x] T01 implementation, installation, gates and dual review; Codex automatic
  named-role discovery remains explicitly unverified below.
- Baseline: `/tmp/fp-delivery-integration/baseline` and `ai-baseline`; platform
  worktree has preexisting staged/unstaged/untracked work; ai-setup status was clean.
- Existing proposal is approved input, not a new pending design decision.
- Preparation used explicit-role Codex spawns (the current tool has no named-role
  parameter): repo implementer `01a07363-3f93-7ff3-a7fb-4c69c9b36c3c` and config
  preparer `01a07363-94ef-7a21-af2d-45a963e0afd9`, both `gpt-5.6-luna`, high effort
  for this cross-tool integration. QA planning `01a07364-af6b-7c02-8a64-516658010753`
  used `gpt-5.6-luna`, medium. Their rollout `turn_context` records confirm the
  model/effort; `/tmp/fp-delivery-integration/model-provenance.json` indexes them.
  Principal rollout confirms `gpt-6-astra`, medium. Future role defaults remain
  the medium/high split above; this task's high-effort implementers are explicit.
- Preparation checks: KISS exit 0 (four preexisting modified source files scanned),
  staged routing checker exit 0, regression suite exit 0 (12 tests). Python 3.14.5,
  Codex CLI 0.153.1, OpenCode 1.18.20. Staged checker used the documented
  `--codex-dir /tmp/fp-delivery-integration/codex-staged` option. Final default-path
  gate awaits protected installation; absence is not treated as approval.
- Pre-review corrections: removed a mistakenly staged global Codex config copy,
  tightened coordinator writes, blocked standalone routing when an engine lacks
  an approved SPEC, restored guide gates/examples, and added role sandbox checks.
  None of the incorrect external staging files were installed. Config preparer
  was interrupted and resumed once to prioritize those corrections. Checks were
  repeated after changes; no production tests were altered. The QA planning agent
  sent one checklist through a task-message tool instead of team messaging; it
  was instructed to use team messaging thereafter. No duplicate task was created.
- Preparation evidence: `combined.diff`, `review-state.json`, `gate-statuses.json`
  and logs under `/tmp/fp-delivery-integration`. Existing unrelated whitespace
  diagnostics were reported by implementer and left unchanged. CLI help/version
  printed sandbox PATH-alias warnings; no inference of config loading from help.
- Review attempt 1: reviewer A (`01a07374-291a-7132-b125-9d9b34f6edd9`, observed
  `gpt-6-astra` high) REJECTED the unchanged 37-file candidate: the engine still
  launched the legacy Opus implementer despite the economical FP policy; personal
  README staging removed three unrelated backup passages. Reviewer A reran staged
  routing and 12 regression tests successfully and checked unchanged hashes.
  No external installation occurred. Corrections require new gates and both reviews.
- Reviewer B (`01a07374-6b81-7343-8045-5e3649364b84`, observed `gpt-6-astra`
  high) independently REJECTED attempt 1 for the same two defects and newly
  introduced Spanish descriptions in the personal guide. These descriptions were
  replaced by an English integration addition while preserving baseline text.
- Attempt 2 corrected initial and correction routing to `fp-dev`, changed the
  legacy Claude implementer to Sonnet, bound FP aliases to canonical role
  contracts, restored all unrelated personal README content, and added routing
  regression cases. Both reviewers independently APPROVED all 38 final changed
  files. A reran routing, 14 tests and installer dry run; B assessed supplied gates
  and independently verified the installer manifest. Both used textual inspection
  instead of codegraph and verified observed Luna/Astra rollout provenance.
  One implementer exploratory search had shell backtick quoting wrong and printed
  `fp-dev: command not found`; no files changed and the search was corrected.
- Approved reviewed-state manifest SHA-256:
  `cb60f57dfa28c7b299257ff2d0b878a4f537890801d74003919a04c7919ad043`.
  Combined patch SHA-256:
  `0eb3d065b2b48f44d63f3236effdfebc57db1c08a34aebdf478645add38c738b`.

### Installation and final verification — 2026-09-06

- Human-approved sandbox escalation installed the 20 reviewed protected/personal
  files after complete baseline and staged-hash preflight. All installed hashes
  match; all 38 reviewed source hashes remain unchanged. The global user Codex
  config and ywai vendor tree were not edited. Installer SHA-256:
  `df31f8e77c6389df8d2119a0bb63ac9c72b9297e562a9208351c598230372ee3`.
- Final gates executed from repository root in SPEC order:

| Command | Exit | Actual result |
| --- | --- | --- |
| `/bin/bash scripts/checks/doc-code-guards.sh` | 0 | KISS passed; DI guard clean, four preexisting modified source files scanned. |
| `python3 scripts/checks/check-fp-delivery.py` | 0 | Installed project `.codex` routing and integration validated. |
| `python3 -m unittest discover -s scripts/tests -p 'test_fp_delivery.py'` | 0 | 14 tests, OK. |
| `/bin/bash /Users/chris/sources/personal/ai-setup/bin/oc-doctor` | 0 | All profile/link/overlay checks passed; no FP files in ywai. |

- `opencode debug agent <role>` with the own profile's XDG directory and Claude
  compatibility discovery disabled returned exit 0 for all five roles:
  `fp-orchestrator` primary with `openai/gpt-6-astra`; `fp-dev` and `fp-qa`
  subagents with `openai/gpt-5.6-luna`; `fp-reviewer` and `fp-architect`
  subagents with `openai/gpt-6-astra`.
- `codex debug prompt-input` returned exit 0. Its role-name matches came from
  AGENTS.md/skill text, so they do NOT establish named-role discovery. Both
  reviewers caught this false-positive evidence claim during closure; it was
  corrected before completion. The installed CLI's generated experimental
  protocol exposes no dedicated agent-list endpoint. Automatic Codex named-role
  discovery remains unverified; the explicit-role/model spawn fallback was
  actually used and its execution provenance is recorded above. The native TOML
  files are installed and statically validated, not certified as discovered.
- OpenCode role resolution establishes configuration loading, not a generation
  run, provider quota/availability, fallback-provider support, or an application
  feature's cluster integration. No such execution is claimed.
- Final outputs: `/tmp/fp-delivery-integration/final-gate-statuses.json`,
  `final-*.log`, `opencode-resolution.json`, `opencode-fp-*.log`,
  `codex-resolution.json`, and `codex-loading.log`. Temporary detailed artifacts
  supplement this durable summary; they are not CI artifacts. No service build,
  cluster change, deployment or commit was performed. Engram was not used; the
  SPEC and current guide persist the decision and evidence.
- Final closure: reviewer A (`01a07374-291a-7132-b125-9d9b34f6edd9`) and
  reviewer B (`01a07374-6b81-7343-8045-5e3649364b84`), both observed
  `gpt-6-astra` high, independently APPROVED the installed state and corrected
  evidence with the Codex discovery limitation documented. Both reconfirmed
  unchanged reviewed/installed hashes. Only evidence-only Progress and temporary
  evidence summaries changed after the final gates; no implementation or contract
  changed. The explicit-spawn fallback remains the verified Codex execution path
  for this session.
