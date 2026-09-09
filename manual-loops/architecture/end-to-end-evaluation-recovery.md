# SPEC — Platform evaluation recovery

> Status: BLOCKED — attempt 4 exhausted at G4/J3; J1/J2 and final preservation passed.
> Origin: Chris approved the concrete recovery proposal with “ok, adelante” on 2026-09-07.
> Engram topic: `platform-cluster/end-to-end-evaluation-recovery`.
> Predecessor: [end-to-end evaluation](end-to-end-evaluation.md), T02 blocked after four attempts; historical results remain intact.
> Template: canonical; engine: [manual-loop](../../DOCS/guides/manual-loop.md).

## Goal

Allow Playwright's worker to reload the evaluation configuration after its own
artifacts directory has been created, while retaining coordinator collision
protection, then obtain actual J1–J5 results with the existing restricted identity.

## User decisions

- This is the separately approved recovery proposed after the predecessor stopped.
  R01 starts its own maximum four attempts; same error twice consecutively stops it.
- Scope includes the verified config collision fix and its regression, plus the
  approved harness identifier/capture/error correction, repeated gates and evidence.
  No product source change or T03/T04 execution is authorized.
- Reuse the one captured test identity; create no additional user or role.
- Preserve data, all previous evidence and manual-loops. No commits/push, deletes,
  resets, global changes, ai-setup audits, library changes or external messaging.
- Keep configured role policy: Sol low implementation/QA, Astra medium principal
  and two independent reviewers. Native named roles are not exposed; use full
  repository role packets as the already disclosed fallback. Record observed
  session/turn/model metadata, not just requested names. No Engram capability is
  available; persist decisions here without claiming an external memory save.

## Baseline and prior art

`end-to-end-evaluation-recovery/baseline.json` preserves HEAD, status, hashes and
the full prior config. The preexisting loop index, old SPEC/reports/evidence,
and identity runner remain outside the current edit scope. The harness amendment
was explicitly approved by Chris on 2026-09-07. The prior
source-baseline.json covers 2,356 product/build files and must remain unchanged.

Playwright 1.60.0 WorkerHost.start creates artifacts before worker deserializeConfig
reloads the config. Its worker constructor sets TEST_WORKER_INDEX first. The
observed prior failure was `Playwright evidence directory already exists for this
run ID` at `e2e/platform-evaluation.config.ts:14`, before J1. Preserve this evidence.

## Constraints

- AGENTS.md is normative. Principal authors SPEC/evidence and orchestrates; fp-dev
  owns code/tests; fp-qa supplies cases before implementation and final validation;
  two independent Astra reviewers assess identical final content and gate evidence.
- Allowed code writes: `e2e/platform-evaluation.config.ts` (coordinator-only collision
  guard) and new `e2e/platform-evaluation-config.test.mjs` (focused regression).
  Current amendment allows `e2e/platform-evaluation.spec.ts`,
  `e2e/platform-evaluation-state.ts` and `e2e/platform-evaluation-state.test.mjs`.
  Freeze the verified config/regression and baseline runner during this amendment.
  No production, package, lockfile or global writes.
- Validate channel UUIDs separately from definition and execution Nano IDs (21
  URL-safe characters, matching current generators). Keep exact ID/name/tenant
  ownership verification. Capture valid exact expected apply outcomes before
  subsequent assertions, including typed partial409 applied outcomes; reject
  duplicate, wrong-kind and invalid-ID rows without adopting unknown names.
  Persist safe baseline hashes before writes and owned IDs immediately. Preserve
  the primary journey error independently from preservation errors; never fail an
  unrun J5. Do not weaken journey assertions or change product ID/correlation semantics.
- Allowed documentation/evidence writes: this SPEC and
  `manual-loops/architecture/end-to-end-evaluation-recovery/**`. Append only fresh
  UUID artifacts under existing `end-to-end-evaluation/evidence/t02/playwright/`,
  plus a new invocation record in the captured identity directory. Never overwrite
  predecessor records. Dependency installation may update generated node_modules
  only, frozen and without lifecycle scripts.
