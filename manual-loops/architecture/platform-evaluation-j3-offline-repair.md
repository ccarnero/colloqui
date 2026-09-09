# SPEC — Repair evaluation webhook targeting and safe J3 diagnostics offline

> Origin: Chris approved the concrete offline continuation with “ok adelante”, 2026-09-08.
> Engram topic: `platform-cluster/platform-evaluation-j3-offline-repair`.
> Predecessors: `end-to-end-evaluation.md` T02 and `end-to-end-evaluation-recovery.md` R01 remain blocked with their original exhausted budgets.
> Engine: `DOCS/guides/manual-loop.md`; template: canonical.

## Goal

Correct the evaluator's proven account-ID versus webhook-instance mismatch and
retain safe failure evidence by J3 substage. Validate this correction offline;
do not claim that historical J3 causation or runtime product behavior is proven.

## User decisions

- The approval applies to the concrete three-file repair, offline regressions,
  typecheck, QA and dual review proposed in the preceding diagnosis. This SPEC
  makes that approved scope executable without asking for duplicate permission.
- Zero runtime invocations are authorized. No new runtime attempt budget exists;
  R01 remains exhausted at four attempts. A later runtime decision must assess the
  corrected, verified state first. This is not R01 attempt 5.
- Preserve all current product source, configurations, fixtures, identities,
  reports, records, prior attempts and budgets. No commits or pushes.

## Prior art and diagnosis

- `e2e/platform-evaluation.spec.ts` sends the internal channel UUID as webhook
  instance in J3 and both J4 sends. The instance contract in
  `services/api-gateway/src/modules/channels/webhooks.controller.ts` uses the
  channel account's `externalId` instead.
- `services/provisioning-service/src/modules/apply/infrastructure/channels-writer.ts`
  creates account externalId as `manifest:<name>` but returns the internal ID in
  apply's homonymous externalId field. Preserve product semantics.
- `services/channel-service/src/modules/webhooks/webhook-ingress.service.ts`
  resolves instance by account.externalId and can return unknown_instance after
  gateway publication was already acknowledged. Gateway accepted is not downstream
  account/signature acceptance.
- The old record wrapper erases the specific failure. Empty executionIds do not
  prove execution absence because capture follows COMPLETED detection.
- `services/workflow-service/src/modules/executions-projector/` updates list
  status independently. Do not add detail-GET polling: getExecutionStatus writes
  persisted status. Reuse existing list/projector observation and acceptance.

## Constraints

- Full AGENTS.md, shared engine and role contracts apply. Principal owns this
  SPEC/evidence, fp-dev implementation/regressions, fp-qa acceptance/validation,
  and two independent fp-reviewers assess the unchanged final state.
- Native configured roles: dev/QA Sol medium, reviewers Astra high, mechanical
  runner Luna low. Use the approved project runner cost exception and recorded
  Codex-account credit basis from the completed configuration repair; never an
  API-price substitute or automatic model fallback. Verify actual native runner
  callability/provenance before gates. Record observed session/turn/model separately
  from configured intent. Missing provenance blocks closure.
- Preserve existing tests and every J1–J5 behavioral assertion, including
  completion, polling deadlines, ownership and safety/preservation behavior.
  Only the wrong webhook destination and safe diagnostic capture change.
- Pure decisions receive values, return typed outcomes, and never perform I/O,
  log, receive effect callbacks or use exception control flow. Reuse applicable
  shared account types and existing local result/validation conventions. No new
  libraries. Keep the three-file boundary; document inherited large-file debt.
- No production/shared/package/lock/runner/config/config-test/role/protection edits.
  No writes to predecessor records or their evidence roots. No private identity
  reads, auth, HTTP, Kubernetes, Docker, Temporal, NATS or product commands.
- No installs, builds, runtime tests, E2E, Playwright execution/discovery, fixture
  creation, cleanup, reset or dev-mode operations. Existing installed tools suffice
  for the offline gates; unavailable prerequisites block instead of triggering setup.
