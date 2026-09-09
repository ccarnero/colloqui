# SPEC — Complete offline validation of the retained J3 evaluator repair

> Status: COMPLETE — C01 closed on attempt 1 with seven green gates and dual approval; runtime budget zero.
> Origin: Chris requested reconstruction and a concrete continuation, 2026-09-09.
> Engram topic: `platform-cluster/platform-evaluation-j3-offline-continuation`.
> Depends on: original evaluation T02, recovery R01 and offline repair T01,
> all exhausted at 4/4; their records and budgets remain unchanged.
> The blocker-handoff certification is complete and is not reopened.
> Template: canonical; engine: `DOCS/guides/manual-loop.md`.

## Goal

Establish a fully validated offline evaluator state that is eligible for a
separate runtime decision: retained targeting/diagnostic corrections compile,
all focused regressions and preservation gates pass, and two independent native
reviewers approve the same complete state. This does not complete product
journeys J3-J5 or the original evaluation's delivery/cleanup tasks.

## User decisions and approval boundary

- Chris approved this SPEC on 2026-09-09 with "perfecto, adelante". This
  activates one new task with at most four offline correction attempts,
  stopping on the same error twice consecutively. This is neither original T02
  attempt5, R01 attempt5 nor offline-repair T01 attempt5; none is reopened.
- Runtime budget is ZERO. No auth, HTTP, browser, Playwright discovery/execution,
  Kubernetes, Docker, OrbStack, Temporal, NATS, fixture, credential or identity
  access; no installs, builds, cleanup, reset, dev-mode operations, commits/pushes.
- Preserve all existing source, changes, evidence, fixtures and historical records.
  Configuration/roles/lock/checker protection are closed scope; never repair them
  as part of this continuation. Existing frameworks and libraries remain.
- After offline closure, present a separately scoped runtime proposal using the
  retained identity and bounded J1-J5 contract. Approval here cannot authorize it.
  Original T03 also still needs its finding-specific human approval; original T04
  follows actual product evaluation and delivery, never tooling certification.

## Current state and prior art

Current HEAD is `a5e6146250bfcee197c32dc6fab9b6107c7510a6`. The completed
certification's source target is `9fde0baa9fbae768fc97133731eeb2744f90516e`.
The three evaluation SPECs and six evaluator files are untracked, preserved work.
See `platform-evaluation-j3-offline-continuation/evidence/reconstruction.md`
for the dated source/commit/evidence comparison and its limits.

The last offline attempt recorded 34 passing tests followed by typecheck exit2
TS2339 at evaluator line540. Final whitespace/preservation gates and dual review
were not executed. Attempt3's rejected verdicts do not certify attempt4.
Read-only hash comparison on 2026-09-09 establishes that all three current files
are identical to the frozen attempt4 handoff/reviewed-state manifests. The failed
construct remains at line540. No later corrected source or validation record was
found in the inspected evaluation roots and relevant attempt4 temporary records.
This is not a fresh typecheck result; only compiler-version inspection (5.9.3)
occurred. Retain intermediate corrections before applying the two-line proposal.

Prior art to reuse: `platform-evaluation-j3-offline-repair.md` task and evidence,
its attempt4 snapshots/reports and attempt3 objections; current
`e2e/platform-evaluation.spec.ts`, `e2e/platform-evaluation-state.ts`,
`e2e/platform-evaluation-state.test.mjs`; channel webhook controller/ingress and
provisioning channels-writer source cited by that repair. Preserve existing UUID
versus Nano-ID handling, exact ownership/capture, primary-error precedence,
externalId targeting and all three J3/J4 send sites. Gateway acknowledgement
remains ingress publication, not proof of downstream acceptance.

## Constraints

- Full AGENTS.md, manual-loop and agent-roles contracts apply. Principal owns
  SPEC/evidence; native fp-dev owns implementation/regressions; fp-qa supplies
  acceptance before approval and validates before gates; two independent
  fp-reviewer agents judge unchanged final content, including full untracked files.
- Use configured Sol/medium dev/QA, Astra/high reviewers and Luna/low mechanical
  runner. Approved project exception permits runner at economical coding tier,
  below implementation/QA. Before execution verify native callability and actual
  applicable Codex-account cost basis; API pricing alone is insufficient. No
  automatic fallback or configuration change. Record actual run/turn/model.
- Calculations take data and return typed outcomes; no effects, injected I/O
  callbacks, logging or exception control flow in calculations. Shell owns
  transport/filesystem/exception conversion and safe diagnostics. No new library,
  broad file split or migration. Retain documented inherited large-file debt.
- Never weaken/delete/skip a test or J1-J5 assertion, deadline, ownership check,
  safety finalizer or preservation requirement. No any/assertion casts,
  ts-ignore, transpile-only substitute, removed typecheck target or relaxed flag
  to hide narrowing failure. Preserve explicitly discriminated Result branches.