- Regression may create tiny fresh UUID directories/sentinels in the actual fixed
  Playwright evidence root, retain them, and run bounded local config/CLI processes.
  No browser/network/API/credential reading in this regression. Minimize child env;
  never inherit TEST_WORKER_INDEX or auth inputs. Preserve all existing assertions.
- Keep UUID/path checks on every config evaluation; gate only the existing-directory
  collision check by coordinator versus worker. Missing/empty/whitespace run IDs
  currently generate a UUID: preserve that behavior. Nonempty malformed inputs
  still fail in both modes. No config exports or helper layers unless essential.
- TEST_WORKER_INDEX is not a security credential. The unchanged wrapper's child
  env excludes ambient worker markers; it is the only authorized mutating entry
  point. Direct CLI callers are not claimed to be adversary-proof.
- Secrets remain in memory/private credential file. No raw API payload, password,
  JWT, cookie, page snapshot, HAR, trace, video or credential output. Existing
  PLAYWRIGHT_NO_COPY_PROMPT=1 and sanitized harness failures remain unchanged.
- Runtime uses only approved local gateway/console and acme. The private identity
  file is `/private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json`.
  Do not display/read its contents in agent tools; unchanged runner verifies and
  reads it privately. Captured user `66fe31e6-14eb-45b7-9fd1-5fa67cf50ce9`, role
  `7c80824d-0cc9-4812-b68d-e4d6b199597f`, empty permissions.
- G4 must show zero role/user creates, at most one same-user reactivation, one
  child invocation, one final deactivation, owned GET404/list absence/newlogin401,
  exact retained owned role and unchanged preexisting user/role hashes. PATCH404
  alone is insufficient; no stateless JWT revocation claim. No identity-file deletion.
- Every gate runs verbatim after final QA; first failure stops the attempt.
  Report unavailable prerequisites and every fallback/retry. Rerun invalidated
  gates/reviews after changes. No second coordinator or self-review.
- New report is evidence of observed state, never a claim of product certification
  or successful journeys based on readiness alone. Report-only evidence updates
  after runtime require G0 and report acceptance again; implementation/contract
  changes require all applicable gates again.

## Runtime journey contract

First runtime slice is deliberately seven application images: **auth-service,
api-gateway, provisioning-service, channel-service, workflow-service,
tracking-ingester-service, admin-console**, plus their existing shared packages.
It relies on existing tenant-service, audit/usage workers, PostgreSQL, NATS,
Redis and Temporal. Do not rebuild the whole platform implicitly. Dependency
imageIDs are recorded; a dependency defect requires scope expansion.

| ID | Observable acceptance | Services / writes |
| --- | --- | --- |
| J1 Access | Anonymous navigation to `/workflows` redirects to `/login`; login renders dashboard and workflows from real API data. Missing token is 401; tenant-mismatched token is rejected (401/403), never another tenant's records | console → gateway → auth, workflow. Login/session/audit effects only; use existing acme operator credentials supplied securely at execution |
| J2 Provision | Fresh uniquely named manifest validates; initial plan creates exactly one HTTP inbound channel, one local e2e-tests outbound sink and one workflow. Apply resolves refs; same-content second plan/apply produces no extra resources and stable IDs. Invalid symbolic ref fails without partial creation; invalid schema returns `valid:false` | provisioning → channel/workflow; store only owned manifests and resources, no secrets fixtures |
| J3 Execute | Synthetic nonce sent to owned HTTP webhook starts owned Temporal workflow, computes a deterministic jsFunction result, chooses the expected conditional branch and sends only to owned e2e-tests sink. Terminal completion, result and emitted nonce agree | gateway/channel → NATS → workflow/Temporal → channel sink; owned executions/events only. No connector, hosted-service, LLM or real messaging call |
| J4 Toggle | Disable only owned definition; require positive trigger-refusal evidence and no new owned execution for a second nonce within 120s. Reenable, send third nonce, await completion within 120s. Existing definitions/executions remain untouched | workflow status mutation only on captured owned ID. No termination test of preexisting runs |
| J5 Diagnose | Open evaluated workflow and `/processes/trace/:correlationId`, then `/processes/runs/:workflowId/:runId` in built console. IDs match API; completed run and step spans appear; causal links resolve or discrepancies fail. Synthetic payload contains nonce; unknown event gives 404; token without payload permission is denied. No real payload content captured | console/gateway/tracking; GETs plus normal access-audit effects; scoped synthetic payload only |

