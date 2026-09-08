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

- [x] T01 restore configuration, verify, and obtain independent dual approval.
- Baseline: `codex-manual-loop-repair/evidence/baseline-hashes.json`,
  `baseline-status.txt`, `baseline.diff`. No application work resumed.
- Prep: Codex CLI 0.153.1. Help/catalog reads printed PATH-alias sandbox warnings;
  no installation attempted. Official documentation `/en/` URLs returned 404;
  canonical unprefixed pages opened successfully. Markdown fetch was unsupported;
  HTML provided the source. These are discovery fallbacks, not gate attempts.
- QA initial launch `repair_qa_plan` accidentally omitted model and inherited
  Astra high; interrupted and replaced with explicit Sol medium `repair_qa_sol`.
  Observed ids: `01a07e30-95e3-7551-83eb-443426f50829` (interrupted),
  `01a07e30-f4c8-7db1-b3cf-0953bae3ce2d` (Sol medium).
- Current principal is observed Astra high (existing session override), not the
  future project default Astra medium. Configuration does not rewrite that fact.
- Retained earlier native roles exist in temporary installation snapshots. Current
  global auth mode is ChatGPT; no API-key credential is present in auth.json.
  Bundled/cached catalogs omit nano, which alone does not establish rejection.
- T01 implementation attempt 1 delegated to `repair_dev`, explicit Sol medium;
  no gate/test/build/E2E execution authorized for that delegate yet. Architecture
  advice used explicit Astra high `repair_architect`, read-only. Native conversation
  fallback is declared; model/turn evidence is in `bootstrap-model-provenance.json`.
- Nano callability probe: initial sandbox attempt failed before model contact
  because the in-process client could not initialize. The same harmless no-tool
  request was repeated with approved host access (no config/auth changes), exit 1,
  HTTP 400: "The 'gpt-5-nano' model is not supported when using Codex with a ChatGPT
  account." Native probe id `01a07e36-b166-7b80-99cf-e1b46c20c79f`; full command,
  stdout/stderr and duration in `nano-probe*.json`/logs. The CLI's warning about
  fallback metadata was not a model substitution; no model turn succeeded.
- Mechanical gates are blocked by that observed incompatibility and unresolved
  tool cost eligibility. No more expensive executor or API path was substituted.
  Configuration restoration continues; this is not a passing repair or runtime loop.

## Human boundaries

This repair is approved. Sandbox escalation for exact project protected-file
installation may be needed; stage concrete files first. No global authentication
change or paid API integration is approved. An unavailable eligible executor needs
a user decision before gates, not an inferred exception. Engram is not exposed
as a tool in this session; this SPEC is the durable record until memory persistence
is available. Do not claim this repair complete or restart exhausted evaluations.

### User runner decision — 2026-09-07

After the native nano refusal, Chris supplied the available model picker and
accepted GPT-5.5 or GPT-5.4 mini as replacements. The principal recommended and
selected GPT-5.4 mini low for mechanical execution. This supersedes nano as the
intended runner. A separate question about temporary Sol gate execution is now
unnecessary; no Sol executor is authorized by elapsed time or inferred approval.
The user-selected account model replaces the earlier API-priced nano candidate;
no numeric account cost ratio versus Sol/Luna is claimed. Verify actual mini
callability before gates. The original stricter cost preference remains recorded;
this explicit replacement is the selected policy for this repair and future loops.

### Native role proof and revised cost evidence

- Five core files installed after exact candidate/baseline preflight with approved
  protected-path access; `protected-install-core.json` records their hashes.
- `.codex/config.toml` write-open probe denied EPERM in the current sandbox without
  any writes, before/after SHA identical. This proves this sandbox boundary only.
- `codex debug` rejects `--strict-config`; the supported debug command then needed
  host access. Its successful prompt output still was NOT treated as role proof.
- A fresh `codex exec --strict-config --sandbox read-only --json` native probe
  exposed structural `agent_type` and selected `fp-dev`, with no role-prompt copy.
  Parent `01a07e3d-a1c4-7061-ac6e-56d9ecaf9c8d` turn is Astra medium. Child
  `01a07e3d-bff2-7a73-9100-b224dc9e9718` has `agent_role=fp-dev`, actual Sol medium
  turn context, and exact installed fp-dev instructions in its developer input.
  It performed no tools/file reads. See `native-fp-dev-provenance.json` and logs.
  The already-open conversation's schema lacks this selector; fresh CLI loading
  resolves that limitation without another orchestration engine.
- GPT-5.4 mini low availability probe succeeded, exit 0, response
  `RUNNER_MODEL_PROBE_OK`, run `01a07e39-edf1-7340-8902-f5d1868f97be`.
- Subsequent official Codex credit-rate verification at
  https://learn.chatgpt.com/docs/pricing found mini input/output 18.75/113 credits
  per million versus Luna 5/30 and Sol 100/500. These are tool credit rates, not
  API dollar prices; plan estimates likewise favor Luna. Mini does not meet the
  original below-Luna ceiling. The principal disclosed this finding and requested
  the user's final choice: Luna low (recommended for cost) or mini low with its
  higher consumption. Final runner installation and gates await that choice;
  no answer or elapsed time is treated as authorization. Core repair continues.
