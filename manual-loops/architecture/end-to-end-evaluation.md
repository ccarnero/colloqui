# SPEC — Platform-cluster end-to-end evaluation

> Status: BLOCKED — T01 complete; T02 exhausted four attempts after G4 harness startup failure. T03/T04 not started.
> Origin: Chris's scope and placement decisions, 2026-09-07.
> Engram topic: `platform-cluster/end-to-end-evaluation`.
> Engine: [shared manual-loop procedure](../../DOCS/guides/manual-loop.md).

## Goal

Establish whether a new agent can understand platform-cluster's purpose and
features, operate representative product journeys, and deliver one small real
change through the existing workflow. Use that evidence to propose which
manual-loop records to keep active, preserve as history, or delete.

## User decisions

- Evaluate platform-cluster only, using the loops and roles as configured.
- Do not audit or redesign personal tooling, providers, models, or global setup.
- Begin with read-only discovery and environment inspection in the next session.
- Use built images with dev mode off for the runtime baseline and final proof;
  use dev mode only on affected services during an approved change.
- Preserve data and historical evidence. Propose cleanup before any deletion.
- Keep context, the task queue, and execution evidence attached to this SPEC.

## Draft preparation and approval boundary

Preparation is complete as a source-backed plan, not an evaluation result. No
T01–T04 task has run. Approval permits the task scopes below; prerequisites remain
mandatory. In particular, T02 cannot claim a current-source built-image result
until G2b discharges B1, and T03 requires a second approval of a finding-specific
change. Do not infer approval from elapsed time or from this file being edited.

Only this SPEC was edited during preparation. The existing loop-index modification
is preserved. No application login, fixture creation, build, seed, restart,
dev-mode toggle, test suite, or cleanup was performed.

## Read first

1. [AGENTS.md](../../AGENTS.md): current normative contract. Root
   [CLAUDE.md](../../CLAUDE.md) forwards to it.
2. [Shared delivery engine](../../DOCS/guides/manual-loop.md) and
   [role contracts](../../DOCS/guides/agent-roles.md).
3. [README](../../README.md), [documentation map](../../DOCS/README.md),
   and [dev-mode guide](../../DOCS/guides/dev-mode.md).
4. [Loop inventory](../../manual-loops/README.md),
   [additional queue](../../PENDIENTES/README.md), and
   [SPEC authoring contract](../../manual-loops-templates/README.md).

Treat this reading list as navigation; the shared engine remains authoritative.

## Baseline and prior context

Repository: `/Users/chris/sources/yoizen/platform-cluster`.
Observed HEAD: `3fe4263c` — `chore: align delivery and fix workflow safety`.
The working tree was clean before the original handoff was created. Recheck this
repository before acting and preserve changes made since the snapshot.
The original untracked handoff has been replaced by this draft SPEC and its
loop-index entry. No commit or push was requested.

## Scope clarification

Use the delivery workflow and roles as currently configured. Evaluate their
application to platform-cluster by doing real product work; do not reopen the
design of the agent setup. Personal tooling repositories, global configuration,
provider catalogs, authentication portability, and model selection are outside
this evaluation. If an unavailable capability blocks a required handoff, record
the blocker and report it without turning the task into a tooling audit or repair.

## Delivery decisions to preserve

- The assistant in the active conversation is the principal coordinator. A role
  name in a prompt is not evidence that a separately configured agent ran.
- The shared manual-loop engine owns sequencing, retries, gates, and closure.
  Global FP roles supply specialist duties; they do not start a competing loop.
- QA defines acceptance before implementation; development owns behavior and
  regression tests; QA validates before final gates and two independent reviews
  of the same unchanged state. Architecture advice is conditional.
- Use the active session's configured roles and model policy. Record actual
  role/run/model provenance and unavailable capabilities as required by AGENTS.md;
  do not infer successful delegation from role names or configuration alone.
- Preserve this repository's approved frameworks, dependency restrictions, and
  functional-core/imperative-shell boundary. No architecture migration follows
  from this evaluation.

## Product reconstruction and evidence

The product lets tenant operators connect incoming messages and business systems,
automate handling through workflows and AI agents, and diagnose each execution in
an operational console. Integrators configure it through authenticated APIs, SDKs
and declarative manifests; platform operators manage tenant identity and resources.
This purpose/persona synthesis is an inference from the implementation and docs,
not a claim of customer validation.

Source paths below are repository-relative. “Implemented” means source exists;
none of these behaviors has been certified live by this preparation.