- Diagnostic persistence uses explicitly allowlisted codes, checkpoints, numeric
  HTTP statuses, counts and validated owned IDs. Never persist raw errors, bodies,
  headers, requests, tokens, appSecret, nonce payloads, assertion values or snapshots.
  Model diagnostic-write failure separately so it cannot erase a primary failure.
- The original manifests, resources and identity remain untouched. New code may
  implement checkpoint writes for a future separately approved runtime invocation;
  this task never executes those runtime effects.

## Gates

Run from repository root, each command through `/bin/bash -o pipefail -c`, in
the exact order below after final QA. Native script-runner owns every command;
stop on first failure without retry, diagnosis or substitution. Principal owns
the task's standard maximum four offline correction attempts and closure. These
are correction attempts, never replenished predecessor/runtime attempts.

Record command, complete sanitized output, exit status, timing, tested-state
manifest and actual executor identity under this task's evidence tree. The Node
and pnpm versions must match the preserved tool baseline (26.7.0 and 11.6.0).
No service build is affected, no installation/build reproducibility is claimed,
and no cluster gates apply to this explicitly offline scope.

```bash
/bin/bash scripts/checks/doc-code-guards.sh
node -e 'if (process.version !== "v26.7.0") { console.error(process.version); process.exit(1); } console.log(process.version)'
pnpm --version | python3 -c 'import sys; v=sys.stdin.read().strip(); print(v); sys.exit(0 if v == "11.6.0" else 1)'
node --test e2e/platform-evaluation-state.test.mjs
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck e2e/platform-evaluation.spec.ts e2e/platform-evaluation.config.ts e2e/platform-evaluation-state.ts
git diff --check
```

Final gate — scope and preservation:

```bash
python3 - <<'PY'
import pathlib, json, hashlib, subprocess
root = pathlib.Path.cwd()
base = root / 'manual-loops/architecture/platform-evaluation-j3-offline-repair/evidence'
baseline = json.loads((base / 'baseline.json').read_text())['files']
allowed = {'e2e/platform-evaluation.spec.ts', 'e2e/platform-evaluation-state.ts', 'e2e/platform-evaluation-state.test.mjs'}
record = 'manual-loops/architecture/platform-evaluation-j3-offline-repair.md'
prefix = 'manual-loops/architecture/platform-evaluation-j3-offline-repair/'
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
paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
for name in filter(None, paths):
    if name not in baseline and name not in allowed and name != record and not name.startswith(prefix):
        failures.append(name)
print(json.dumps({'baseline_paths': len(baseline), 'unexpected_changes': sorted(set(failures))}, indent=2))
raise SystemExit(1 if failures else 0)
PY
```

## Task queue

### T01 — Correct owned webhook targeting and retain safe J3 failure checkpoints

Allowed implementation write paths:
- `e2e/platform-evaluation.spec.ts`
- `e2e/platform-evaluation-state.ts`
- `e2e/platform-evaluation-state.test.mjs`

Principal-only paths: this SPEC and
`manual-loops/architecture/platform-evaluation-j3-offline-repair/evidence/**`.
One generated-artifact exception: the focused test gate may create and retain
one fresh UUID subtree per invocation under this task's
`evidence/checkpoint-boundary/`, solely for real filesystem boundary tests.
No deletion, predecessor-root writes or runtime fixtures are allowed. This is
ownership within the already approved evidence tree, not additional directory scope.
No other write scope. Full inherited contents of the three untracked files are
reviewed alongside the new diff; baseline copies distinguish this repair.

Before editing, read full AGENTS.md, shared engine/role contract, this task,
Constraints, Gates, baseline files and prior-art source paths above. Other agents
are working in this repository; do not revert their edits or preexisting work.

1. Resolve the inbound account from its captured exact ID and expected name,
   tenant, HTTP channel, active state, nonempty externalId and secret-presence
   boolean. Return a typed safe failure for mismatches. Do not infer ownership by
   prefix or replace UUID trigger/admin IDs with the externalId.
2. Build an encoded instance path from the verified account externalId, and use
   that same resolved target for J3 and both J4 sends. Keep credentials in the shell.