The existing isolated harness consists of:
`e2e/platform-evaluation.spec.ts` and `e2e/platform-evaluation.config.ts`, using
installed `@playwright/test`, existing canonical types and endpoint contracts.
Do not modify existing tests or run the existing broad Playwright sales suite.
The dedicated config uses only this file, one worker, zero retries, no webServer,
no network mocks, no stored login state and no trace/HAR/video recording of tokens.
Screenshots remain disabled; machine-readable output must
redact credentials and payloads. Explicit case labels J1–J5 and test discovery
prevent an empty suite from passing. Failure stops the attempt, retaining fixtures.

Generate one UUID run ID in the harness shell; prefix every name with
`eval-e2e-` plus that ID, abort on any preexisting collision, record exact created
IDs and compare preexisting definition/channel IDs and content hashes before/after.
Never mutate objects found by name/prefix alone. Retain all created resources and
failure evidence: no DELETE, undeploy, sweep, TTL scrub or implicit cleanup. Only
the owned workflow status may be toggled; leave it disabled after evidence capture
so retained fixtures cannot react to later traffic. On success or failure a
`finally` safety action may best-effort disable only the captured owned workflow
ID; this is the sole action allowed after first failure. Record its response and
any inability to disable, retain the original failure, and report the still-active
fixture. Never disable a preexisting definition or delete any fixture. Maximum per attempt: two
channels, one workflow, two stored manifests (valid + invalid-reference case),
three synthetic ingress messages. Invalid reference case must plan-fail before
apply. No fixture reset between retries; every attempt gets a fresh run ID.

J1/J5 reuse the existing restricted identity through the wrapper. No new identity
is permitted. An unknown-tenant rejection does not prove full isolation.

## Gates

Run from repository root with `/bin/bash -o pipefail`, in listed order. Record
commands, outputs, statuses, durations and state hashes under recovery evidence.
G0/G1/G2 are iteration gates; G2b/G3/G4 are built-image commit gates even though
commits are forbidden. Gate identifiers deliberately match the predecessor.
No dev-mode iteration is needed for this harness/config-only fix. Do not invoke the
mutating validator, deps, stock e2e suites, resets or broad rebuilds. This is
explicit applicability, not an unrecorded skip of a failed gate.

G1 requires OrbStack running, current context orbstack, node Ready, ten PVCs Bound
and unchanged metadata.uid/spec.volumeName. G2 requires host Node v26.7.0, pnpm
11.6.0, Bun1.3.1, unchanged lock SHA256 and frozen installation. Stop on version
drift; no global fixes. Before G3 confirm no concurrent source-mount dependency.
G2b derives only digest bases, pnpm11.6.0, frozen install and version output from
original Dockerfiles; retain diffs/full logs. Cache reuse must be labeled cached.
Each new attempt receives a fresh recorded build evidence directory before run.
G3 must end dev-modeOFF, no sourcehostPath on live workloads, allcurrentreplicas
Ready, selectedsevenbuiltRepoDigests matchingtencontainers, tenPVCpairs preserved,
and scrub suspendedactive0. Historicalzeroreplica revisions are preserved/excluded.

### G0

```bash
./scripts/checks/doc-code-guards.sh
git diff --check
```

### G1

```bash
orb status
docker --context orbstack version
kubectl config current-context
kubectl --context orbstack --request-timeout=10s get nodes -o wide
kubectl --context orbstack --request-timeout=10s get pvc -A
kubectl --context orbstack --request-timeout=10s get ksvc,deploy,cronjob -n platform-services-dev
kubectl --context orbstack --request-timeout=10s get pods -n platform-services-dev -o json | jq '[.items[] | {name:.metadata.name,images:[.status.containerStatuses[]? | {name,image,imageID,ready}]}]'
```

### G2