- fp-dev completed model-independent implementation/docs and regression tests;
  no tests or gates run. Runner and lock remain provisional in the staged directory.
  The principal retained Sol medium default-subagent settings as defensive defaults;
  normal manual loops must still select named roles. No extra model was introduced.
- Interim preservation inspection: 183 evaluation/harness/evidence/template/index
  files matched their captured baseline hashes; no runtime state claim is made.
- Native QA dispatch was rejected by automatic approval review before execution:
  the reviewer required explicit authorization for processing repository source
  and contracts with the native Codex models. The principal disclosed the rejection
  and requested that approval. No workaround or indirect dispatch was attempted.
  `qa-approval-blocker.json` records the block. Remaining role probes, gates and
  reviews are pending; no missing evidence is treated as approval.

### Final runner selection — 2026-09-07

Chris answered "ok luna" after the Codex credit-rate comparison. The final
script-runner is `gpt-5.6-luna` with `low` effort, superseding the nano and mini
candidates above. This explicit decision permits the Luna tier itself as runner;
it replaces the original strict below-Luna ceiling for this project. It does not
authorize a more expensive automatic fallback. Published Codex input/cached/output
rates are Luna 5/0.5/30 versus Sol 100/10/500 credits per million tokens;
https://learn.chatgpt.com/docs/pricing is the account-tool cost basis, not API
dollar pricing. Exact plan consumption still depends on actual usage.

Finalize the runner, policy, and accepted hash lock, then verify native loading
with a harmless no-file-read/no-tool response probe. No gates may precede final
QA. The user's runner choice does not answer the separately pending authorization
for native QA/review processing after automatic approval review rejected it.

### Installed policy and all-role native smoke evidence — 2026-09-07

- Installed `script-runner` Luna low and the accepted policy lock after exact
  candidate/baseline hash checks; see `protected-install-runner.json`.
- Remaining native smoke parent `01a07e65-0cde-7db1-b678-f9724dc0a9bf` ran as
  Astra medium and selected the configured roles structurally. Actual child
  turn contexts and exact loaded role instructions prove script-runner Luna low,
  fp-qa Sol medium, fp-architect Astra high, and fp-reviewer Astra high.
  Together with the earlier fp-dev probe, all five native role loads are observed.
  Every smoke child made zero tool calls. This is loading evidence only, not
  repository QA, test execution, or independent review. See
  `native-remaining-role-provenance.json` and its command/output records.
- The implementation delegate finalized the guide with these observed results;
  final guide SHA-256 is
  `130e59b0826f1000e965ce18be7ec8a6470a2eb1360dcc67549f2c8379495948`.
- Current status: implementation installed; native role loading verified;
  repository-content QA permission remains pending following the automatic
  approval rejection. Then QA, the six verbatim repair gates, and two independent
  Astra reviews are required. No gate, build, E2E, commit, or recovery retry ran.
  Earlier provisional/pending runner statements above are historical progress.

### QA and review authorization — 2026-09-08

After clarification that native Codex uses the existing ChatGPT subscription,
Chris answered "ok adelante" to proceeding with QA and independent reviews.
This explicitly authorizes the repair files and contracts to be processed by
native Sol/Astra roles on that subscription. No API billing, credit purchases,
provider change, builds, E2E, commits, or predecessor retry is authorized.
The pre-QA implementation manifest remains unchanged.

### T01 correction attempt 2 — 2026-09-08

Native fp-qa Sol medium found: stale repair archive status; symlinked `.codex`
or `.codex/agents` ancestors could bypass the local-file boundary; missing
ancestor-symlink regressions and incomplete negative pin matrix coverage.
See `qa-round1-report.md` and `native-qa-final-provenance.json`. No gates ran.
The principal assigns this bounded correction to native fp-dev, preserving
all earlier tests and work. Maximum four implementation attempts still applies.

Correction 2 implemented by native fp-dev `01a080f3-8680-75c1-8de0-9b8f08971d18`,
observed Sol medium with exact loaded role instructions. Four scoped files changed;
`round2-manifest.json` SHA-256 is
`7302d63aa947165b1fcdafb7b22deb09ca67f619d091aaf753c2ff0df141f667`.
Baseline preservation again checked 3,547 paths, no unexpected changes.
Native QA revalidation precedes the first mechanical gate run.

Native QA round 2 returned `QA_READY_FOR_GATES`: all nine acceptance cases
covered, no further edits/gaps. Run `01a080f8-d81e-7a61-8c32-aee5941832c1`,
observed Sol medium, exact loaded fp-qa definition. All 17 artifacts still match
the round2 manifest. Packet filename fallback: the prompt said `round2.diff`;
QA correctly inspected actual `round2-diff` plus separate staged/unstaged diffs
and full new-file content. No check was skipped. First gate execution now
assigned to native script-runner Luna low, six commands verbatim, stop on failure.