- No production/shared/package/lockfile/config/runner/config-test edits. No writes
  to original/recovery/offline-repair/certification SPECs or their evidence trees.
  No private identity contents, secrets, payloads or raw assertion/errors in records.
- Only fresh UUID filesystem test subtrees under this continuation's
  `evidence/checkpoint-boundary/` are permitted effects beyond implementation and
  coordinator records. Retain artifacts, including failure/symlink tests. Never
  follow escape symlinks or write their targets. No predecessor test-root writes.
- Frozen source/baseline records in this continuation remain immutable. New
  attempts get uniquely named records and snapshots, never overwrite prior gates
  or verdicts. Final QA finishes all edits before state freeze and gates.

## Gates

Every command below runs from repository root, in order, once per attempt after
final QA, through `/bin/bash -o pipefail -c` with the exact command body passed
as ONE argv value. Extract code blocks byte-for-byte into an immutable command
packet and verify equality to this approved SPEC BEFORE launch. Do not rebuild
bodies through nested shell quoting, variable expansion or manual retyping.
Native script-runner stops on first failure and reports full sanitized native
output, exit status, duration, state identity and actual model/run/turn. Principal
owns retries and evidence assembly. No gate runs while approval is pending.

Existing installed Node/pnpm must match the prior baseline; unavailability blocks
instead of installation. Typecheck precedes filesystem tests because it was the
last stopping failure. These are offline gates, not runtime authorization.
No service build or cluster/dev-mode precondition applies; no build reproducibility
or current live-image claim is made. Generic template runtime gates are inapplicable.

G1 — pinned Node, ITERATION:

```bash
node -e 'if (process.version !== "v26.7.0") { console.error(process.version); process.exit(1); } console.log(process.version)'
```

G2 — pinned pnpm, ITERATION:

```bash
pnpm --version | python3 -c 'import sys; v=sys.stdin.read().strip(); print(v); sys.exit(0 if v == "11.6.0" else 1)'
```

G3 — complete existing evaluator typecheck, ITERATION and TS2339 regression:

```bash
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck e2e/platform-evaluation.spec.ts e2e/platform-evaluation.config.ts e2e/platform-evaluation-state.ts
```

G4 — all focused decision and real filesystem regressions, ITERATION:

```bash
node --test e2e/platform-evaluation-state.test.mjs
```

G0 — repository guard, ITERATION:

```bash
/bin/bash scripts/checks/doc-code-guards.sh
```

G5 — tracked whitespace validation, ITERATION (full untracked files still reviewed):

```bash
git diff --check
```

G6 — baseline and scope preservation, COMMIT GATE (verification label only;
commits remain forbidden):

```bash
python3 - <<'PY_PRESERVE'
import pathlib, json, hashlib, subprocess
root = pathlib.Path.cwd()
base = root / 'manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence'
baseline_bytes = (base / 'baseline.json').read_bytes()
if hashlib.sha256(baseline_bytes).hexdigest() != '6b5d9cbdee6d1640756996f2168ee458241cb8b26260ee418325a121a5904c1a':
    raise SystemExit('Preserved baseline identity changed')
baseline = json.loads(baseline_bytes)['files']
allowed = {'e2e/platform-evaluation.spec.ts', 'e2e/platform-evaluation-state.test.mjs'}
record = 'manual-loops/architecture/platform-evaluation-j3-offline-continuation.md'
prefix = 'manual-loops/architecture/platform-evaluation-j3-offline-continuation/'
failures = []
for name, expected in baseline.items():
    p = root / name
    if name in allowed:
        if not p.is_file() or p.is_symlink(): failures.append(name)
        continue
    if 'symlink' in expected:
        good = p.is_symlink() and str(p.readlink()) == expected['symlink']
    else:
        good = p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest() == expected['sha256']
    if not good: failures.append(name)
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split(chr(0))
for name in filter(None, paths):
    if name not in baseline and name not in allowed and name != record and not name.startswith(prefix):
        failures.append(name)
print(json.dumps({'baseline_paths': len(baseline), 'unexpected_changes': sorted(set(failures))}, indent=2))
raise SystemExit(1 if failures else 0)
PY_PRESERVE
```

This baseline covers 4,048 current tracked/untracked file/symlink paths, captured
after approved configuration/certification integration. The exhausted repair's
older baseline remains historical and unchanged. Ignored caches and runtime data
are not certified. New unexpected baseline drift must be reported before edits;
no silent refresh may erase unrelated work or a failed preservation result.

## Task queue

### C01 — Finish the retained J3 offline repair and certify the complete state

Allowed developer/QA implementation paths only:

- `e2e/platform-evaluation.spec.ts`
- `e2e/platform-evaluation-state.test.mjs`

`e2e/platform-evaluation-state.ts` is frozen read-only but remains part of the
full inherited implementation to review and of the mandatory typecheck.