3. Add safe J3 diagnostic state identifying the attempted operation and last
   completed checkpoint, including account validation, ingress publication,
   execution-list observation, detail validation, correlation capture, tracking
   run and sent-event observation. Persist progress before the next operation can
   fail. Allowlisted failures distinguish transport/HTTP, malformed response,
   ownership, timeout and assertions without raw error text.
4. Capture safe owned execution observations before waiting for completion, while
   retaining the existing COMPLETED/nonce/branch/sink/causal assertions. Keep
   completion evidence distinct from observations. Gateway checkpoint says
   ingress_published, never downstream accepted.
5. Preserve primary J3 failure if final disable, resource preservation or diagnostic
   persistence fails. J4/J5 remain pending when unrun. Keep exact workflow mutation
   authority and original finalization behavior.

Preimplementation QA: `/root/j3_acceptance`, native fp-qa, supplied the following
cases before implementation and reconfirmed gate applicability on 2026-09-08:
- UUID differs from account externalId; all three send sites use the verified
  encoded instance; Unicode/percent/question-mark/slash boundary encoding.
- Missing/empty externalId, wrong ID/name/tenant/channel, inactive account or no
  secret presence fails before send; no other account adoption or secret retention.
- Checkpoint order, failure at each boundary, safe HTTP/attempt/status summaries,
  malformed response, timeout and primary-versus-secondary failure separation.
- Whitelist tests with sensitive-shaped inputs cannot leak raw values into
  diagnostic evidence; calculations have no I/O mocks or effects.
- Existing ID/apply/capture/safety/preservation regressions remain intact;
  final QA verifies actual shell wiring and persistence order, not helper tests alone.
- Scope/preservation gate covers all baseline git-tracked/untracked paths,
  including frozen config/runner/lock, prior SPECs and attempt-4 evidence. Ignored
  caches and physical runtime data are not certified by this filesystem check.
- Exercise the actual diagnostic persistence action with real task-local files:
  exact allowlisted output, repeated-checkpoint idempotency or safe collision,
  unchanged earlier checkpoints, deterministic write failure, typed failure and
  primary-error precedence. Validate destination boundaries and reject symlink
  escapes. Preserve all generated artifacts; no I/O mocks or copied writer.
  Keep the action explicitly separate from pure decisions in the existing helper
  file to respect the human-approved three-file boundary; no calculation calls it.
- Persistence uses immutable sequence-named `j3-checkpoint-NNN.json` files.
  Earlier evidence is never replaced; repeated destinations fail safely without
  changing existing bytes. A typed write failure prevents the next ordinary
  operation while the existing safety/preservation finalizers still run.

**Accept:** every offline gate exits 0; complete regressions, final QA and two
independent native Astra APPROVED reviews cover one unchanged state with actual
provenance. No runtime invocation or resource/identity mutation. Closure certifies
this offline repair only, not J3/J4/J5 success or predecessor task completion.

## Progress

- Achieved: webhook targeting and safe J3 diagnostics were corrected offline; the later continuation resolved TS2339.
- Remaining: none in this exhausted repair; runtime product validation remains separate.
- Blocked: this task ended on TS2339 and cannot be retried.
- Attempts: T01 4/4 exhausted.
- Validation: attempt 4 passed the first four gates including 34 tests, then typecheck failed; no final reviews.
- Evidence: detailed packet retired by Chris on 2026-09-09; see platform-evaluation-j3-offline-repair/SUMMARY.md.

## Out of scope and human boundaries

Production repair, identifier migration, causal-chain rewrite, new public routes,
runtime execution, fixture/identity activation, prior record rewriting, cleanup,
configuration repair, billing/provider changes and commits/pushes are excluded.
There is no docs/archive publication task or broader evaluation completion claim.
The durable decision record is this SPEC; Engram is unavailable, no save claimed.
A later runtime proposal needs a separate human decision after this correction
has actual gates and independent approvals. R01's four exhausted attempts remain
unchanged regardless of this task's result.
