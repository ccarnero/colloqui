# Predecessor committed-state certification packet

This packet indexes the existing record for
`manual-loops/architecture/blocker-handoff-diagnosis.md`. Historical values below
come from `manual-loops/architecture/blocker-handoff-diagnosis-evidence/` unless
another source is named. It does not certify any predecessor task, reconstruct
missing evidence, or contain a new reviewer verdict.

The intended committed review target is preserved in
`T02-predecessor-committed.diff` and `T02-predecessor-commits.txt` in this
certification evidence directory. The latter maps T01 through T05 to
`612285ef`, `35b656a7`, `26c78b79`, `ec8a9abd`, and `820221a9`, respectively.

## T01 — Manual-loop blocker record

### Committed change

Read-only `git show 612285ef --stat` reported:

```text
612285ef docs(manual-loop): T01 open blocker records with human summary and handoff note
 DOCS/guides/manual-loop.md | 62 ++++++++++++++++++++++++++++++++++++++--------
 1 file changed, 52 insertions(+), 10 deletions(-)
```

`T01-task.diff` isolates the task change against the frozen baseline: step 7 of
`DOCS/guides/manual-loop.md` gains the human-first blocker record, implementer
handoff note, evidence ordering, non-causal exception label, and the
analysis-only/no-budget/no-reopen boundaries.

### Gates and Accept — attempt 1

`T01-gates.json`, `attempt1/T01-gates.json`, and
`T01-gate-01.stdout.txt` through `T01-gate-04.stdout.txt` record these commands:

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `0.966425083` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.000003666` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `3.568641917` |
| `grep -n "For humans" DOCS/guides/manual-loop.md && grep -n "non-causal" DOCS/guides/manual-loop.md && grep -n "creates no budget" DOCS/guides/manual-loop.md && grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md` | 0 | `0.000003875` |

The native Accept duration above is the corrected value in `T01-gates.json` and
the objection record. The preserved original
`attempt1/T01-gates.json` instead wrote `0.000003666` for the Accept. The output
was:

```text
157:     those paths are not allowed. The record OPENS with a "## For humans"
164:   - Label execution exceptions that did not cause the failure as non-causal, so
167:     creates no budget, and creates no continuation SPEC. Requesting it does not
1
```

### Gates and Accept — attempt 2

`T01-attempt2-gates.json` and `T01-attempt2-gate-01.txt` through
`T01-attempt2-gate-04.txt` record:

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `1.1002217079512775` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.05402770801447332` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `4.096122290939093` |
| `grep -n "For humans" DOCS/guides/manual-loop.md && grep -n "non-causal" DOCS/guides/manual-loop.md && grep -n "creates no budget" DOCS/guides/manual-loop.md && grep -c "Max 4 implementation attempts per task" DOCS/guides/manual-loop.md` | 0 | `0.012824874953366816` |

The Accept output was the same four substantive lines shown for attempt 1. The
executed `For humans` command differed from the approval-time command recorded by
the certification SPEC; `deviations.md` explains that the predecessor record
does not establish whether the cause was runner substitution or a SPEC edit.

### State, preservation, implementation, QA, and provenance

`T01-state.json` identifies the reviewed `DOCS/guides/manual-loop.md` SHA-256 as
`009b949a88a2205d9c7f39b3cdf7735738eec6da3e21a7035e19671c0615258b`.
`T01-preservation.json` records `baseline_count: 3731`, changed baseline paths
`manual-loops/architecture/blocker-handoff-diagnosis.md` and
`DOCS/guides/manual-loop.md`, and the same two expected paths.

`T01-implementation-qa.md` records native fp-dev run
`01a0822a-ac72-7102-9608-7f1099e5bb24`, observed `gpt-5.6-sol` / `medium`, and
native fp-qa run `01a08228-815f-7351-81a7-cc78f1e234ff`, observed
`gpt-5.6-sol` / `medium`. It records no implementation scope expansion, test
change, gate, commit, retry, or fallback, and QA found no applicable prose-only
test. `native-provenance.json` independently records those run roles and observed
model/effort. A task-specific implementation turn and QA turn are not recorded.