Principal-only paths: this SPEC and
`manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence/**`.
The focused test may create/retain fresh UUID trees only in this continuation's
`evidence/checkpoint-boundary/`. Existing records in that root remain immutable.
Non-goals: product changes, runtime, old-task closure, all other paths/identities,
configuration/runner repair, cleanup, installs/builds, commits/pushes.

Read full AGENTS, this task/Constraints/Gates and original offline-repair task,
its frozen attempt4 code/QA/gate report and attempt3 rejected reviews, plus current
three files and this continuation's source snapshots/reconstruction. Other work is
present: never revert it. Review full inherited content, not just new line diffs.

1. Confirm current versus attempt4 differences. Retain every already implemented
   correction. If the old narrowing defect still needs correction, use an explicit
   discriminant guard supported by the unchanged compiler invocation; no rewrite
   of transport semantics or untyped workaround. Do not reapply a fix already
   present. Report a materially different defect before expanding scope.
2. Redirect ONLY the test's literal evidenceRoot from the exhausted repair root
   to `manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence/checkpoint-boundary`.
   Keep all assertions, collision/write_failed/symlink-ancestor cases and retained
   artifacts; no generic configurable-path layer is necessary for this one change.
3. Preserve externalId ownership validation, percent-encoded instance targeting
   at all three send sites, immutable ordered safe checkpoints, latest observations
   before completion, transport/HTTP/timeout/assertion distinctions, primary versus
   secondary failures and safety finalizers. No detail-GET status mutation polling.
4. Developer owns regression coverage; exact full typecheck is the compilation
   regression for the prior TS2339. Retain/complete data-driven success and failure
   transport cases, and actual filesystem containment/collision/write-failure/
   immutable-write checks without I/O mocks. Add regressions for any further
   in-scope defect; no repetitive tests mirroring a one-token compiler fix.
5. QA validates complete shell wiring, checkpoint order and failure safety, all
   earlier reviewer objections and unchanged runtime assertions before gates.
   Freeze a manifest, run all seven commands, then obtain two independent native
   Astra/high approvals on the same complete files and evidence. Any content
   change requires new gates and both reviews. Missing evidence is not approval.

The current minimal proposed patch is:

```diff
-          if (!transport.ok) throw new J3ActionError(transport.failure.code);
+          if (transport.ok === false) throw new J3ActionError(transport.failure.code);
-  const evidenceRoot = "manual-loops/architecture/platform-evaluation-j3-offline-repair/evidence/checkpoint-boundary";
+  const evidenceRoot = "manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence/checkpoint-boundary";
```

These two lines are a proposal, not applied changes or verified compilation.


Preimplementation QA acceptance (native fp-qa, 2026-09-09):
- A1: normalized failed transport retains transport_error without raw content;
  success retains APIResponse. Exact compiler command validates both union arms.
- A2: all existing 34 focused tests remain present/unweakened and pass.
- A3: real filesystem allowlist/collision/write_failed/ancestor escape tests use
  only fresh continuation UUID paths and preserve earlier bytes/artifacts.
- A4: 4,048 baseline paths including symlinks and all historical/untracked work
  remain unchanged outside the two allowed files and new SPEC/evidence.
- A5: QA precedes gates; independent reviews cover full original-repair baseline
  through current state, not only the two-line diff, with exact hashes/provenance.
- A6: offline closure never claims runtime/J3-J5 success or resource/identity writes.


**Accept:** all seven exact offline gates exit0; all existing focused tests remain
present/unweakened and pass; QA validates before gates; two independent native
APPROVED verdicts cover identical complete state with actual provenance. All old
source/evidence outside allowed paths is preserved. No runtime effects occurred.
Closure labels ONLY this offline continuation complete. A successor runtime SPEC
and original finding-specific delivery scope remain human boundaries.

## Progress

- Achieved: C01 complete; retained offline repair and TS2339 correction certified.
- Remaining: runtime J3 and the original product evaluation; runtime attempts used here: zero.
- Blocked: none in C01; this SPEC grants no runtime authorization.
- Attempts: C01 1/4.
- Validation: 34 tests and all seven gates passed; two independent Astra/high reviewers approved the unchanged state.
- Evidence: detailed packet retired by Chris on 2026-09-09; see platform-evaluation-j3-offline-continuation/SUMMARY.md.

## Human boundaries and remaining product evaluation

Approve this SPEC to activate only its proposed offline correction budget. All
three predecessor4/4 limits stay exhausted. Successful offline closure is a
prerequisite to a new runtime proposal, not permission to execute it. That later
proposal must recheck current authorized environment/images and preserved identity,
retain the J1-J5 behavioral contract and per-attempt resource/message limits,
require safety/preservation and exact native evidence, and state its own new
runtime attempt budget for approval. Historical J1/J2 passes do not certify a
future changed runtime state. J3 remains unproven; J4/J5 were pending in last run.
Then original T03 requires an approved concrete product change and delivery proof;
original T04 covers findings and proposed record disposition, never deletion.
No memory save is claimed; repository records persist the Engram topic.
