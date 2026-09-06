# Tool configuration and documentation standardization

Origin: user approved the proposed directory/document consolidation and requested global tool inheritance with local tuning, 2026-09-06.
Engram topic: `architecture/tool-docs-standardization`.

## Goal

One repository contract and one tool-neutral manual-loop procedure. Native tool
files contain only intentional project adjustments; personal configuration stays
in ai-setup. Remove the repository's Superpowers plugin declaration.

## User decisions and boundaries

The latest user message authorizes this work; no duplicate approval is required.
Global tool/profile configuration is the default. Project-specific tuning is
explicit. Preserve both oc-own and oc-ywai and all personal/global files. No
service changes, dependencies, cluster calls, deployment, or commit. Preserve
the dirty baseline captured in `/tmp/tool-docs-standardization/baseline`.

## Constraints

Full AGENTS.md applies. The principal coordinates and writes this SPEC/evidence;
implementation is delegated. Preserve all gate, review, context and rejection
requirements while relocating contracts. Shared documentation does not pin tool
models or depend on personal filesystem paths. Missing named roles or model
provenance must remain visible; automatic discovery is never inferred from text
mentions. Reviewers must be no weaker than implementers. Historical records stay
intact; compatibility pointers preserve existing entry links. English artifacts.

## Gates

Run from repository root, in order:

```sh
/bin/bash scripts/checks/doc-code-guards.sh
python3 scripts/checks/check-fp-delivery.py
python3 -m unittest discover -s scripts/tests -p 'test_fp_delivery.py'
```

Additionally inspect changed-document local links, parse native configuration,
and compare all changed files against the captured baseline. Record output and
exit statuses, real model provenance, and two independent unchanged-state
reviews. No service build or integration gate applies to this configuration/docs
scope. Static checks do not prove live global profile/plugin loading.

## Task queue

### T01: Consolidate contracts and inherit tool configuration