For both attempts, the gate records request `gpt-5.6-luna` / `low` for the
mechanical executor and observe run `01a08228-5aa1-7c92-afdb-dd55fdbc8be8` as
`gpt-5.6-luna` / `low`; requested session and turn are not recorded, and observed
session and turn are not recorded. `preflight-provenance.json` and
`native-provenance.json` independently identify that run as `script-runner`.

### Attempt 1 objection round — verbatim

The complete contents of `T01-review-attempt1.md` are:

```text
# T01 independent review, attempt 1

Reviewed implementation SHA-256:
009b949a88a2205d9c7f39b3cdf7735738eec6da3e21a7035e19671c0615258b

Reviewer A, native fp-reviewer gpt-6-astra high,
run 01a08230-49e4-7700-bf92-c2ccaef49efb,
turn 01a08230-4a22-7cb1-b644-7f64aa83de9b: APPROVED.
Exact replacement, baseline preservation, all four passed commands, QA and native
provenance checked. No edits or repeated gates.

Reviewer B, native fp-reviewer gpt-6-astra high,
run 01a08230-94f8-7673-89b0-e35ee7090c30: REJECTED.

1. `manual-loops/architecture/blocker-handoff-diagnosis-evidence/T01-gates.json:15` records Accept duration as `0.000003666`; native execution reports `0.000003875`. The evidence also omits the runner’s failed evidence-write attempt and correction at 18:01:21–18:01:27 UTC. This violates manual-loop’s actual-duration and execution-exception reporting requirements and automatic rejection rule 7. Record the native value and evidence-writing exception accurately.

Reviewer B confirmed implementation matches T01 exactly, baseline ownership,
tests and authorization boundaries preserved, and all four commands exited 0.
Independent verdicts were not shared before both were returned.

Original gate report and four outputs are preserved unchanged under attempt1/.
This objection round consumes attempt 1; the principal starts attempt 2 with
evidence correction, QA, all gates and fresh independent reviews. No implementation
edit is currently indicated by either verdict.
```

`native-provenance.json` independently records both reviewer runs as
`fp-reviewer`, observed `gpt-6-astra` / `high`. The attempt record supplies
Reviewer A's task turn. Reviewer B's task-specific turn is not recorded in the
verdict document. No final attempt-2 verdict exists.

## T02 — fp-dev handoff-note role contract

### Committed change

Read-only `git show 35b656a7 --stat` reported:

```text
35b656a7 docs(agent-roles): T02 require fp-dev handoff note on final failed attempt
 DOCS/guides/agent-roles.md | 36 ++++++++++++++++++++++++++++++++++++
 1 file changed, 36 insertions(+)
```

`T02-task.diff` isolates the insertion in the fp-dev Return contract requiring a
final-attempt handoff note with a plain-language failure, quoted root cause,
concrete candidate diffs and risks, and its analysis-only boundary.

### Gates and Accept