| Capability | User outcome and implementation evidence | Evaluation coverage |
| --- | --- | --- |
| Tenant identity and access | Tenant-scoped JWT and console login; `services/admin-console/src/app/app.routes.ts`, `services/api-gateway/test/unit/auth.guard.spec.ts`, `services/api-gateway/test/unit/tenant-resolution.util.spec.ts` | J1; mismatch/anonymous rejection, not a complete isolation audit |
| Channel ingress/egress | HTTP and Telegram normalize messages; test sink accepts synthetic outbound messages; `DOCS/channels/telegram-sequence.md`, `scripts/e2e/http-workflow.sh` | J3 HTTP + local sink; Telegram unverified |
| Workflow automation | Definitions, triggers, conditionals, execution lifecycle and Temporal orchestration; `services/workflow-service/src/modules/workflows/workflows.controller.ts`, `DOCS/workflows/engine.md` | J3/J4; no exhaustive action matrix |
| Declarative integration | Validate/store/plan/apply manifests and resolve resource references; `services/provisioning-service/src/modules/manifests/manifests.controller.ts`, `scripts/e2e/manifest-apply.sh` | J2 owned channel/workflow resources; no undeploy |
| External/internal connections | HTTP connectors, hosted services, direct invocation and recent-call diagnostics; `scripts/e2e/connector-invoke.sh`, `DOCS/architecture/overview.md` | Source map only in first runtime slice; no PokeAPI calls |
| AI agents | Configure/publish agents, execute asynchronously or stream, use tools/memory/knowledge; `DOCS/agents/execution.md`, `DOCS/agents/memory.md`, `sdk/test/e2e/runtime-stream.e2e.ts` | Source map only; mock echo in stock suite is not real LLM proof |
| Scheduling | Cron/interval agent jobs and console schedules; `DOCS/agents/jobs.md`, `services/admin-console/src/app/app.routes.ts` | Source map only; no scheduled job activation |
| Knowledge and memory | Knowledge bases, structured KB, skills and memory approval/retrieval; `DOCS/skb/architecture.md`, `DOCS/agents/memory.md`, console routes | Source map only; no semantic-quality claim |
| Operational diagnosis | Trace, causal chain, workflow run and guarded payload access; `scripts/e2e/http-workflow.sh`, `services/api-gateway/test/unit/tracking-payload-guard.spec.ts`, console routes | J5 using this run's synthetic data |
| Audit/usage/platform operations | Audit persistence, usage aggregation, registry and tenant provisioning; `DOCS/architecture/overview.md`, `services.conf` | Dependencies inventoried; billing screen is not proof of payments/billing correctness |

Documentation is navigation, not a substitute for code. For example, the overview
contains older illustrative event-publishing flows; AGENTS.md's activity-only
workflow effects and canonical envelope remain binding. PENDIENTES and checked
historical loops are leads, not a fresh list of proven defects or shipped behavior.

## Read-only OrbStack preflight — 2026-09-07