```bash
node --version
pnpm --version
bun --version
shasum -a 256 pnpm-lock.yaml
pnpm install --frozen-lockfile --ignore-scripts
shasum -a 256 pnpm-lock.yaml
```

```bash
(cd services/api-gateway && bun run test:unit)
(cd services/provisioning-service && bun run test:unit)
(cd services/channel-service && bun run test:unit)
(cd services/workflow-service && bun run test:unit)
(cd services/workflow-service && pnpm exec tsc --noEmit --incremental false -p tsconfig.json)
pnpm exec playwright test --config e2e/platform-evaluation.config.ts --list
node --check e2e/platform-evaluation-runner.mjs
node e2e/platform-evaluation-runner.mjs --self-test
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck e2e/platform-evaluation.spec.ts e2e/platform-evaluation.config.ts e2e/platform-evaluation-state.ts
```

```bash
node --test e2e/platform-evaluation-config.test.mjs
node --test e2e/platform-evaluation-state.test.mjs
```

### G2b

```bash
python3 - <<'PY_BUILD'
from pathlib import Path
import subprocess, re, json, hashlib
services = ['auth-service', 'api-gateway', 'provisioning-service', 'channel-service', 'workflow-service', 'tracking-ingester-service', 'admin-console']
base = Path('manual-loops/architecture/end-to-end-evaluation-recovery/evidence/build-attempt-4')
base.mkdir(parents=True, exist_ok=False)
lock = hashlib.sha256(Path('pnpm-lock.yaml').read_bytes()).hexdigest()
resolved = {}
for svc in services:
    original = Path('services', svc, 'Dockerfile').read_text()
    assert original.count('pnpm install --ignore-scripts') == 1, svc
    derived = original.replace('pnpm install --ignore-scripts', 'pnpm install --frozen-lockfile --ignore-scripts')
    derived = derived.replace('corepack enable pnpm &&', 'corepack enable pnpm && corepack prepare pnpm@11.6.0 --activate && node --version && pnpm --version &&')
    lines = []
    for line in derived.splitlines():
        match = re.match(r'FROM (\S+)(.*)', line)
        if match and (':' in match[1] or '/' in match[1]):
            ref = match[1]
            if ref not in resolved:
                subprocess.run(['docker', '--context', 'orbstack', 'pull', ref], check=True)
                digests = json.loads(subprocess.check_output(['docker', '--context', 'orbstack', 'image', 'inspect', ref, '--format', '{{json .RepoDigests}}']))
                assert digests, ref
                resolved[ref] = digests[0]
                (base / 'base-images.json').write_text(json.dumps(resolved, indent=2))
            line = 'FROM ' + resolved[ref] + match[2]
        lines.append(line)
    target = base / ('Dockerfile.' + svc)
    target.write_text('\n'.join(lines) + '\n')
    command = ['docker', '--context', 'orbstack', 'build', '--progress=plain', '-t', 'dev.local/' + svc + ':local', '-f', str(target), '.']
    print(json.dumps({'service': svc, 'command': command, 'lockSha256': lock}), flush=True)
    subprocess.run(command, check=True)
assert hashlib.sha256(Path('pnpm-lock.yaml').read_bytes()).hexdigest() == lock
PY_BUILD
```

### G3

```bash
test "$(kubectl config current-context)" = orbstack
./dev-mode.sh agent-admin-service off --overlay postgres-dev
./dev-mode.sh agent-ai-service off --overlay postgres-dev
./dev-mode.sh agent-memory-service off --overlay postgres-dev
./dev-mode.sh agent-scheduler-service off --overlay postgres-dev
./dev-mode.sh api-gateway off --overlay postgres-dev
./dev-mode.sh channel-service off --overlay postgres-dev
./dev-mode.sh provisioning-service off --overlay postgres-dev
./dev-mode.sh registry-service off --overlay postgres-dev
```