`T02-gates.json` and `T02-gate-01.txt` through `T02-gate-04.txt` record:

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `1.1473162920447066` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.05121437495108694` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `3.7107051250059158` |
| `grep -n "HANDOFF NOTE" DOCS/guides/agent-roles.md && grep -n "consumes no attempt" DOCS/guides/agent-roles.md && grep -c "do not diagnose, remediate, edit, retry" DOCS/guides/agent-roles.md` | 0 | `0.009795458056032658` |

The Accept output in `T02-gate-04.txt` is:

```text
90:exhausted or that the same error repeated — also return a HANDOFF NOTE
96:gates, and do not request a retry. Writing it consumes no attempt and creates
1
```

### State, preservation, implementation, QA, and provenance

`T02-state.json` identifies the reviewed `DOCS/guides/agent-roles.md` SHA-256 as
`8270bad50214b821efc8f19475be5f2dbccd6b25175d82a3a7197984365a3904`.
`T02-preservation.json` does not exist; baseline ownership in that required file
is not recorded.

`T02-implementation-qa.md` records native fp-dev run
`01a0822a-ac72-7102-9608-7f1099e5bb24`, observed `gpt-5.6-sol` / `medium`, task
turn `01a08237-52b2-7ab1-91cf-d1a6fa1e13d4`, and native fp-qa run
`01a08228-815f-7351-81a7-cc78f1e234ff`, observed `gpt-5.6-sol` / `medium`.
It reports one exact insertion, no appropriate prose test, no QA edit, and no
implementation retry. The QA task turn is not recorded. It also records the
non-causal malformed coordination call, principal interruption, and a truncated
provenance display; the persisted JSON was complete and no gate output was
truncated.

`T02-gates.json` requests `gpt-5.6-luna` / `low` and observes runner
`01a08228-5aa1-7c92-afdb-dd55fdbc8be8` as `gpt-5.6-luna` / `low`; requested
session and turn are not recorded, and observed session and turn are not
recorded. No T02 reviewer verdict or task-specific reviewer provenance exists.

## T03 — fp-dev role pin and lock refresh

### Committed change

Read-only `git show 26c78b79 --stat` reported:

```text
26c78b79 chore(codex): T03 add fp-dev handoff note instruction and refresh lock
 .codex/agents/fp-dev.toml    | 10 ++++++++++
 .codex/manual-loop.lock.json | 12 ++++++++++++
 2 files changed, 22 insertions(+)
```

`T03-task.diff` contains the appended handoff instruction and the single lock
entry change. It records the old fp-dev source hash
`d06443d9f26975f289644b35b9747cdef7cf7477bb13c606f69ad54e0ebc33b5` and new
hash `5b009539974207f8141a0367bcc3f2581d47618f2ced9c3b61fb7de899ada2b5`.
The other five `FROM` source entries remain unchanged in that diff:

| Lock source | Unchanged SHA-256 |
| --- | --- |
| `.codex/config.toml` | `0e2aafb360454df9f511fe0ff65e0abb783ef5e533b17410d67b341e4d164e94` |
| `.codex/agents/fp-architect.toml` | `1640055b7754993d2133b1a9b5df3a99271ae2df91fe2278631c71b6abacda4d` |
| `.codex/agents/fp-qa.toml` | `38e65b353624c7abd7a5e81113e32b19c0bba8c4cebc7ad32f85bb65c5f5e3c8` |
| `.codex/agents/fp-reviewer.toml` | `3c1d2938403918b35a1050a0338e18252480336a345703cba3a93af5416a05f8` |
| `.codex/agents/script-runner.toml` | `c25e15631146484210f3d5d027baa34a709e2f438233125663f30a0435c70710` |

These are historical values quoted from `T03-task.diff`; they were not
recomputed for this packet.

### Gates and Accept

`T03-gates.json` and `T03-gate-01.txt` through `T03-gate-04.txt` record:

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `1.136267332942225` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.05670841608662158` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `4.528973625041544` |
| `python3 -c "import tomllib,sys; d=tomllib.load(open('.codex/agents/fp-dev.toml','rb')); assert d['name']=='fp-dev'; assert d['model']=='gpt-5.6-sol'; assert d['model_reasoning_effort']=='medium'; assert d['sandbox_mode']=='workspace-write'; assert 'handoff note' in d['developer_instructions']; print('ok')" && python3 -c "import json,hashlib; l=json.load(open('.codex/manual-loop.lock.json')); h=hashlib.sha256(open('.codex/agents/fp-dev.toml','rb').read()).hexdigest(); assert l['files']['.codex/agents/fp-dev.toml']==h, 'lock drift'; assert l['files']['.codex/config.toml']=='0e2aafb360454df9f511fe0ff65e0abb783ef5e533b17410d67b341e4d164e94'; assert len(l['files'])==6; print('ok')" && python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.10642837500199676` |

The Accept output in `T03-gate-04.txt` was:

```text
ok
ok
PASS: project Codex manual-loop policy and hash lock validated
```

### State, preservation, implementation, QA, and provenance