| Observation | Actual evidence / limit |
| --- | --- |
| Source | HEAD `3fe4263c0d99cdccffa22153faf1f2057906bd8f`; only preexisting modified `manual-loops/README.md` and untracked target SPEC |
| Baseline ownership | Loop-index SHA256 `3b65040da5b360a7d30e1d64a18d4f61c0b2508af3b5ea75117aadabe84474d9`; preserve its seven added lines |
| First attempt | Sandboxed `orb status` reported `Stopped`; Docker socket permission denied, Kubernetes localhost connection operation not permitted. Those failures did not establish cluster absence |
| Read-only retry | Outside sandbox: `orb status` → `Running`; Docker server 29.4.0; `kubectl --context orbstack --request-timeout=5s get nodes -o wide` → one Ready node, Kubernetes v1.35.6+orb1, exit 0. No start command was issued |
| Context/resources | Current Docker and Kubernetes contexts both `orbstack`; Docker reports 14 CPUs, 33,671,614,464 bytes memory (about 31.36 GiB), not measured free headroom |
| Workloads | 18/18 Knative services Ready; 60 pods across all namespaces Running; 11 plain platform worker Deployments 1/1. Readiness is not behavioral acceptance |
| Existing data | `acme-dev-ns` and its `sample-echo` workload exist. Ten PVCs Bound: dev-mode-deps 6Gi; NATS 2Gi; legacy Postgres 2Gi; Redis 256Mi; shared Postgres 20Gi; Temporal 10Gi+2Gi WAL; visibility 3Gi+1Gi WAL; usage Postgres 20Gi. No DB rows, payloads or secret values read; no backup/restore certification |
| Retention | `tracking-payload-scrub` CronJob suspended, zero active jobs. Keep suspended; no scrub/reset/teardown |
| Dev mode | Eight live ksvc annotated true with Bun image: agent-admin-service, agent-ai-service, agent-memory-service, agent-scheduler-service, api-gateway, channel-service-api, provisioning-service, registry-service. Two plain workers (agent-admin-service-worker, channel-service-worker) also annotated true, despite carrying dev.local image tags. Historical zero-replica revisions also have annotations; do not count those as live services |
| Built-image evidence | Workflow API + both workflow workers run `dev.local/workflow-service` digest `023e31d2fcde44b8d3d53afeb80ed4822e60c80913ebfaccaae658e1bf9907ff`; console digest `1c0bf478469357a4c6d57bc1ff269547e169c3eab8fe7cec55bd23a3dad82392`; tracking digest `96f93e8e25b18c4a9beb439ee3eb231108794b562b07156e992bb42ba83d95fb`. These identify observed artifacts, not their correspondence to HEAD |
| Dependency state | Host Bun 1.3.1, Node v26.7.0, pnpm 11.6.0, bash 3.2.57; Dockerfiles use Bun 1.3.14 and Node 24 tags. Host runtime differs. Lock SHA256 `edf298f7be61b797430cdd6edb41ebe920e142239afd24e00baf1f6bcab83a68` matches live ConfigMap `dev-mode-state.data.lockSha`; matching hash does not prove correct install output |
| Tools | orb/docker/kubectl/bun/pnpm/node/jq/helm/kustomize/python3/fd/yq found. Browser binary and frozen dependency install not tested |
| Query corrections | First ConfigMap projection used nonexistent `lockfile-sha`, returned null; corrected to actual `lockSha`. One Ready-count jq filter failed compilation (exit 3); corrected read-only retry returned `{total:18,ready:18}` (exit 0). Large discovery output was truncated; focused reads supplied the decisions recorded here |

Successful elevated inventory commands (exit 0) were `get ns`, `get pvc -A`,
`get ksvc,deploy,cronjob -n platform-services-dev`, `get pods -A -o wide`, and
projected JSON queries of pod imageIDs and dev-mode annotations, all with explicit
`--context orbstack --request-timeout=10s`. No credentials or full workload env
were printed. T01 captures a fresh sanitized inventory with full output/status.

## Selected journeys and runtime contract

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

The new isolated harness is proposed as T02 scope, not claimed to exist today:
`e2e/platform-evaluation.spec.ts` and `e2e/platform-evaluation.config.ts`, using
installed `@playwright/test`, existing canonical types and endpoint contracts.
Do not modify existing tests or run the existing broad Playwright sales suite.
The dedicated config uses only this file, one worker, zero retries, no webServer,
no network mocks, no stored login state and no trace/HAR/video recording of tokens.
Screenshots may show only owned synthetic records; machine-readable output must
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

J1/J5 require a real restricted credential for the payload-denial check. The
approved test-identity amendment below permits one dedicated user and role;
existing user/role changes remain forbidden. Missing valid credentials block that
case. An unknown-tenant rejection does not prove full two-tenant isolation.
API/browser responses are evidence only after images and auth prerequisites pass.

## Inspected command hazards and execution blockers

- **B1 — build reproducibility:** repository Dockerfiles do not explicitly freeze
  installs or pin pnpm/base digests. G2b proposes an isolated derived-build recipe
  using existing Dockerfiles, pnpm 11.6.0, frozen lockfile and resolved base digests.
  Approval of this SPEC includes that exact recipe and its generated evidence
  paths, not production Dockerfile/global configuration edits. Failed installation
  or build blocks T02; do not relax the lock, switch runtime or silently fall back
  to preexisting images. The original Dockerfiles remain a documented limitation.
- **B2 — built baseline:** eight logical services currently use dev mode. The
  scoped restoration commands below affect those live workloads (including agents
  outside the selected behavior slice), so this effect is part of approval. They
  restore overlay defaults/last-built images, not a snapshot of arbitrary live
  overrides. T01 must compare safe projected fields first and report unexpected
  drift before changing anything. No automatic fallback to stale images as proof.