```bash
test "$(kubectl config current-context)" = orbstack
./rebuild-redeploy.sh auth-service dev --deploy-only
./rebuild-redeploy.sh api-gateway dev --deploy-only
./rebuild-redeploy.sh provisioning-service dev --deploy-only
./rebuild-redeploy.sh channel-service dev --deploy-only
./rebuild-redeploy.sh workflow-service dev --deploy-only
./rebuild-redeploy.sh tracking-ingester-service dev --deploy-only
./rebuild-redeploy.sh admin-console dev --deploy-only
bash scripts/smoke-test.sh
kubectl --context orbstack -n platform-services-dev rollout status deployment/tracking-ingester-worker --timeout=180s
kubectl --context orbstack -n platform-services-dev rollout status deployment/connector-runtime-http --timeout=180s
kubectl --context orbstack -n platform-services-dev rollout status deployment/connector-runtime-invoke --timeout=180s
```

### G4

```bash
node e2e/platform-evaluation-runner.mjs --identity-file /private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json
```

## Task queue

### R01 — Correct worker reload and harness contracts; repeat bounded evaluation

- Allowed paths and non-goals are exactly the Constraints above.
- Read baseline config, actual installed Playwright WorkerHost/deserializeConfig
  sequence, AGENTS and shared role contract before writing. Do not edit libraries.
- Preserve the completed coordinator-versus-worker collision check and regression that
  exercises the actual config-loading path, not a copied predicate: fresh
  coordinator succeeds, coordinator collision rejects without modifying sentinel,
  worker reload accepts same directory and exact outputDir, malformed UUIDs fail
  in both modes, empty/absent IDs preserve UUID generation. Verify unchanged
  workers=1, retries=0, testMatch and privacy settings. Bound child lifetime.
- QA cases were received before implementation on 2026-09-07. Two authoring
  clarifications preserve existing behavior: empty run ID generates; actual-config
  sentinel directories use its fixed predecessor root with fresh UUIDs. Regression
  may not change that root just to fit its test.
- Run gates in order, reusing exact retained identity. Record each J1–J5 result,
  retained fixture IDs, final deactivation/disabled workflow and preservation,
  versions/builddigest correspondence and limits in recovery/runtime-report.md.
- Implement the approved identifier/capture/error amendment in Constraints. Add
  pure data regressions for two UUID channels plus Nano ID definition, Nano ID
  execution, malformed per-kind IDs, duplicate/wrong names or kinds, captured
  writes despite invalid counts, partial409, and primary J2 plus preservation
  failure retaining J5 pending. Keep runner/config/product frozen.
- Any defect outside these explicit corrections requires a scoped human decision
  before editing. Do not broaden R01 or weaken journey assertions.

**Accept:** G0–G4 green, actual J1–J5 allpass with zero skipped cases; regression
passes and preservation evidence complete. Two independent Astra APPROVED reviews
cover entire existing harness/runner plus config regression, recovery artifacts
and current gate state; distinguish inherited artifacts from recovery changes.
The report must include these exact headings and case IDs:

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
text = Path('manual-loops/architecture/end-to-end-evaluation-recovery/runtime-report.md').read_text()
for h in ['Commands', 'Build provenance', 'Image identities', 'Journeys', 'Retained fixtures', 'Data preservation', 'Defects', 'Limits']:
    assert '## ' + h in text, h
for case in ['J1', 'J2', 'J3', 'J4', 'J5']:
    assert case in text, case
print('Recovery report structure complete')
PY_CHECK
```

## Progress

- Achieved: worker reload recovery and bounded runtime execution reached J1/J2 success.
- Remaining: J3 runtime success and the original product evaluation.
- Blocked: J3 failed; the recovery budget is exhausted.
- Attempts: R01 4/4 exhausted; predecessor T02 remains 4/4 exhausted.
- Validation: J1/J2 and final preservation passed; J3 failed; no completion reviews exist.
- Evidence: detailed packet retired by Chris on 2026-09-09; see end-to-end-evaluation-recovery/SUMMARY.md.

## Out of scope

All product fixes, identity creation, global/tooling audits, T03/T04, archive
reorganization and cleanup. No deletion of manual-loops or retained fixtures.

## Human boundaries

This bounded SPEC is approved as above. A different bug or wider change requires
a concrete scope decision. No commit/push, newidentity, destructiveapply or
externalproductcall is authorized. Stop at exhaustedattempts or repeatederror.