`T03-state.json` identifies `.codex/agents/fp-dev.toml` as the new hash above
and `.codex/manual-loop.lock.json` as
`e400b7badccf6d6c15779bd0142f0a10531da9e00ca13407e534122f5ed21701`.
`T03-preservation.json` records `baseline_count: 3731` and the changed baseline
paths `.codex/agents/fp-dev.toml`, `.codex/manual-loop.lock.json`, the predecessor
SPEC, `DOCS/guides/agent-roles.md`, and `DOCS/guides/manual-loop.md`.

`T03-implementation-qa.md` records native fp-dev run
`01a0822a-ac72-7102-9608-7f1099e5bb24`, observed `gpt-5.6-sol` / `medium`, and
native fp-qa run `01a08228-815f-7351-81a7-cc78f1e234ff`, observed
`gpt-5.6-sol` / `medium`. Task-specific implementation and QA turns are not
recorded. It reports exact scope, no tests applicable, no QA edits, and the
non-causal malformed grouped read, cancelled stalled protected patch, authorized
write retries, and permission-status race. It explicitly records no gate retry,
duplicate mutation, protection bypass, or session restart.

`T03-gates.json` requests `gpt-5.6-luna` / `low` and observes runner
`01a08228-5aa1-7c92-afdb-dd55fdbc8be8` as `gpt-5.6-luna` / `low`; requested
session and turn are not recorded, and observed session and turn are not
recorded. No T03 reviewer verdict or task-specific reviewer provenance exists.

## T04 — Authoring templates

### Committed change

Read-only `git show ec8a9abd --stat` reported:

```text
ec8a9abd docs(manual-loops-templates): T04 blocker record format and cheapest-gate-first gates
 manual-loops-templates/README.md                  | 23 +++++++++++++++++++++++
 manual-loops-templates/spec-canonical-template.md | 17 ++++++++++++++---
 manual-loops-templates/spec-simple-template.md    | 19 +++++++++++++++----
 3 files changed, 52 insertions(+), 7 deletions(-)
```

`T04-task.diff` isolates the blocker-record authoring guidance, cheapest-first
gate guidance, and primary-service G1 typecheck/G2 test ordering.

### Gates and Accept

`T04-gates.json` and `T04-gate-01.txt` through `T04-gate-04.txt` record:

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `1.1580222920747474` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.05660045810509473` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `4.268370833015069` |
| `grep -n "Blocker records" manual-loops-templates/README.md && grep -n "cheapest failure first" manual-loops-templates/spec-simple-template.md manual-loops-templates/spec-canonical-template.md && grep -n "G5b" manual-loops-templates/spec-canonical-template.md` | 0 | `0.012333500082604587` |

`T04-gate-04.txt` preserves the full output: the Blocker records heading at line
94, the cheapest-first matches in both templates, and four unchanged G5b matches
in the canonical template.

### State, preservation, implementation, QA, and provenance

`T04-state.json` records identical before/after target hashes:
`manual-loops-templates/README.md`
`0e1af50d371bdc3bac9bccfb4ebdfea71cad5bd5df2e4fa4cfc640d6355114e9`,
`spec-simple-template.md`
`2de695ca8a7ec3a2d79e9dbb4760eaf3c481bdb19da9414923c26c6076464ffe`, and
`spec-canonical-template.md`
`6f573b25b805deb2bd34431387a3fcda62283e88fa92dbd9e8df2a23b8dc00b9`.
`T04-preservation.json` records `baseline_count: 3731` and eight changed baseline
paths: the two T03 config files, predecessor SPEC, both guides, and the three
template files.

`T04-implementation-qa.md` records native fp-dev run
`01a0822a-ac72-7102-9608-7f1099e5bb24`, observed `gpt-5.6-sol` / `medium`, and
native fp-qa run `01a08228-815f-7351-81a7-cc78f1e234ff`, observed
`gpt-5.6-sol` / `medium`. Task-specific implementation and QA turns are not
recorded. It reports only the three authorized template changes, no applicable
tests, no developer gates, no QA edits, and no retries, fallbacks, exceptions, or
session restart.

`T04-gates.json` requests `gpt-5.6-luna` / `low` and observes runner
`01a08228-5aa1-7c92-afdb-dd55fdbc8be8` as `gpt-5.6-luna` / `low`; requested
session and turn are not recorded, and observed session and turn are not
recorded. No T04 reviewer verdict or task-specific reviewer provenance exists.

## T05 — Guide and decision record

### Committed change

Read-only `git show 820221a9 --stat` reported:

```text
820221a9 docs(codex-manual-loop): T05 record fp-dev lock change, index entry, and SPEC evidence
 DOCS/archive/INDEX.md                              |  26 ++
 DOCS/guides/codex-manual-loop.md                   | 109 ++++++
 .../architecture/blocker-handoff-diagnosis.md      | 391 +++++++++++++++++++++
 3 files changed, 526 insertions(+)