All six gates passed on unchanged round2 artifacts, executed once each by native
script-runner `01a080fe-7805-77f0-982d-5c347aa60027`, observed Luna low. Both Python
suites ran 16 tests and passed. Guards used their default KISS mode, as declared
verbatim. See `gates-round2-report.json` for full output, exit statuses, duration
basis and context-read truncation/reread notes; no gate output was truncated.
The runner self-report cited earlier smoke provenance; the principal independently
verified this actual gate run in `native-gates-round2-provenance.json`.
No gate retry, code edit, build or E2E ran. Two independent reviews remain pending.

### T01 correction attempt 3 — 2026-09-08

Both independent Astra high reviewers rejected round2 for the same newly found
invalid-type boundary: numeric `developer_instructions` raises TypeError in policy
validation instead of returning diagnostics. This is one objection round, not a
repeat across two implementation attempts. Both full verdicts are retained in
`review-round2-objections.md`; current reviewer telemetry is independently verified.
Codegraph was unavailable (rg/read fallback); sandbox-denied heredoc reads used
inline Python instead; truncated context reads were repeated. No review tests ran.
The principal assigns the narrow type-check and regression correction as attempt 3
of maximum 4. All six gates and both reviews must be repeated after QA; the old
passing gates cannot certify changed artifacts. No E2E budget is affected.

Correction 3 implemented by native fp-dev `01a08106-f2ee-7fb3-913a-0231516d54aa`,
observed Sol medium with exact role instructions. Only checker/test file changed;
pure and filesystem regressions cover numeric, boolean, float, date/time, array
and table instruction types. Round3 manifest SHA-256:
`8c09af1a22290378414b79b86f6eb10f0b78a285d1ff81fc3075c5ba5aaae050`.
All 3,547 baseline paths inspected again, no unexpected changes. QA is pending.

Native QA round 3 returned `QA_READY_FOR_GATES`, no gaps or edits; all 17 hashes
and nine full new-file contents match round3. Actual role run
`01a0810c-375a-7f11-bd41-8742f1ddc1ff` is Sol medium with exact loaded fp-qa
instructions. Policy suite inventory is now 18 methods, preserving previous 16.
QA inspection fallbacks: sandbox denied an Xcode cache write and two temporary
extraction attempts (no created file); in-memory manifest/diff/jq reads replaced
them. A hash read was retried after shell reserved-variable/path errors. These
were read-only inspection fallbacks, not gate retries. Full report is retained.
The six verbatim gates now run on round3 through native Luna low.

Round3: all six exact gates exit 0; 16 generic delivery tests and 18 project-policy
tests passed. Actual native runner `01a08113-2183-7e13-865f-fbd83b172b91`, Luna low,
with exact loaded script-runner instructions. No retries or truncated tool output.
`gates-round3-report.json` records full output/status/timing and current provenance.
All 17 artifact hashes still match round3; no new paths outside baseline/repair.
Fresh independent Astra high reviews now assess round3; round2 rejections remain
preserved and do not certify this changed state.

### T01 validated and closed — 2026-09-08

Correction attempt 3 passed QA, all six verbatim repair gates and both independent
reviews of the unchanged round3 state. Policy suite: 18 tests; generic delivery
suite: 16 tests; all exit 0. The guard command ran its declared default KISS mode.
Native gate executor was Luna low, run `01a08113-2183-7e13-865f-fbd83b172b91`.
Both native fp-reviewer runs were observed Astra high with exact loaded role
instructions and independent, no-history-fork inputs:

- `01a08116-0b09-74b2-add6-80a814a616ef`: APPROVED (`review_one-round3.md`).
- `01a08116-7a77-72a3-baaf-105903980c1b`: APPROVED (`review_two-round3.md`).

Both certify manifest SHA-256
`8c09af1a22290378414b79b86f6eb10f0b78a285d1ff81fc3075c5ba5aaae050`.
Final manifest equality and baseline reconciliation checked all 3,547 original
paths; no unexpected changes or new paths outside baseline/repair. Review
fallbacks were unavailable codegraph replaced by targeted rg/direct reads and
recovered truncated reads. No review edits or repeated gates occurred.

`completion.json` links the final QA, full gate outputs/statuses/timing, model/run
provenance, approvals and preservation. Three of four implementation attempts were
used; prior failures remain recorded. This closes the repair only. The dated
archive entry records its publication-time pending status; this Progress is the
current task status. Configuration/role pins, shared contracts, implementation and
tests were unchanged after final gates and reviews; this is evidence-only closure.

No commit or push was authorized/performed. No paid API integration, credit
purchase, or billing change occurred. Product builds, E2E, resets, fixture/evidence
deletion and predecessor retries remained excluded. Recovery R01's exhausted
budget and incomplete evaluation remain untouched. Prior unvalidated document
baseline is preserved and is not certified as broader completed weekend work.
Engram was not used; the durable record is this SPEC and its evidence directory.