- **B3 — stock E2E isolation:** `http-workflow.sh` has fixed manifest/agent names,
  applies shared `e2e-prerequisites`, calls PokeAPI and sweeps old prefixes on exit.
  `E2E_KEEP=1` stops cleanup, not shared writes. `connector-invoke.sh` deletes by
  prefix before its run even with KEEP; cache suite sweeps consumers and overwrites
  a broad Redis SCAN-diff with sentinels. `manifest-apply.sh` has automatic cleanup
  with no KEEP guard. These are not authorized gates for preserved data.
- **B4 — dev validator:** `validate-dev-mode.sh --with-e2e` writes/restores
  `services/workflow-service/src/main.ts`, toggles cluster workloads and invokes
  the stock HTTP suite. It is not a read-only preflight. No T02 dev iteration is
  needed for a browser harness; T03 must scope safe validator prerequisites and
  canary ownership when its change is chosen. If unmet, record iteration DEBT;
  built-image proof remains mandatory. The guide records a readiness-barrier fix
  after the older AGENTS historical race note; do not assume either a failure or
  successful restoration without running the authorized validator.
- **B5 — role provenance:** native `fp-qa` launch is not exposed in this interface;
  preparation used a subagent carrying the repository QA packet. Inherited model
  was requested, no override; exact resolved model was not independently exposed.
  This is QA advice, not verified model provenance or independent review approval.
  Execution requires actual identities for dev/QA/reviewers, reviewers no weaker
  than implementer; missing evidence blocks closure. Do not repair personal tooling.
- **B6 — credentials/browser:** credentials, restricted payload access, and
  Playwright browser executable availability remain untested. No secret inspection,
  credential reset or browser download occurred during preparation.

`bootstrap-orbstack-osx.sh`, `scripts/orbstack/startup.sh`, `setup-tenant.sh`,
`rebuild-changed.sh`, full SDK E2E, `scripts/e2e/run-all.sh`, reset scripts and the
sales-agent browser suite are excluded. Bootstrap applies infrastructure and host
configuration; startup also seeds and runs E2E. Existing acme data must survive.
No new tenant or DB engine switch is authorized; Mongo runtime parity is unverified
unless T03 touches dual-engine persistence and expands its approved evidence.

## Approved test-identity amendment — 2026-09-07

Chris confirmed no restricted test user exists and explicitly approved creating
one dedicated user and one dedicated role in acme, then deactivating that user
and retaining the records. This supersedes the earlier existing-credential-only
B6 boundary; earlier blocked Progress entries remain historical evidence.
No further approval is required for this bounded setup.

- Add only `e2e/platform-evaluation-runner.mjs` as a T02 implementation path;
  the existing two harness paths and runtime-report path remain allowed. No
  production source, dependency, global configuration or existing test changes.
- Use existing public auth APIs on the exact approved local gateway, tenant acme.
  Create at most ONE uniquely named role with empty permissions and ONE uniquely
  named tenant user with that captured role ID. Use a reserved `.invalid` email,
  random password and UUID prefix; abort collisions. No outbound email or external
  integration, account reset, existing user/role mutation, or record deletion.
- Read only E2E_EMAIL/E2E_PASSWORD from `scripts/e2e/.env` using a data parser,
  never shell sourcing or wholesale environment import. Authenticate normally;
  require tenant:acme admin scope/role, and verify the existing system role before
  user creation so implicit system-role seeding cannot create an extra role.
- Snapshot preexisting user/role IDs and complete safe semantic hashes, including
  role permissions, in memory; persist only IDs/hashes. Capture owned IDs from
  create responses. Record every owned mutation and status immediately. On
  ambiguous write failure, stop without retrying creation or adopting by name.
- Obtain the restricted JWT by normal login. Require tenant:acme, the captured
  user/role identity, no wildcard or tracking:payload:read permission, and a valid
  authenticated read. Supply credentials only through the child environment to
  the unchanged inner Playwright command. Never fabricate or edit a JWT.
- The wrapper owns finally-deactivation by captured user ID using PATCH
  `is_active:false`, even if G4 fails. Verify the API's inactive-user behavior
  and denied fresh login. Existing JWT immediate revocation is not assumed.
  Preserve primary failure and record inability to deactivate separately.
- Retain the user and role. To permit reuse of this single identity after a
  failed test, save only its newly generated password and captured identity in
  an exclusively created mode-0600 file named
  `/private/tmp/platform-evaluation-identity-<uuid>.json`. Never store administrator
  credentials or JWTs there, or any secret under repository/evidence paths.
  Open private-file reads and updates with no-follow semantics and verify the
  same descriptor is regular, owned by the current user and mode 0600. Bind its
  UUID, names, marker, captured IDs and lifetime creation counters before use.
  An explicit `--identity-file` resumption may reactivate only that same captured
  dedicated user for the next run and must deactivate it again on exit; never
  silently create a second identity. No credential file is deleted automatically.