```

`T05-task.diff` isolates the dated handoff decision in
`DOCS/guides/codex-manual-loop.md` and the archive index entry. The commit stat
also includes the predecessor SPEC because that task committed the accumulated
queue record.

### Gates and Accept

`T05-gates.json` and `T05-gate-01.txt` through `T05-gate-04.txt` record attempt 2.
`T05-implementation-qa.md` records that attempt 1 stopped at QA for two wording
corrections before any gate execution.

| Command | Exit | Native duration (seconds) |
| --- | ---: | ---: |
| `./scripts/checks/doc-code-guards.sh` | 0 | `1.2320749580394477` |
| `python3 ./scripts/checks/check-codex-manual-loop.py` | 0 | `0.05279429198708385` |
| `./scripts/checks/doc-code-guards.sh --full` | 0 | `4.2168731660349295` |
| `grep -n "blocker-handoff" DOCS/archive/INDEX.md && grep -n "fresh Codex session" DOCS/guides/codex-manual-loop.md` | 0 | `0.011029041022993624` |

The Accept output in `T05-gate-04.txt` is:

```text
1778:[blocker-handoff diagnosis SPEC](../../manual-loops/architecture/blocker-handoff-diagnosis.md).
1780:- **Engram topic**: `manual-loop/blocker-handoff` (durable repository record;
36:Start a fresh Codex session in the repository so the project configuration and
85:fresh Codex session. The decision is that a final failed-attempt handoff is
```

### State, preservation, implementation, QA, and provenance

`T05-state.json` identifies `DOCS/guides/codex-manual-loop.md` as
`56ca347cfae38b6b4e0ad2da5aacf32239826f47ad9982698d86e9bac5073fb6` and
`DOCS/archive/INDEX.md` as
`87e5e73c9ceff99949e817f7df59d2821272cf3b2250e71f047d471429f73930`.
`T05-preservation.json` does not exist; baseline ownership in that required file
is not recorded.

`T05-implementation-qa.md` records native fp-dev run
`01a0822a-ac72-7102-9608-7f1099e5bb24`, observed `gpt-5.6-sol` / `medium`, task
turn `01a08253-3ba9-7c03-a2a4-fb907560b0e3`, and native fp-qa run
`01a08228-815f-7351-81a7-cc78f1e234ff`, observed `gpt-5.6-sol` / `medium`, final
QA turn `01a08257-8a3e-70d2-bb21-beb11a9154cb`. It records an attempt-1 QA
correction and attempt-2 readiness, no applicable tests or QA edits, and a
non-causal inspection exception where an expected `diff` exit 1 stopped an `&&`
chain before the second read. A task-specific turn for the attempt-2 developer
correction is not recorded.

`T05-gates.json` requests `gpt-5.6-luna` / `low` and observes runner
`01a08228-5aa1-7c92-afdb-dd55fdbc8be8` as `gpt-5.6-luna` / `low`; requested
session and turn are not recorded, and observed session and turn are not
recorded. No T05 reviewer verdict or task-specific reviewer provenance exists.

## Guard integration source finding

This is a present source inspection, not evidence recorded during the predecessor
run. Current `scripts/checks/doc-code-guards.sh:1319-1331` defines the checker
call:

```bash
g19_codex_manual_loop() {
  local guard="G19(codex-manual-loop)"
  local output
  local status

  output=$(python3 scripts/checks/check-codex-manual-loop.py 2>&1)
  status=$?
  if [[ "$status" -ne 0 ]]; then
    fail "$guard: checker failed:\n$output"
  else
    pass "$guard: mandatory Codex pins and hash lock validated"
  fi
}
```

Current `scripts/checks/doc-code-guards.sh:1333-1367` places the invocation after
the KISS/full branch rejoins:

```bash
main() {
  if [[ "$MODE" == "kiss" ]]; then
    note "Running KISS mode (core + bus guard set)"
    g6a_service_inventory
    g6b_no_scaledobject
    g7_ack_wait_census
    g9_di_type_imports
    g15_alert_consumer_names
    g16_bash32_compliance
    g17_core_nats_publish_policy
    g18_legacy_lazy_nats_wrappers
  else
    g6a_service_inventory
    g6b_no_scaledobject
    g6c_autoscaling
    g6d_referenced_scripts_exist
    g6e_alert_names
    g6f_archive_banner
    g6g_no_component_agents_md
    g7_ack_wait_census
    g8_agent_call_timeout_ceiling
    g9_di_type_imports
    g9b_numeric_claims
    g10_markdown_links_resolve
    g11_storage_engine_documented
    g12_class_banner
    g13_doc_paths_resolve
    g14_no_new_hex_colours
    g15_alert_consumer_names
    g16_bash32_compliance
    g17_core_nats_publish_policy
    g18_legacy_lazy_nats_wrappers
  fi

  g19_codex_manual_loop
```

Therefore the current source invokes `check-codex-manual-loop.py` in both KISS
and full modes. This finding does not retroactively add the requested finding to
the predecessor's original record. The predecessor gate files separately record
successful direct checker executions and successful KISS/full commands.

## Missing from the predecessor record

- T01 final-state dual independent reviewer verdicts: **not recorded**. The only
  verdicts are Reviewer A APPROVED and Reviewer B REJECTED for attempt 1; no
  verdict exists for attempt 2.
- T02 final-state independent reviewer verdicts: **not recorded**.
- T03 final-state independent reviewer verdicts: **not recorded**.
- T04 final-state independent reviewer verdicts: **not recorded**.
- T05 final-state independent reviewer verdicts: **not recorded**.
- `T02-preservation.json`: **not recorded**; the required file is absent.
- `T05-preservation.json`: **not recorded**; the required file is absent.
- Requested gate-executor session and turn for T01-T05: **not recorded**; those
  fields are absent from every `requested` object.
- Observed per-gate session and turn for T01-T05: **not recorded**; the gate
  records use `unavailable`, which does not supply either identity.
- Task-specific fp-dev turns for T01, T03, and T04, and the T05 attempt-2
  correction: **not recorded**.
- Task-specific fp-qa turns for T01-T04: **not recorded**.
- Reviewer B's T01 attempt-1 task turn: **not recorded** in the verdict document.
- Reviewer model/run/turn identities and verdicts for T01 attempt 2 and T02-T05:
  **not recorded**.
- Approval-time predecessor SPEC bytes or original command, editor identity,
  edit time, and evidence distinguishing runner substitution from a mid-flight
  SPEC edit: **not recorded**, as established in `deviations.md`.
- The guard integration finding above as a predecessor-run finding: **not
  recorded**; it is distinguished as a current source inspection.

`independent-review-verdicts.json` contains only the two T01 reviewer run IDs and
an empty `final_verdicts` array for each. It supplies no final verdict for any
task. The independent reviewers assigned to this certification task must assess
both this task's unchanged artifacts/evidence and the full predecessor target in
`T02-predecessor-committed.diff` and `T02-predecessor-commits.txt`; their future
verdicts and actual provenance belong to the principal's record after review.