Allowed paths: AGENTS.md; CLAUDE.md; README.md; opencode.json; .claude/settings.json;
.claude/agents/*.md; .claude/commands/{manual-loop,build-console}.md;
.codex/config.toml; .codex/agents/fp-*.toml;
DOCS/README.md; DOCS/guides/{manual-loop,agent-roles,LOOP-PLAYBOOK,manual-loop-fp-delivery}.md;
DOCS/v_next/manual-loop-fp-delivery.md; DOCS/archive/INDEX.md;
DOCS/archive/documentation-index-2026-09-06.md (dated snapshot preserving unique
content from the old mixed index before replacing it with navigation);
DOCS/archive/fp-delivery-proposal-2026-09-05.md (full previously untracked proposal,
preserved before replacing its original path with a compatibility pointer);
manual-loops/README.md; PENDIENTES/README.md; manual-loops-templates/*.md;
scripts/checks/check-fp-delivery.py; scripts/tests/test_fp_delivery.py;
this SPEC (principal only). Any necessary relocation outside these paths must
be reported before editing.

Accept:
- Common engine and role contracts live under DOCS/guides and retain existing
  gates, integration examples, QA phases, retry limits and rejection rules.
- Native adapters reference those sources without duplicating role contracts.
- Project configuration inherits global choices unless deliberately tuned; no
  repository Superpowers declaration, copied global agents, or forced model.
- Claude explicitly imports AGENTS.md. Global profiles are not edited.
- Navigation is concise; templates author SPECs rather than repeat the engine;
  each feature retains one executable SPEC and history remains available.
- Existing test coverage is retained or equivalently adapted to the explicitly
  superseded fixed-model policy, with new inheritance regression cases.

## Progress

- [x] T01 implementation, installation, QA, gates and dual review.
- Baseline captured before edits (30 relevant files plus initial git status).
- QA acceptance planning delegated before implementation. The user subsequently
  confirmed: inherit global configuration and keep local files minimal.
- Documentation consolidation uses the inherited principal model for preserving
  contract semantics; QA planning requests Luna medium. Actual provenance will
  be recorded independently of requested values.
- Initially pending confirmation, the stated and now confirmed interpretation is minimal
  local configuration without copied native agents. Preserve the existing Claude
  repository lint/test hook and worktree setting as intentional local tuning;
  remove forced models, local role copies and Superpowers. Canonical role packets
  preserve behavior when the selected global profile has no matching named role.
- QA acceptance plan: accept omitted local models/roles and structurally valid
  explicit overrides; reject malformed settings, automatic fallbacks, invalid
  role identity, reviewer write escalation, and unrelated copied host settings.
  Preserve the delivery sequence and actual provenance requirements. Fixed-model
  tests encode superseded policy and must be adapted to equivalent structural
  and runtime-evidence protections, not removed to conceal a failure.
- Observed execution provenance: documentation implementer
  `01a07889-5f05-7690-a6c7-ef74ac81b797`, `gpt-6-astra` medium; native configuration
  implementer `01a0788a-fe06-7e32-9f93-f52d24f8dc01`, `gpt-5.6-luna` high;
  QA planner `01a07889-95a5-7922-8562-68f087b36caf`, `gpt-5.6-luna` medium.
  Rollout turn_context records indexed in
  `/tmp/tool-docs-standardization/model-provenance.json` confirm these values.
- Documentation checks observed: 10 changed-document link targets checked;
  historical queue/status tables unchanged; all seven reviewer automatic
  rejection rules preserved; original index body preserved in the dated snapshot
  except relative-link relocation. Implementer KISS gate exit 0; combined final
  gates remain pending. Global/profile baseline covers 213 files for final
  unchanged-state comparison.
- Pre-review correction: the first checker draft incorrectly prohibited future
  project model tuning and embedded a fixed model catalog. It also treated native
  role files as fieldwise global-role merges. These assumptions were rejected
  before gate acceptance: optional tuning must remain possible; native role files
  require complete structural instructions; model support needs runtime evidence.
- Scope-record correction: the root README navigation update was delegated as
  part of the approved index consolidation, but omitted from the initial allowed
  path enumeration. It is now explicitly listed; the edit only redirects the
  existing engine link to the neutral procedure. This was a SPEC recording error,
  not separate authorization for broader root README edits.
- QA pass 1 executed 11 unit tests and the staged checker, both exit 0, but found
  missing negative Superpowers/malformed-config tests and missing positive
  Claude/OpenCode local-tuning tests. Added coverage was requested before review;
  a green suite alone did not establish acceptance. The QA packet also required
  missing native-role structural-field cases and opaque model fixtures.
- One evidence-only patch failed to match its expected SPEC text; no file changed
  in that attempt. The exact existing text was used on retry.
- Final preparation gates: KISS exit 0 (four preexisting git-modified source files
  scanned); staged routing exit 0; 16 regression tests exit 0; documentation/global
  comparison exit 0 (240 links, 213 unchanged global/profile files). Actual command
  arrays and logs are in `/tmp/tool-docs-standardization/gate-statuses.json`.
- The candidate contains 31 changed paths against the captured baseline. Protected
  Codex changes remain staged pending reviewed installation; the dry-run installer
  verified all five original target hashes and candidate contents before any write.
  Candidate manifest SHA-256:
  `57d2f382744e9cdecdf977b8c03292062f777c61bd9c43683dd16a491160de63`.
- A requested final QA follow-up hit the agent-thread limit. No additional QA run
  was claimed; the principal inspected the added acceptance cases, and both
  independent reviewers received the final tests and recorded QA gaps for review.
- Review attempt 1: A (`01a07899-9df2-7fd0-b848-7cba417f77c9`) and B
  (`01a07899-e91e-7160-923d-78694caa51eb`), both observed `gpt-6-astra` high,
  independently REJECTED. Both found the untracked proposal's false version-history
  claim. A also required post-correction QA and the change-register row; B found
  the omitted explicit restriction on new ports/adapters/domain layers. Both
  verified candidate hashes and used read/text comparison with codegraph unavailable.
  Corrections were assigned to the documentation implementer; no protected
  installation occurred. QA, gates and both reviews must run again afterward.
- Attempt 2 corrections preserve the full proposal in the dated archive, restore
  the explicit architecture-layer restriction, and append the change register.
  The author verified exact proposal-body preservation and corrected links.
  A second QA follow-up also hit the thread limit; an available pending QA slot
  was interrupted and reissued the complete final QA packet as `/root/qa_plan`.
  No final QA pass is inferred from that dispatch; its result is required.
- Post-correction link/global check: exit 0, 11 documents, 246 local link targets,
  and 213 unchanged global/profile hashes. The candidate now contains 33 paths;
  refreshed manifest SHA-256:
  `610592c6b58ea50f841bbb81c9f1859deb00b9dff11888c0320188402f53359a`.
- Final QA ACCEPTED coverage, including the previously missing regression cases
  and all documentation corrections. QA run `01a07364-af6b-7c02-8a64-516658010753`
  resumed under the complete current task packet; its observed `gpt-5.6-luna`
  medium provenance is indexed with the current task evidence. It executed the
  16-test discovery suite and staged checker, both exit 0 (`qa-final-*.log`).
- After final QA, KISS, staged routing, 16 tests, documentation/global checks,
  and protected installer dry-run all returned exit 0, in the recorded order.
  Commands/statuses: `/tmp/tool-docs-standardization/attempt2-gate-statuses.json`.
  Both independent reviewers received the unchanged full candidate and this
  evidence for attempt 2. The final default-path gate awaits protected installation.

### Completion — 2026-09-06

- Both reviewers independently APPROVED attempt 2, covering all 33 manifest
  paths, corrected historical preservation, final QA evidence and renewed gates:
  A `01a07899-9df2-7fd0-b848-7cba417f77c9` and
  B `01a07899-e91e-7160-923d-78694caa51eb`, both observed Astra/high.
- Human-approved filesystem escalation applied the five protected Codex changes
  after full original-target and candidate-hash preflight: comment-only config,
  four local role definitions removed. All 33 installed paths match the reviewed
  manifest; no reviewed contract or implementation changed after approval.
- Final gates executed verbatim from the repository root on installed files:

| Command | Exit | Observed result |
| --- | --- | --- |
| `/bin/bash scripts/checks/doc-code-guards.sh` | 0 | KISS passed; DI guard scanned four preexisting git-modified source files. |
| `python3 scripts/checks/check-fp-delivery.py` | 0 | Installed default-path configuration and shared contract validated. |
| `python3 -m unittest discover -s scripts/tests -p 'test_fp_delivery.py'` | 0 | 16 tests, OK. |

- Additional installed check: 11 documents, 246 local link targets and 213
  unchanged global/profile hashes, exit 0. Evidence is indexed under
  `/tmp/tool-docs-standardization/installed-gate-statuses.json` and
  `installed-hashes.json`; this durable summary retains results if temporary
  detailed logs expire. Python 3.14.5 was used; no dependencies were installed.
- Global Codex/Claude and personal oc-own/oc-ywai files remain unchanged.
  Repository settings retain only intentional local hooks/worktree tuning and
  common-procedure entry points. No live profile/provider loading is certified
  by these static checks. There were no service changes, builds, cluster calls,
  deployments or commits. Engram was not used; this SPEC, shared documentation,
  snapshots and register preserve the decision and evidence.