- Sanitized identity evidence lives under
  `manual-loops/architecture/end-to-end-evaluation/evidence/t02/identity-<uuid>/`,
  with unique per-invocation records; preserve prior evidence. The wrapper must
  reject unexpected URLs, redirects, malformed identities and unsafe secret-file
  permissions/ownership. No sensitive response or raw error body is printed.
- QA specifies setup/failure/preservation cases before implementation. Add the
  wrapper self-test to G2; the self-test performs no API/browser/filesystem effects
  and uses data cases for validation, identity selection and redaction boundaries.
  Preserve the existing J1–J5 assertions and fixture budget. The one auth identity
  is an explicit addition to that budget, not permission for broader seeding.
- Suppress Playwright automatic page snapshots through its local process flag
  `PLAYWRIGHT_NO_COPY_PROMPT=1`. Preserve all assertions, but convert final harness
  failures to sanitized stage/status messages before Playwright persists error
  context. No raw payload assertion values, locator call logs or credentials may
  reach reporter artifacts. No installed-library modification is authorized.

The outer G4 command is now `node e2e/platform-evaluation-runner.mjs`. Its inner
command remains the previously approved explicit local-URL Playwright invocation.
G4 succeeds only when both the journeys and finally-deactivation/preservation
checks pass. The current implementation attempt is 4 of T02, preserving the
four-attempt cap and all prior failures/evidence; it does not reset the loop.

## Constraints (apply to every task)

- AGENTS.md wins. Follow its context packet, existing role contracts, QA-before-
  implementation, regression-test ownership, gates, and dual-review requirements.
- Preserve preexisting work, current frameworks, data, and dependency decisions.
- Report unavailable capabilities without turning evaluation into tooling repair.
- Distinguish documented intent, implemented behavior, observed runtime behavior,
  and missing evidence. A checked historical task is not runtime certification.
- Record tool versions, frozen installation/build commands and outputs, source
  identity, deployed images, and dev-mode status for affected builds.
- Keep commands, statuses, evidence paths, actual agent/run/model provenance,
  retries, fallbacks, and review verdicts in Progress or linked evidence below.
- Every task receives these Constraints and its full scope/acceptance packet.

## Gates — concrete commands and applicability

Run from repository root, in order, one attempt at a time, after approval only.
Capture each command's separate exit status and sanitized output. First failure
stops the attempt. New harness gates become runnable only after fp-dev creates
those exact approved files and QA finalizes them; they are not existing commands
that were exercised in preparation. B1/B5 are evidence preconditions, never waivers.

### G0 — ITERATION, every task

```bash
./scripts/checks/doc-code-guards.sh
git diff --check
```

### G1 — environment precondition, T01 and before T02/T03 runtime

These reads do not change context or expose Secret/env data. Save their projected
outputs in the task report. Assert the context, node Ready and required PVCs Bound;
compare PVC UID/volume bindings to the pre-run snapshot. Namespace inventory is not
a proof that data content is unchanged.

```bash
orb status
docker --context orbstack version
kubectl config current-context
kubectl --context orbstack --request-timeout=10s get nodes -o wide
kubectl --context orbstack --request-timeout=10s get pvc -A
kubectl --context orbstack --request-timeout=10s get ksvc,deploy,cronjob -n platform-services-dev
kubectl --context orbstack --request-timeout=10s get pods -n platform-services-dev -o json | jq '[.items[] | {name:.metadata.name,images:[.status.containerStatuses[]? | {name,image,imageID,ready}]}]'
```

### G2 — T02 local checks, before runtime

Requires approved frozen install/tool evidence. Record exact tool versions and
`shasum -a 256 pnpm-lock.yaml` before and after. No lockfile update is permitted.
Host tool versions below are the observed preparation versions, not the image
runtime versions. Local suites provide fast feedback; G2b/G3/G4 establish the
built runtime separately. Approval permits generated dependency directories only
(`node_modules/`, `services/*/node_modules/`, `packages/*/node_modules/`), no
package/lockfile modification or lifecycle scripts. The exact local install is:

```bash
node --version
pnpm --version
bun --version
shasum -a 256 pnpm-lock.yaml
pnpm install --frozen-lockfile --ignore-scripts
shasum -a 256 pnpm-lock.yaml
```

Require Node v26.7.0, pnpm 11.6.0, Bun 1.3.1 for these host checks; a changed
version requires recording and reassessing the plan before running, not a global
install/downgrade. Frozen install failure blocks, with no lock regeneration.
Existing package commands verified by source inspection:

```bash
(cd services/api-gateway && bun run test:unit)
(cd services/provisioning-service && bun run test:unit)
(cd services/channel-service && bun run test:unit)
(cd services/workflow-service && bun run test:unit)
(cd services/workflow-service && pnpm exec tsc --noEmit --incremental false -p tsconfig.json)
pnpm exec playwright test --config e2e/platform-evaluation.config.ts --list
node --check e2e/platform-evaluation-runner.mjs
node e2e/platform-evaluation-runner.mjs --self-test
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck e2e/platform-evaluation.spec.ts e2e/platform-evaluation.config.ts
```

Test listing must include each J1–J5 case; no skip/fixme/only, no implicit browser
install. Workflow tsconfig includes source only, so that typecheck does not certify
its test files; unit execution and harness checks supply distinct evidence.

### G2b — T02 isolated frozen build, after G2 and before G3

This recipe is proposed for approval, not executed during preparation. It derives
seven Dockerfiles under the allowed T02 evidence directory; original Dockerfiles
are unchanged. Differences are only base-image digest resolution, pnpm 11.6.0,
explicit frozen install, and version output. Pin resolved base digests once per
attempt and retain them; do not silently substitute an image or relax the frozen
install if it fails. Record the derived diff alongside build logs for both reviewers.
Network effects are pulls from existing base-image/package registries, not product
integration calls. Builds are serial; no automatic retries or prune.

```bash
python3 - <<'PY_BUILD'
from pathlib import Path
import subprocess, re, json, hashlib
services = ['auth-service', 'api-gateway', 'provisioning-service', 'channel-service', 'workflow-service', 'tracking-ingester-service', 'admin-console']
base = Path('manual-loops/architecture/end-to-end-evaluation/evidence/t02/build-attempt-4')
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

The build output must show frozen installation, compiler/build success, tool
versions and resolved bases for every image. Retain full sanitized output, not
just the Python exit status. A failure preserves the directory; retry evidence
must be assigned a new explicitly recorded attempt directory in this SPEC before
rerun (never delete/overwrite failed evidence). This local recipe tests the
reviewed source with a documented build-input difference; it does not certify
that the unchanged repository Dockerfiles alone are reproducible.

### G3 — T02 built-image COMMIT GATE (required even with commits forbidden)

**Before these mutations:** B1 resolved and recorded, G1/G2 green, projected live
state compared with overlay, acme data untouched, no unrelated concurrent developer
session depending on source mounts. The requested final state is dev-mode OFF.
Do not execute `deps`, a validator, or an unrestricted rebuild as a shortcut.
Do not switch contexts concurrently: these scripts read the current kube context.
The assertion immediately before each mutation block must pass. Restoration is
limited to these eight logical services:

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

After the approved frozen/pinned build recipe produces the selected seven images,
use the existing deploy-only procedure, preserving storage and existing CronJobs:

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

The last three reads cover smoke-test's documented omissions. Require current
replicas Ready, selected pods' imageIDs matching the approved builds, no source
hostPath/dev-mode annotation on live targets, and suspended scrub CronJob. Record
all seven Docker image inspect Id/RepoDigests alongside Kubernetes imageIDs; a
`:local` tag alone is insufficient. Zero-replica historic revisions do not block.

### G4 — T02 behavioral COMMIT GATE, after G3

The approved identity wrapper supplies `E2E_EMAIL`, `E2E_PASSWORD` and the real
restricted-token input securely in the process environment; absent inputs fail, never use embedded
password defaults. It accepts only local URLs and `E2E_TENANT=acme`, with a unique
fixture run ID. Gateway URL uses existing ingress; no host or port-forward script
changes are needed. If ingress is unavailable, report before selecting another
transport. Dedicated config writes only the evidence directory allowed in T02.

```bash
node e2e/platform-evaluation-runner.mjs
```

Require all J1–J5 assertions, retained-resource ledger, zero secret leakage and
preexisting-resource comparison; a shell exit 0 with missing/skipped cases fails.
Budget: each asynchronous transition at most 120s, total harness at most 15 minutes
per attempt. Poll for conditions, not unbounded waits. No external product API/model cost;
local image/package downloads still consume network/storage. T03-specific tests,
build and applicable G-a/G-b commands must be added with the chosen change before
its approval. Do not fabricate service/test paths for an unknown defect.

### G5 — report structure/link acceptance, applicable report tasks

T01, T03 and T04 each run their own Accept block below plus G0. Reviewers verify
source claims and full content; file existence is necessary but not sufficient.
T04 additionally checks navigation links with this read-only scoped command:

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
import re
from urllib.parse import unquote
paths = [Path('manual-loops/README.md'), Path('DOCS/archive/INDEX.md'), Path('manual-loops/architecture/end-to-end-evaluation/cleanup-proposal.md')]
for p in paths:
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', p.read_text()):
        target = unquote(target.split('#', 1)[0].strip('<>'))
        if not target or '://' in target or target.startswith('mailto:'):
            continue
        assert (p.parent / target).exists(), (str(p), target)
print('Scoped navigation links resolve')
PY_CHECK
```

Two independent APPROVED reviews must cover the same final state and all staged,
unstaged and new files for each task. No preparation QA response counts as review.
No commit or push is authorized by this SPEC.

## Task queue

### T01 — Map the product and establish the safe runtime plan

- **Allowed write paths:** this SPEC and
  `manual-loops/architecture/end-to-end-evaluation/product-map.md`,
  `manual-loops/architecture/end-to-end-evaluation/environment.md`.
- **Non-goals:** runtime mutations, source changes, tooling audits, cleanup.
- Reconstruct intended users, problems solved, capabilities, and principal journeys
  from docs, routes, services, schemas, and tests. Link evidence for each claim.
- Inspect OrbStack availability, Docker/Kubernetes context, resources, existing
  workloads/data, tools, lockfiles, image identities, and dev-mode state. Chris
  intends to start OrbStack; do not assume it is running. Inspect bootstrap,
  rebuild and seed scripts before choosing safe commands and required services.
- **Accept:** source-backed feature map with uncertainty labels; environment and
  data-preservation report; bounded journey/service matrix. Run G0/G1 and the T01 report check below; reviewers check every feature/source
  claim and journey write boundary, and preserve explicit B1–B6 limits.

### T02 — Validate representative product journeys on built images

- **Allowed write paths:** this SPEC and
  `manual-loops/architecture/end-to-end-evaluation/runtime-report.md`.

  Additional exact paths: `e2e/platform-evaluation.spec.ts`,
  `e2e/platform-evaluation.config.ts`, and generated sanitized files under
  `manual-loops/architecture/end-to-end-evaluation/evidence/t02/`.
  Runtime mutations are exclusively J1–J5 and G3, after their preconditions.
  Original Dockerfiles, lockfiles and production source are not allowed write
  paths. Derived Dockerfiles are limited to the exact G2b recipe under evidence.
- **Non-goals:** data resets, blind full bootstrap/rebuild, production actions,
  historical rewrites, or assuming readiness is a passing user journey.
- Build the required services/dependencies from reviewed source using inspected
  procedures, preserve data, and record image/dependency evidence with dev mode off.
- Exercise selected UI/API/event/workflow journeys with identifiable fixtures;
  distinguish missing setup from product defects. Identify external credentials
  and any potential contact with real users before invoking integrations.
- **Accept:** actual commands, outputs, statuses, image identities, per-journey
  observed results and defects. G0–G4 and the T02 report check below must pass; no silent mocks, skipped cases
  or inferred image/source correspondence. B1/B5/B6 unresolved means BLOCKED.

### T03 — Prove one real delivery through the configured loop

- **Allowed write paths:** this SPEC and
  `manual-loops/architecture/end-to-end-evaluation/delivery-trace.md`.
  Source/test paths are not authorized yet; add the exact bounded change and
  obtain approval before implementation after a useful finding is selected.
- **Non-goals:** speculative features, broad refactoring, workflow redesign.
- Use the principal and configured specialist roles. QA defines acceptance,
  developer owns behavior/regression tests, QA validates before gates, and two
  independent reviewers judge the same unchanged final state.
- **Accept:** approved change scope, regression evidence, applicable tests and
  integration gates, final rebuilt images with dev mode off, actual provenance,
  both approvals, and recorded manual interventions/blockers. No full delivery
  success may be inferred from configuration or role names alone.

### T04 — Propose record cleanup and publish evaluation findings

- **Allowed write paths:** this SPEC,
  `manual-loops/architecture/end-to-end-evaluation/cleanup-proposal.md`,
  `manual-loops/README.md`, and `DOCS/archive/INDEX.md`.
- **Non-goals:** deleting records, rewriting historical decisions, closing
  unrelated work, or creating another competing work queue.
- Inventory loops plus relevant references from PENDIENTES, existing `.sdd/changes`,
  archives and normative docs. The old loop index is dated and partial; some loop
  files are reference/design contracts, not executable queues.
- Identify unique decisions/evidence, remaining work, incoming references, and
  successors. Propose keep-active / preserve-historical / delete for each record,
  with reasons and reference-repair requirements. Update existing navigation;
  add the archive register entry only for an actually completed evaluation.
- **Accept:** source-backed disposition proposal linked to product/runtime and
  delivery findings, preserved histories, valid references, and explicit unresolved
  work. Run G0/G5 and the T04 report check below. Cleanup itself needs
  a later approved scope. Include an inventory table covering every file returned
  by `rg --files manual-loops`, distinguishing this active evaluation and its
  generated evidence from historical/reference records.

## Task-specific report checks

Run only the corresponding task block after its artifacts exist. Reports use
these English headings so missing evidence is visible; assertions check structure,
not substantive approval. Sources are recorded as repository-relative paths in
backticks or resolving links. Every reported gate includes command, exit status,
output, state hash and applicable role/run/model evidence.

T01:

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
base = Path('manual-loops/architecture/end-to-end-evaluation')
for name, headings in {'product-map.md': ['Purpose', 'Features', 'Journeys', 'Sources', 'Uncertainty'], 'environment.md': ['Commands', 'Data preservation', 'Images', 'Prerequisites', 'Blockers']}.items():
    text = (base / name).read_text()
    for h in headings:
        assert '## ' + h in text, (name, h)
print('T01 report structure complete')
PY_CHECK
```

T02:

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
text = Path('manual-loops/architecture/end-to-end-evaluation/runtime-report.md').read_text()
for h in ['Commands', 'Build provenance', 'Image identities', 'Journeys', 'Retained fixtures', 'Data preservation', 'Defects', 'Limits']:
    assert '## ' + h in text, h
for case in ['J1', 'J2', 'J3', 'J4', 'J5']:
    assert case in text, case
print('T02 report structure complete')
PY_CHECK
```

T03 (additional finding-specific acceptance is still a human boundary):

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
text = Path('manual-loops/architecture/end-to-end-evaluation/delivery-trace.md').read_text()
for h in ['Approved change', 'QA cases', 'Implementation', 'Gate evidence', 'Model provenance', 'Independent reviews', 'Interventions', 'Limits']:
    assert '## ' + h in text, h
print('T03 trace structure complete; reviewers must verify actual delivery')
PY_CHECK
```

T04:

```bash
python3 - <<'PY_CHECK'
from pathlib import Path
base = Path('manual-loops')
p = base / 'architecture/end-to-end-evaluation/cleanup-proposal.md'
text = p.read_text()
for h in ['Findings', 'Inventory', 'Incoming references', 'Disposition', 'Unresolved work']:
    assert '## ' + h in text, h
for path in base.rglob('*'):
    if path.is_file():
        assert str(path) in text, str(path)
print('T04 inventory covers all current loop files')
PY_CHECK
```

Disposition must state keep-active / preserve-historical / propose-delete, unique
decisions/evidence, successor and reference repairs per record. Use references from
PENDIENTES, `.sdd/changes`, DOCS and source (`rg -n 'manual-loops/'` scoped to those
existing directories); preserve frozen histories. If T02/T03 blocks, the engine
stops there: do not check off T04 or add a completed-evaluation archive entry.

## Progress

- Achieved: T01 product map and runtime plan complete.
- Remaining: T02 built-image evaluation, T03 real delivery proof, and T04 findings.
- Blocked: T02 stopped after the G4 harness startup failure.
- Attempts: T01 1/4; T02 4/4 exhausted; T03 and T04 0/4.
- Validation: T02 did not complete; later recovery observed J1/J2 pass and J3 fail.
- Evidence: detailed packet retired by Chris on 2026-09-09; see end-to-end-evaluation/SUMMARY.md.

## Out of scope

Personal tooling repositories, global/vendor settings, provider/authentication
portability, model selection, service-wide architecture migrations, production
operations, and destructive data or historical-record changes.

## Human boundaries

- Approve this completed SPEC before its first run; draft preparation is not approval.
- Approve the specific useful change and source/test paths before T03 implementation.
- No data reset, PVC/database deletion, volume pruning, destructive bootstrap,
  manual-loop deletion, commit, push, or production operation is authorized here.
- Report required scope changes before editing. If an environment prerequisite
  is unavailable, continue independent read-only discovery and record the blocker.
