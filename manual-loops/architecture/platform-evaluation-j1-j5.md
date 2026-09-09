# SPEC — One bounded J1–J5 evaluation on current built images

> Status: A0 RECONCILIATION DRAFT — original scope approved; current input adjustments await human approval. No gates authorized by this draft.
> Origin: Chris requested this concrete SPEC on 2026-09-09.
> Engram topic: `platform-cluster/platform-evaluation-j1-j5`.
> Depends on: completed offline C01; historical runtime recovery remains blocked.
> Template: canonical. Engine: `DOCS/guides/manual-loop.md`.

## Goal

Observe all five original product journeys on newly built images of the current
reviewed source. Recheck J1/J2; their historical passes do not certify today's
environment. Produce an honest passed or blocked product result, with separate
journey, safety, preservation and verification outcomes. This is not original
T03 delivery proof, T04 findings completion, tooling certification or debt repair.

## Approval, admission and the single attempt

Writing this SPEC and its commands authorizes no build, test, runtime access,
identity operation or deployment. The human must approve this exact SPEC first.
After approval, principal must satisfy admission A0 below before any gate.

- Budget: ONE full task attempt, maximum ONE identity-wrapper invocation and ONE
  Playwright child. No retries, automatic corrections, repeated builds, repeated
  gate passes or second wrapper invocation. Playwright remains workers1/retries0.
- Admission is approval + proven role/provenance/cost capability + read-only
  repository reconciliation. An admission incompatibility is BLOCKED_NOT_STARTED,
  attempts0/1, wrapper0/1. No automatic admission retry or role substitution.
- Immediately before the first G0 command, persist `attempt-started.json` with
  exclusive creation. This consumes attempt1/1, even if the first command fails.
  Missing/refused runtime permission, tool/version drift, unavailable OrbStack,
  failed build/readiness or frozen install are PRE_EXECUTION_FAILURE: attempt1/1,
  wrapper0/1. They are not free preflight retries or evidence of product failure.
- Immediately before G6, record wrapper start once. A failure from wrapper launch
  onward is EXECUTION_FAILURE: attempt1/1, wrapper1/1 (child0/1 or1/1). Auth setup
  failures before J1 remain setup failures, not failed product journeys. Unknown
  launch/completion counts block; never replay an invocation to recover evidence.
- A failed postcheck or missing/rejected final review is VERIFICATION_FAILURE,
  not a new runtime attempt. Preserve observed journey results without certifying
  the task. No report correction that changes reviewed claims may trigger another
  run; return a concrete decision request instead.
- Existing bounded readiness/observation polling is one command's operation,
  not a gate retry. Poll only explicitly permitted transient convergence, with
  deadlines; command errors, preservation drift and unsafe state stop immediately.
- T02 original4/4, recoveryR01 4/4, offline repairT01 4/4 and compact-recordsT01
  4/4 stay exhausted. C01 is closed1/4. No unused/old budget transfers here.

## A0 — Role capability and provenance admission

Use native `fp-dev` and `fp-qa` (Sol/medium), `script-runner` (Luna/low), and two
independent `fp-reviewer` (Astra/high) roles. Dev performs read-only source/contract
assessment and blocked diagnosis; no implementation is authorized. QA supplies
acceptance before approval and freezes its coverage assessment before gates.
Principal coordinates; runner executes exact gates without diagnosis or retries.

Before G0, observe harmless native role invocations and verify the actual run,
turn, model and effort from task-scoped native session metadata. Requested pins,
agent names, self-reports and config files alone are insufficient. Record the
native source identifier and match it to the actual role run. Verify that two
reviewers can run independently and that their actual turns can be identified.
During execution, do the same for actual gate and review turns; probes never
substitute for final execution provenance. Never copy historical proof.

The approved project exception permits Luna at the economical coding tier, below
Sol. Confirm the applicable Codex-account cost basis before commands, not public
API prices or a historical rate assertion. No automatic model/provider fallback.
If the host cannot expose actual provenance or supply the native roles/cost basis,
STOP before G0 and present the incompatibility. Required decision: execute this
approved SPEC in a session that demonstrably exposes the required roles and native
provenance, or separately decide a normative policy change outside this SPEC.
Documenting the gap is not a waiver. Do not reopen compact-loop-records or repair
roles/config/lock/checker/guards here. A session transfer carries the single
attempt ledger; it does not reset consumed attempts.

Current-session observations are recorded in `platform-evaluation-j1-j5/active/preparation.md`
and `active/authoring-role-provenance.json`. Native QA/dev Sol/medium, runner
Luna/low, and two independent Astra/high reviewer turns have been observed.
Both reviewer threads were observed running concurrently. These are admission
observations, never final task approvals. The earlier authoring/admission packet
was retired and has not been recovered; its probe and seal claims are historical.
Applicable account billing remains pending explicit reconciliation. No gate may
run until that gap and approval of the current inputs are resolved.

## Approval seal and admitted tools

After the human approves the exact SPEC digest, principal creates
`active/approval-lock.json` containing `approvedSpecSha256` and a `files` mapping
of path to SHA256 for: this SPEC, authoring-baseline.json, preparation.md,
authoring-role-provenance.json, authoring-tools.json, and the final authoring QA
record `active/authoring-qa.md`. Pin the lock's digest OUTSIDE the mutable workspace in the native approval/
execution handoff, together with the approved SPEC digest. This avoids a self-hash
cycle. The nonsecret `EVAL_APPROVED_LOCK_SHA256` and `EVAL_APPROVED_SPEC_SHA256` are supplied
to every command from
that fixed handoff; never derive its trusted value from the current lock file.
The lock does not authorize execution independently of human approval.

Before the first gate, principal exclusively creates attempt-started.json once;
this records attempt1/1 immediately before command dispatch. The common guard
below prefixes every gate body literally in its one-argv command packet. QA
verifies that deterministic prefix+body packet before any dispatch. A guard failure
also consumes the attempt. Pin every required active input before G0; gate logs,
runtime/report outputs are new evidence, not authorization to edit pinned inputs.

Python3.14.5 and the current Python/docker/kubectl/bash executable bytes/paths are
pinned in authoring-tools.json, itself protected by the approval seal. The bytes
were read for authoring without invoking Docker/Kubernetes. Each common guard
checks them; alternate host/version requires a new approval, not silent adoption.
G2 records Docker client/server and kubectl client/server versions exactly once
from the authorized current environment. Human approval of this SPEC explicitly
approves this per-run admission mechanism for previously unobserved server versions:
record full versions and pin their JSON SHA in the native handoff before G3;
`EVAL_ADMITTED_TOOLCHAIN_SHA256` must then match through G5/G7. Drift, unavailable
version metadata or changed executable bytes blocks. Do not claim version numbers
that authoring has not observed, and do not install/upgrade tools to pass.

## Baseline and ownership

Authoring HEAD: `a5e6146250bfcee197c32dc6fab9b6107c7510a6`.
Fresh authoring baseline: `platform-evaluation-j1-j5/active/authoring-baseline.json`,
SHA256 `dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6`.
It records 3816 tracked/untracked paths including 415 preexisting missing tracked
files, symlinks and modes, plus current status. This is a fresh capture for explicit
approval, not proof of equality against a retired manifest. The six evaluator
hashes and lockfile below still match. HEAD also matches the compact historical
record. This task's SPEC and packet subtree are excluded from source preservation
to avoid self-invalidation; they are separately identified and sealed as admission
inputs. Private credentials/ignored runtime data are not included or certified.

The six evaluator files below are UNTRACKED preexisting work, not changes by this
task. All must remain byte-identical through execution and review:

| Path | SHA256 |
| --- | --- |
| `e2e/platform-evaluation-config.test.mjs` | `acabe00eef56e86b9db257c2ebf344d53c35b7d8a618352a3d6bd501c9d259f7` |
| `e2e/platform-evaluation-runner.mjs` | `a34492780fe947edfa3a6a7f947ec28a93039ebb9ff6263b19e19b0c833de066` |
| `e2e/platform-evaluation-state.test.mjs` | `2e58f2104e25b4ed978f5e47cdb6b9a6b53d3d32f281b2003612d13333c086e7` |
| `e2e/platform-evaluation-state.ts` | `c31b0f71c256c1cf081da5a5f081b10542257752656155649593a707ca38589f` |
| `e2e/platform-evaluation.config.ts` | `5b086a90e3435e1df1dd6019df9c0afd31025ee9354d575f3ff27ff902be3c20` |
| `e2e/platform-evaluation.spec.ts` | `3aeca797d1a99c2bb77ef5a1ba01dff5812e829364f4f4039754838a188995c1` |
| `pnpm-lock.yaml` | `edf298f7be61b797430cdd6edb41ebe920e142239afd24e00baf1f6bcab83a68` |

Preexisting compact-records changes include AGENTS, shared engine/roles/templates,
loop navigation/archive register, compact summaries and415tracked evidence deletions.
They are frozen baseline ownership, not this task's implementation or provenance
repair. Preserve absent paths as absent; do not restore or seek retired packets.
The compact-records closure remains blocked. Do not commit/stage unrelated work.
Any baseline drift before execution requires an explicit reconciliation and renewed
approval of changed scope; never silently refresh the baseline after a failure.

## Constraints and exact mutation boundary

Current AGENTS and shared roles/engine govern. Read current compact summaries for
navigation, current source and the full approved SPEC for execution. No production
source, harness/config/test, package/lockfile, tooling, global settings, new library,
DDL/provisioning-script implementation or Git mutation. No commit/push/reset/clean.

Principal writes only this SPEC and `platform-evaluation-j1-j5/{active/**,SUMMARY.md}`.
The runner may produce only the gate-generated evidence and effects listed below:

- Host: frozen `pnpm install --frozen-lockfile --ignore-scripts` may write generated
  node_modules/package-manager caches. No global install or browser installation.
  Existing test/compiler caches are generated effects, never source changes.
- Tests: config regression and discovery may create fresh UUID paths under
  `end-to-end-evaluation/evidence/t02/playwright/`; state regression may create
  fresh UUID paths under `platform-evaluation-j3-offline-continuation/evidence/checkpoint-boundary/`.
  The production wrapper creates one fresh `invocation-<uuid>.json` under
  `end-to-end-evaluation/evidence/t02/identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30/`,
  and one fresh Playwright run subtree under the fixed root above. Parents retired
  by cleanup may be recreated as directories, never historical files. Existing
  paths must not be overwritten. New invocation checkpoints may be updated by the
  unchanged wrapper's existing lifecycle. Record newly generated paths separately.
- Builds: seven local images only, plus pulled digest-pinned base images and Docker
  build cache. Derived Dockerfiles/logs/image manifests stay under this task's
  active directory; original Dockerfiles remain unchanged. Preserve existing
  explicit esbuild rebuild and Angular build steps; no blanket lifecycle enabling.
- Cluster: only local `orbstack`, namespace `platform-services-dev`, tenant acme.
  Require OrbStack already running; no implicit startup, bootstrap, reset, secret
  provisioning, PVC/storage mutation, scrub suspension change or dev-mode toggling.
  Dev mode must already be OFF and relevant source mounts absent. Failure blocks.
  Deploy-only actions may update the selected seven applications' existing Knative
  revisions/Deployments. Required CronJob must already exist suspended; never create
  it as an accidental deploy side effect. No dependency-image or manifest changes.
- Identity: use ONLY retained private file
  `/private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json`.
  The unchanged wrapper privately reads it and `scripts/e2e/.env`; agents never
  print/read their contents. No new user/role/credential: zero creates, at most
  one same-user reactivation and one final deactivation; retained role unchanged.
  Metadata-only preflight cannot prove identity contents or live usability; those
  are checked by the single wrapper invocation, not a probe invocation.
- Fixtures per fresh run: at most2channels (HTTP inbound + local e2e-tests sink),
  1workflow, 2stored manifests, 3synthetic ingress messages. Valid apply twice tests
  idempotence; invalid-reference plan must fail without apply. Preserve UUID/Nano ID
  distinctions and exact owned externalId targeting. No adoption by name/prefix.
- Workflow writes: J4 disable, reenable, disable plus at most one finally disable
  (maximum4status PATCHes), only to the captured ID after exact ownership validation.
  Final disable and identity deactivation are safety operations authorized even
  after first failure, not retries. If they fail or their outcome is unknown,
  report exact known owned IDs and unsafe state; no extra rescue PATCH/cleanup.
- Retain application fixtures. No DELETE, undeploy, sweep, TTL scrub, external
  connector/hosted/LLM/real messaging. Only local synthetic sink traffic. Normal
  service login/session/audit/event/trace effects are expected and not rolled back.

No automatic rollback of images/deployments, caches, fixtures or identity. Record
before/after state and any partial deployment. An infrastructure restoration would
be a separate human decision, except the two existing safety finalizers above.
Require no concurrent cluster/source-mount work before starting; do not mutate
other work to establish that condition.

## Journeys, diagnostics and success

| Journey | Observable requirement | Required safe diagnosis |
| --- | --- | --- |
| J1 Access | Anonymous workflows navigation redirects to login; real login shows dashboard/workflows; missing token401 and tenant mismatch401/403 without foreign records. | Journey result and safe status/stage. Do not infer full isolation or revoke-issued-JWT behavior. |
| J2 Provision | Exactly owned inbound/sink/workflow, stable IDs on second plan/apply, invalid schema rejected, unresolved ref plan fails without partial apply. | Fresh run/name markers, manifest revision/hash, captured IDs before later assertions, baseline hashes and partial applied outcomes. |
| J3 Execute | Percent-encoded verified account externalId webhook reaches owned execution; deterministic result, expected branch, local sink nonce and correlation agree; completion and tracking detail observed. Ingress acknowledgement alone is not acceptance. | Immutable ordered allowlisted checkpoints, attempted vs completed operation, latest owned observations even on timeout; distinguish transport/HTTP/malformed/timeout/assertion and checkpoint-write failure. |
| J4 Toggle | Exact owned disable; positive refusal log and no new owned execution through the120s window; reenable third nonce completes within120s; final disabled. | Disabled/refusal/completion outcomes, owned execution IDs, safe log-match boolean; no raw worker logs persisted. |
| J5 Diagnose | Built console workflow/trace/run routes match API/Temporal IDs; completion/step spans and causal links; synthetic payload nonce; unknown event404 and restricted payload403. | IDs, verdict and safe discrepancy category only; no raw payload, credential, screenshot, trace/HAR/video or raw assertion output. |

The unchanged harness logs each journey started/completed/failed and persists its
ledger; non-J3 failures can have only an allowlisted generic cause. Do not invent
narrower diagnosis than the available stage/checkpoint. If insufficient, classify
UNKNOWN and propose separately authorized diagnosis. No extra runtime probing or
rerun is authorized after a failure. fp-dev may inspect current source read-only
and supply a handoff with cause, uncertainty and one bounded next decision.

Existing per-request10s, poll120s, child15min and wrapper20min bounds remain.
The child15min timeout equals the Playwright test timeout and can preempt the
workflow finally. A timeout therefore leaves workflow status unknown unless its
safe finalization record exists; outer user deactivation is independently attempted.
No ad-hoc rescue is authorized. This material limitation needs explicit acceptance.
The wrapper termination/finalization mechanics are inherited limitations, not a
proof of hard process-tree cleanup after host death. Unknown completion blocks.
Success requires all J1–J5 passed/zero skipped, no primary/secondary safety or
preservation failure, no missing retained fixture hash, final identity GET404 +
active-list absence + fresh-login401 and exact retained role/preexisting hashes.
PATCH404 alone is insufficient. Resource semantic hashes cover the existing API
projection, not full database equality. No current product claim without evidence.

## Gates

All commands below are DECLARED ONLY until approval and A0 admission. Run from
repository root via `/bin/bash -o pipefail -c` with each body passed unchanged as
ONE argv value, `set -e` for multi-command bodies. One native runner owns every
command/process; retain exact sanitized stdout/stderr, status, duration, state
identity and actual run/turn/model temporarily. Stop first failure. No nested
shell reconstruction, hidden retry or duplicate after an interrupted tool call.

This task changes no service code: no dev-mode iteration or mutating validator.
Built-image verification applies. Unit/typecheck/discovery below are mandatory
regression preflight, not substitute for runtime. No broad stock/CRM/reset suite.

### Common guard — prepend to every G0–G9 command body

```bash
set -e
python3 - <<'PY_APPROVAL_GUARD'
from pathlib import Path
import os,json,hashlib,sys,shutil
p=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
b=(p/'approval-lock.json').read_bytes()
assert hashlib.sha256(b).hexdigest()==os.environ['EVAL_APPROVED_LOCK_SHA256'],'approval seal changed'
a=json.loads(b)
assert a['approvedSpecSha256']==os.environ['EVAL_APPROVED_SPEC_SHA256'],'approved SPEC identity mismatch'
required={'manual-loops/architecture/platform-evaluation-j1-j5.md'}|{'manual-loops/architecture/platform-evaluation-j1-j5/active/'+n for n in ['authoring-baseline.json','preparation.md','authoring-role-provenance.json','authoring-tools.json','authoring-qa.md']}
assert required<=set(a['files']),'approval inputs omitted'
assert a['files']['manual-loops/architecture/platform-evaluation-j1-j5.md']==a['approvedSpecSha256']
for n,h in a['files'].items():
 q=Path(n);assert q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==h,'approved input changed: '+n
t=json.loads((p/'authoring-tools.json').read_text())
assert sys.version.split()[0]==t['pythonVersion']
for name,v in t['tools'].items():
 q=Path(shutil.which(name)).resolve();assert str(q)==v['path'] and hashlib.sha256(q.read_bytes()).hexdigest()==v['sha256'],'tool drift: '+name
assert (p/'attempt-started.json').is_file(),'attempt ledger missing'
print('approved input/tool seal verified')
PY_APPROVAL_GUARD
```

### G0 — Current source preservation and cheap checks

```bash
set -e
python3 - <<'PY_G0'
from pathlib import Path
import hashlib,json,subprocess,datetime
p=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
assert json.loads((p/'attempt-started.json').read_text())['attempt']==1
b=(p/'authoring-baseline.json').read_bytes()
assert hashlib.sha256(b).hexdigest()=='dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6','authoring baseline changed'
v=json.loads(b)
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==v['head'],'HEAD changed'
for n,e in v['files'].items():
 q=Path(n)
 if e.get('absent'):good=not q.exists() and not q.is_symlink()
 elif 'symlink' in e:good=q.is_symlink() and str(q.readlink())==e['symlink']
 else:good=q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==e['sha256'] and q.stat().st_mode & 0o777==e['mode']
 assert good,'baseline drift: '+n
paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split(chr(0))
for n in filter(None,paths):
 assert n in v['files'] or n=='manual-loops/architecture/platform-evaluation-j1-j5.md' or n.startswith('manual-loops/architecture/platform-evaluation-j1-j5/'),'unexpected new path: '+n
with (p/'execution-source.json').open('x') as f:json.dump({'head':v['head'],'files':v['files']},f)
print('fresh source reconciliation passed; full attempt1/1 consumed')
PY_G0
node -e 'if(process.version!=="v26.7.0")process.exit(1);console.log(process.version)'
pnpm --version | python3 -c 'import sys;v=sys.stdin.read().strip();print(v);sys.exit(v!="11.6.0")'
bun --version | python3 -c 'import sys;v=sys.stdin.read().strip();print(v);sys.exit(v!="1.3.1")'
git diff --check
./scripts/checks/doc-code-guards.sh
```

### G1 — Offline regression and installed-browser prerequisite

```bash
set -e
pnpm install --frozen-lockfile --ignore-scripts
python3 -c 'from pathlib import Path;import hashlib;assert hashlib.sha256(Path("pnpm-lock.yaml").read_bytes()).hexdigest()=="edf298f7be61b797430cdd6edb41ebe920e142239afd24e00baf1f6bcab83a68"'
pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck e2e/platform-evaluation.spec.ts e2e/platform-evaluation.config.ts e2e/platform-evaluation-state.ts
node --check e2e/platform-evaluation-runner.mjs
node e2e/platform-evaluation-runner.mjs --self-test
node --test e2e/platform-evaluation-config.test.mjs
node --test e2e/platform-evaluation-state.test.mjs
(cd services/api-gateway && bun run test:unit)
(cd services/provisioning-service && bun run test:unit)
(cd services/channel-service && bun run test:unit)
(cd services/workflow-service && bun run test:unit)
(cd services/workflow-service && pnpm exec tsc --noEmit --incremental false -p tsconfig.json)
env -u E2E_EVAL_RUN_ID -u TEST_WORKER_INDEX pnpm exec playwright test --config e2e/platform-evaluation.config.ts --list
node --input-type=module -e 'import {chromium} from "@playwright/test";import {accessSync,constants} from "node:fs";accessSync(chromium.executablePath(),constants.X_OK);console.log("installed Chromium executable available; not launched")'
python3 - <<'PY_META'
from pathlib import Path
import os,stat
p=Path('/private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json');s=p.lstat()
assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o600,'private identity metadata invalid'
q=Path('scripts/e2e/.env');assert q.is_file() and not q.is_symlink() and os.access(q,os.R_OK),'credential file unavailable'
print('identity metadata and credential readability checked; contents/live usability unverified')
PY_META
```

Require runner26self-test cases, config14, state34, zero failed/skipped focused
cases and discovery exactly one test spanning J1–J5. Capture actual service-suite
counts, not historical counts. Any different discovered scope blocks. Browser
availability is not a successful launch; no browser launch before the one wrapper.

### G2 — Read-only OrbStack and predeployment inventory

```bash
set -e
python3 -c 'import subprocess;v=subprocess.check_output(["orb","status"],text=True).strip();print(v);assert v=="Running"'
python3 - <<'PY_TOOLCHAIN'
from pathlib import Path
import subprocess,json,hashlib
p=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
assert d['Client']['Version'] and d['Server']['Version'] and k['clientVersion']['gitVersion'] and k['serverVersion']['gitVersion']
b=json.dumps({'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']},sort_keys=True).encode()
with (p/'admitted-toolchain.json').open('xb') as f:f.write(b)
print(b.decode());print('admittedToolchainSha256',hashlib.sha256(b).hexdigest())
PY_TOOLCHAIN
test "$(kubectl config current-context)" = orbstack
kubectl --context orbstack --request-timeout=10s auth can-i get pods --subresource=log -n platform-services-dev | python3 -c 'import sys;v=sys.stdin.read().strip();print(v);sys.exit(v!="yes")'
curl --fail --silent --show-error --max-time 10 --output /dev/null http://admin-console.platform-services-dev.dev.local/
curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}\n' http://api-gateway.platform-services-dev.dev.local/api/workflows | python3 -c 'import sys;v=sys.stdin.read().strip();print(v);sys.exit(v!="401")'
```

The G2 structured inventory below is mandatory, not a discretionary read. No
raw Secret/env values or raw worker logs may be printed. GET readiness/anonymous
routing can produce normal access logs. A sandbox denial is access failure,
not proof OrbStack is stopped. Use tool escalation when required, never substitute
another context. Before dispatch obtain explicit confirmation that no concurrent
cluster/source-mount operator is active; inability to establish exclusivity blocks.

```bash
python3 - <<'PY_CLUSTER'
import json,subprocess,time
from pathlib import Path
phase='preflight'
out=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
apps=['auth-service','api-gateway','provisioning-service','channel-service','workflow-service','tracking-ingester-service','admin-console']
ksvc=['auth-service','api-gateway','provisioning-service','channel-service-api','workflow-service-api','admin-console']
deploy=['channel-service-worker','workflow-service-worker','workflow-worker','tracking-ingester-worker']
k=['kubectl','--context','orbstack','--request-timeout=10s']
def get(*args):return json.loads(subprocess.check_output(k+list(args)+['-o','json'],text=True))
def items(*args):return get(*args)['items']
def ready(o):return any(c['type']=='Ready' and c['status']=='True' for c in o.get('status',{}).get('conditions',[]))
start=time.monotonic();sample=0
while True:
 nodes=items('get','nodes');assert nodes and all(ready(x) for x in nodes),'node not Ready'
 pvcs=items('get','pvc','-A');assert len(pvcs)==10 and all(x.get('status',{}).get('phase')=='Bound' for x in pvcs),'PVC count/binding'
 pairs=sorted((x['metadata']['namespace'],x['metadata']['name'],x['metadata']['uid'],x['spec']['volumeName'],json.dumps({'storageClass':x['spec'].get('storageClassName'),'accessModes':x['spec'].get('accessModes'),'requested':x['spec'].get('resources'),'capacity':x.get('status',{}).get('capacity')},sort_keys=True)) for x in pvcs)
 workloads=items('get','deployments','-n','platform-services-dev')
 services=items('get','ksvc','-n','platform-services-dev')
 cron=get('get','cronjob','tracking-payload-scrub','-n','platform-services-dev')
 assert cron['spec'].get('suspend') is True and not cron.get('status',{}).get('active'),'scrub unsafe'
 jobs=items('get','jobs','-n','platform-services-dev','-l','app.kubernetes.io/name=tracking-payload-scrub')
 assert all(not j.get('status',{}).get('active') for j in jobs),'active scrub Job'
 scrub={'uid':cron['metadata']['uid'],'generation':cron['metadata']['generation'],'specHash':__import__('hashlib').sha256(json.dumps(cron['spec'],sort_keys=True).encode()).hexdigest(),'jobs':sorted(j['metadata']['name'] for j in jobs)}
 assert set(ksvc)<=set(x['metadata']['name'] for x in services),'missing required Knative service'
 assert set(deploy)<=set(x['metadata']['name'] for x in workloads),'missing required Deployment'
 expectedTargets={'auth-service':'auth-service','api-gateway':'api-gateway','provisioning-service':'provisioning-service','channel-service-api':'channel-service','channel-service-worker':'channel-service','workflow-service-api':'workflow-service','workflow-service-worker':'workflow-service','workflow-worker':'workflow-service','tracking-ingester-worker':'tracking-ingester-service','admin-console':'admin-console'}
 for x in workloads+services:
  name=x['metadata']['name']
  if name in expectedTargets:
   c=next((v for v in x['spec']['template']['spec']['containers'] if v['name']=='user-container'),None)
   assert c and c['image']=='dev.local/'+expectedTargets[name]+':local','unexpected target image/container: '+name
   assert not any('--watch' in v for v in c.get('command',[])+c.get('args',[])),'watch command in target'
 for x in workloads+services:
  for m in [x['metadata'],x['spec']['template'].get('metadata',{})]:
   assert m.get('annotations',{}).get('yoizen.io/dev-mode') not in ['true','on','enabled'],'dev mode active'
  assert not any('hostPath' in v for v in x['spec']['template']['spec'].get('volumes',[])),'hostPath workload'
 pods=items('get','pods','-n','platform-services-dev')
 live=[x for x in pods if x.get('status',{}).get('phase') not in ['Succeeded','Failed']]
 assert all(not any('hostPath' in v for v in x['spec'].get('volumes',[])) for x in live),'live hostPath'
 observed=[]
 for x in live:
  for c in x.get('status',{}).get('containerStatuses',[]):
   spec=next((v for v in x['spec']['containers'] if v['name']==c['name']),{})
   observed.append({'pod':x['metadata']['name'],'container':c['name'],'image':spec.get('image'),'imageID':c.get('imageID'),'ready':c.get('ready') is True})
 selected=[x for x in observed if any(x['image']=='dev.local/'+a+':local' for a in apps)]
 currentReady=all(ready(x) and x.get('status',{}).get('latestCreatedRevisionName')==x.get('status',{}).get('latestReadyRevisionName') for x in services) and all(x.get('status',{}).get('observedGeneration',0)>=x['metadata']['generation'] and x.get('status',{}).get('readyReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('updatedReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('availableReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('unavailableReplicas',0)==0 for x in workloads if x['spec'].get('replicas',1)>0)
 good=currentReady and len(selected)==10 and all(ready(x) for x in live) and all(x['ready'] and x['imageID'] for x in observed)
 record={'phase':phase,'pvcPairs':pairs,'containers':observed,'selected':selected,'currentReady':currentReady,'scrubSuspended':True,'scrub':scrub,'sourceMounts':False,'devMode':False}
 if phase!='preflight':
  before=json.loads((out/'cluster-preflight.json').read_text())
  assert pairs==[tuple(v) for v in before['pvcPairs']],'PVC changed'
  assert scrub==before['scrub'],'scrub spec/jobs changed'
  built=json.loads((out/'built-images.json').read_text())
  for a in apps:
   expected=[built[a]['Id']]+built[a]['RepoDigests'];assert expected,'missing immutable image identity'
   matches=[x for x in selected if x['image']=='dev.local/'+a+':local']
   good=good and len(matches)==({'channel-service':2,'workflow-service':3}.get(a,1)) and all(any(x['imageID'].removeprefix('docker-pullable://').removeprefix('containerd://').removeprefix('docker://')==d for d in expected) for x in matches)
  oldDeps=sorted((x['container'],x['image'],x['imageID']) for x in before['containers'] if x not in before['selected'])
  newDeps=sorted((x['container'],x['image'],x['imageID']) for x in observed if x not in selected)
  good=good and oldDeps==newDeps
 record['accepted']=good
 with (out/('cluster-'+phase+'-sample-'+str(sample)+'.json')).open('x') as f:json.dump(record,f,indent=2)
 print(json.dumps({'phase':phase,'sample':sample,'accepted':good,'selectedContainers':len(selected)}),flush=True)
 if good:
  with (out/('cluster-'+phase+'.json')).open('x') as f:json.dump(record,f,indent=2)
  break
 if phase=='preflight' or time.monotonic()-start>=120:raise SystemExit('Readiness/image correspondence failed; no retry authorized')
 sample+=1;time.sleep(5)
PY_CLUSTER
```

Preflight requires current replicas Ready, all seven targets present, all ten
selected containers running, scrub already suspended and tenPVC pairs captured.
All platform-service live pods are checked; support node/PVC/dependency identities
are retained, while selected application journey execution is tested later.
No preflight convergence retry is authorized. Postdeploy/postrun allow at most120s
of5s observations solely for controller/image convergence, never unsafe PVC/mount/
scrub state or command errors. Zero-replica historical Deployments are preserved;
live old revision pods still count until naturally gone. No arbitrary filtering.

### G3 — Seven serial frozen builds and digest identity

```bash
python3 - <<'PY_BUILD'
from pathlib import Path
import subprocess,json,hashlib,re
def check_toolchain(out):
 import os,hashlib
 raw=(out/'admitted-toolchain.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==os.environ['EVAL_ADMITTED_TOOLCHAIN_SHA256'],'admitted tools record changed'
 d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
 k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
 now={'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']}
 assert json.dumps(now,sort_keys=True).encode()==raw,'tool/server version drift'
check_toolchain(Path('manual-loops/architecture/platform-evaluation-j1-j5/active'))
def verify_source():
 raw=Path('manual-loops/architecture/platform-evaluation-j1-j5/active/authoring-baseline.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()=='dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6'
 base=json.loads(raw)
 expected={'head':base['head'],'files':base['files']}
 assert Path('manual-loops/architecture/platform-evaluation-j1-j5/active/execution-source.json').read_text()==json.dumps(expected),'derived source manifest changed'
 assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head'],'HEAD drift'
 for n,e in base['files'].items():
  q=Path(n)
  if e.get('absent'):good=not q.exists() and not q.is_symlink()
  elif 'symlink' in e:good=q.is_symlink() and str(q.readlink())==e['symlink']
  else:good=q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==e['sha256'] and q.stat().st_mode & 0o777==e['mode']
  assert good,'source drift: '+n
verify_source()
out=Path('manual-loops/architecture/platform-evaluation-j1-j5/active/build');out.mkdir(exist_ok=False)
apps=['auth-service','api-gateway','provisioning-service','channel-service','workflow-service','tracking-ingester-service','admin-console']
lock='edf298f7be61b797430cdd6edb41ebe920e142239afd24e00baf1f6bcab83a68'
assert hashlib.sha256(Path('pnpm-lock.yaml').read_bytes()).hexdigest()==lock
bases={};images={}
for a in apps:
 original=Path('services',a,'Dockerfile').read_text()
 assert original.count('pnpm install --ignore-scripts')==1,a
 derived=original.replace('pnpm install --ignore-scripts','pnpm install --frozen-lockfile --ignore-scripts').replace('corepack enable pnpm &&','corepack enable pnpm && corepack prepare pnpm@11.6.0 --activate && node --version && pnpm --version &&')
 lines=[]
 for line in derived.splitlines():
  m=re.match(r'FROM (\S+)(.*)',line)
  if m and (':' in m[1] or '/' in m[1]):
   ref=m[1]
   if ref not in bases:
    subprocess.run(['docker','--context','orbstack','pull',ref],check=True)
    v=json.loads(subprocess.check_output(['docker','--context','orbstack','image','inspect',ref],text=True))[0]
    assert v['RepoDigests'];bases[ref]=v['RepoDigests'][0]
   line='FROM '+bases[ref]+m[2]
   lines.append(line)
   if ref.startswith('oven/bun:'):lines.append('RUN bun --version')
   elif ref.startswith('nginxinc/'):lines.append('RUN nginx -v')
   continue
  lines.append(line)
 target=out/('Dockerfile.'+a);target.write_text('\n'.join(lines)+'\n')
 cmd=['docker','--context','orbstack','build','--progress=plain','--label','io.yoizen.evaluation.source-head=a5e6146250bfcee197c32dc6fab9b6107c7510a6','--label','io.yoizen.evaluation.baseline=dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6','-t','dev.local/'+a+':local','-f',str(target),'.']
 print(json.dumps({'application':a,'command':cmd,'lockSha256':lock,'originalDockerfileSha256':hashlib.sha256(original.encode()).hexdigest()}),flush=True)
 subprocess.run(cmd,check=True)
 verify_source()
 v=json.loads(subprocess.check_output(['docker','--context','orbstack','image','inspect','dev.local/'+a+':local'],text=True))[0]
 assert v['Id'].startswith('sha256:'),'No immutable built image ID'
 images[a]={'Id':v['Id'],'RepoDigests':v['RepoDigests'],'Labels':v['Config'].get('Labels',{})}
 with (out/(a+'-image.json')).open('x') as f:json.dump(images[a],f,indent=2)
 assert hashlib.sha256(Path('pnpm-lock.yaml').read_bytes()).hexdigest()==lock
with (out/'base-digests.json').open('x') as f:json.dump(bases,f,indent=2)
with (out.parent/'built-images.json').open('x') as f:json.dump(images,f,indent=2)
PY_BUILD
```

Only derived pin/frozen-install/tool-version-output/labels differ. Runtime-stage
Bun/nginx version output is recorded during image build, not a product invocation. Preserve existing
Bun1.3.14 image runtime and nginx1.27 family; record the resolved base digests and
build-stage Node24 patch versions from actual logs. Host Bun1.3.1 is a distinct
preflight pin. Labels supplement, never replace, source hash + full build evidence
and live immutable ID/RepoDigest correspondence. Label cached layers honestly.
An empty RepoDigests list is retained honestly; only an exact immutable built ID
match can then pass, never tag equality. Unknown runtime ID format blocks. Any
any build failure blocks before deployment; no tag-only/stale-image fallback.

### G4 — Deploy only the seven existing applications

```bash
python3 - <<'PY_DEPLOY'
from pathlib import Path
import subprocess,json,datetime,hashlib
def check_toolchain(out):
 import os,hashlib
 raw=(out/'admitted-toolchain.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==os.environ['EVAL_ADMITTED_TOOLCHAIN_SHA256'],'admitted tools record changed'
 d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
 k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
 now={'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']}
 assert json.dumps(now,sort_keys=True).encode()==raw,'tool/server version drift'
check_toolchain(Path('manual-loops/architecture/platform-evaluation-j1-j5/active'))
def verify_source():
 raw=Path('manual-loops/architecture/platform-evaluation-j1-j5/active/authoring-baseline.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()=='dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6'
 base=json.loads(raw)
 expected={'head':base['head'],'files':base['files']}
 assert Path('manual-loops/architecture/platform-evaluation-j1-j5/active/execution-source.json').read_text()==json.dumps(expected),'derived source manifest changed'
 assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head'],'HEAD drift'
 for n,e in base['files'].items():
  q=Path(n)
  if e.get('absent'):good=not q.exists() and not q.is_symlink()
  elif 'symlink' in e:good=q.is_symlink() and str(q.readlink())==e['symlink']
  else:good=q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==e['sha256'] and q.stat().st_mode & 0o777==e['mode']
  assert good,'source drift: '+n
verify_source()
k=['kubectl','--context','orbstack','-n','platform-services-dev']
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
ksvc=['auth-service','channel-service-api','workflow-service-api','provisioning-service','api-gateway','admin-console']
deploy=['channel-service-worker','workflow-service-worker','workflow-worker','tracking-ingester-worker']
for n in ksvc:
 patch=json.dumps({'spec':{'template':{'metadata':{'annotations':{'client.knative.dev/updateTimestamp':stamp}}}}})
 subprocess.run(k+['patch','ksvc',n,'--type','merge','-p',patch],check=True)
 subprocess.run(k+['wait','ksvc',n,'--for=condition=Ready','--timeout=180s'],check=True)
for n in deploy:
 subprocess.run(k+['rollout','restart','deployment',n],check=True)
 subprocess.run(k+['rollout','status','deployment/'+n,'--timeout=180s'],check=True)
PY_DEPLOY
```

```bash
set -e
bash scripts/smoke-test.sh
kubectl --context orbstack -n platform-services-dev rollout status deployment/tracking-ingester-worker --timeout=180s
kubectl --context orbstack -n platform-services-dev rollout status deployment/connector-runtime-http --timeout=180s
kubectl --context orbstack -n platform-services-dev rollout status deployment/connector-runtime-invoke --timeout=180s
```

Six Knative services and four Deployments use7images in10application containers,
excluding Knative queue sidecars. Direct strict patch/wait/restart avoids the
helper's warning-only failure and implicit CronJob creation paths. G5 still proves
actual image/readiness correspondence. On partial deployment failure, no later
mutation or wrapper is allowed; report the exact commands already completed and
request a separate restoration decision. Do not roll back or finish deployment.

### G5 — Built-image correspondence before the single wrapper

```bash
python3 - <<'PY_CLUSTER'
import json,subprocess,time
from pathlib import Path
phase='postdeploy'
def check_toolchain(out):
 import os,hashlib
 raw=(out/'admitted-toolchain.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==os.environ['EVAL_ADMITTED_TOOLCHAIN_SHA256'],'admitted tools record changed'
 d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
 k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
 now={'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']}
 assert json.dumps(now,sort_keys=True).encode()==raw,'tool/server version drift'
out=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
check_toolchain(out)
apps=['auth-service','api-gateway','provisioning-service','channel-service','workflow-service','tracking-ingester-service','admin-console']
ksvc=['auth-service','api-gateway','provisioning-service','channel-service-api','workflow-service-api','admin-console']
deploy=['channel-service-worker','workflow-service-worker','workflow-worker','tracking-ingester-worker']
k=['kubectl','--context','orbstack','--request-timeout=10s']
def get(*args):return json.loads(subprocess.check_output(k+list(args)+['-o','json'],text=True))
def items(*args):return get(*args)['items']
def ready(o):return any(c['type']=='Ready' and c['status']=='True' for c in o.get('status',{}).get('conditions',[]))
start=time.monotonic();sample=0
while True:
 nodes=items('get','nodes');assert nodes and all(ready(x) for x in nodes),'node not Ready'
 pvcs=items('get','pvc','-A');assert len(pvcs)==10 and all(x.get('status',{}).get('phase')=='Bound' for x in pvcs),'PVC count/binding'
 pairs=sorted((x['metadata']['namespace'],x['metadata']['name'],x['metadata']['uid'],x['spec']['volumeName'],json.dumps({'storageClass':x['spec'].get('storageClassName'),'accessModes':x['spec'].get('accessModes'),'requested':x['spec'].get('resources'),'capacity':x.get('status',{}).get('capacity')},sort_keys=True)) for x in pvcs)
 workloads=items('get','deployments','-n','platform-services-dev')
 services=items('get','ksvc','-n','platform-services-dev')
 cron=get('get','cronjob','tracking-payload-scrub','-n','platform-services-dev')
 assert cron['spec'].get('suspend') is True and not cron.get('status',{}).get('active'),'scrub unsafe'
 jobs=items('get','jobs','-n','platform-services-dev','-l','app.kubernetes.io/name=tracking-payload-scrub')
 assert all(not j.get('status',{}).get('active') for j in jobs),'active scrub Job'
 scrub={'uid':cron['metadata']['uid'],'generation':cron['metadata']['generation'],'specHash':__import__('hashlib').sha256(json.dumps(cron['spec'],sort_keys=True).encode()).hexdigest(),'jobs':sorted(j['metadata']['name'] for j in jobs)}
 assert set(ksvc)<=set(x['metadata']['name'] for x in services),'missing required Knative service'
 assert set(deploy)<=set(x['metadata']['name'] for x in workloads),'missing required Deployment'
 expectedTargets={'auth-service':'auth-service','api-gateway':'api-gateway','provisioning-service':'provisioning-service','channel-service-api':'channel-service','channel-service-worker':'channel-service','workflow-service-api':'workflow-service','workflow-service-worker':'workflow-service','workflow-worker':'workflow-service','tracking-ingester-worker':'tracking-ingester-service','admin-console':'admin-console'}
 for x in workloads+services:
  name=x['metadata']['name']
  if name in expectedTargets:
   c=next((v for v in x['spec']['template']['spec']['containers'] if v['name']=='user-container'),None)
   assert c and c['image']=='dev.local/'+expectedTargets[name]+':local','unexpected target image/container: '+name
   assert not any('--watch' in v for v in c.get('command',[])+c.get('args',[])),'watch command in target'
 for x in workloads+services:
  for m in [x['metadata'],x['spec']['template'].get('metadata',{})]:
   assert m.get('annotations',{}).get('yoizen.io/dev-mode') not in ['true','on','enabled'],'dev mode active'
  assert not any('hostPath' in v for v in x['spec']['template']['spec'].get('volumes',[])),'hostPath workload'
 pods=items('get','pods','-n','platform-services-dev')
 live=[x for x in pods if x.get('status',{}).get('phase') not in ['Succeeded','Failed']]
 assert all(not any('hostPath' in v for v in x['spec'].get('volumes',[])) for x in live),'live hostPath'
 observed=[]
 for x in live:
  for c in x.get('status',{}).get('containerStatuses',[]):
   spec=next((v for v in x['spec']['containers'] if v['name']==c['name']),{})
   observed.append({'pod':x['metadata']['name'],'container':c['name'],'image':spec.get('image'),'imageID':c.get('imageID'),'ready':c.get('ready') is True})
 selected=[x for x in observed if any(x['image']=='dev.local/'+a+':local' for a in apps)]
 currentReady=all(ready(x) and x.get('status',{}).get('latestCreatedRevisionName')==x.get('status',{}).get('latestReadyRevisionName') for x in services) and all(x.get('status',{}).get('observedGeneration',0)>=x['metadata']['generation'] and x.get('status',{}).get('readyReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('updatedReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('availableReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('unavailableReplicas',0)==0 for x in workloads if x['spec'].get('replicas',1)>0)
 good=currentReady and len(selected)==10 and all(ready(x) for x in live) and all(x['ready'] and x['imageID'] for x in observed)
 record={'phase':phase,'pvcPairs':pairs,'containers':observed,'selected':selected,'currentReady':currentReady,'scrubSuspended':True,'scrub':scrub,'sourceMounts':False,'devMode':False}
 if phase!='preflight':
  before=json.loads((out/'cluster-preflight.json').read_text())
  assert pairs==[tuple(v) for v in before['pvcPairs']],'PVC changed'
  assert scrub==before['scrub'],'scrub spec/jobs changed'
  built=json.loads((out/'built-images.json').read_text())
  for a in apps:
   expected=[built[a]['Id']]+built[a]['RepoDigests'];assert expected,'missing immutable image identity'
   matches=[x for x in selected if x['image']=='dev.local/'+a+':local']
   good=good and len(matches)==({'channel-service':2,'workflow-service':3}.get(a,1)) and all(any(x['imageID'].removeprefix('docker-pullable://').removeprefix('containerd://').removeprefix('docker://')==d for d in expected) for x in matches)
  oldDeps=sorted((x['container'],x['image'],x['imageID']) for x in before['containers'] if x not in before['selected'])
  newDeps=sorted((x['container'],x['image'],x['imageID']) for x in observed if x not in selected)
  good=good and oldDeps==newDeps
 record['accepted']=good
 with (out/('cluster-'+phase+'-sample-'+str(sample)+'.json')).open('x') as f:json.dump(record,f,indent=2)
 print(json.dumps({'phase':phase,'sample':sample,'accepted':good,'selectedContainers':len(selected)}),flush=True)
 if good:
  with (out/('cluster-'+phase+'.json')).open('x') as f:json.dump(record,f,indent=2)
  break
 if phase=='preflight' or time.monotonic()-start>=120:raise SystemExit('Readiness/image correspondence failed; no retry authorized')
 sample+=1;time.sleep(5)
PY_CLUSTER
```

### G6 — One identity-wrapper invocation, one J1–J5 run

```bash
set -e
python3 - <<'PY_START_WRAPPER'
from pathlib import Path
import json,datetime,hashlib,subprocess
def check_toolchain(out):
 import os,hashlib
 raw=(out/'admitted-toolchain.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==os.environ['EVAL_ADMITTED_TOOLCHAIN_SHA256'],'admitted tools record changed'
 d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
 k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
 now={'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']}
 assert json.dumps(now,sort_keys=True).encode()==raw,'tool/server version drift'
check_toolchain(Path('manual-loops/architecture/platform-evaluation-j1-j5/active'))
def verify_source():
 raw=Path('manual-loops/architecture/platform-evaluation-j1-j5/active/authoring-baseline.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()=='dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6'
 base=json.loads(raw)
 expected={'head':base['head'],'files':base['files']}
 assert Path('manual-loops/architecture/platform-evaluation-j1-j5/active/execution-source.json').read_text()==json.dumps(expected),'derived source manifest changed'
 assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head'],'HEAD drift'
 for n,e in base['files'].items():
  q=Path(n)
  if e.get('absent'):good=not q.exists() and not q.is_symlink()
  elif 'symlink' in e:good=q.is_symlink() and str(q.readlink())==e['symlink']
  else:good=q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==e['sha256'] and q.stat().st_mode & 0o777==e['mode']
  assert good,'source drift: '+n
verify_source()
p=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
assert (p/'cluster-postdeploy.json').is_file()
with (p/'wrapper-started.json').open('x') as f:json.dump({'wrapperInvocation':1,'limit':1,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},f)
PY_START_WRAPPER
node e2e/platform-evaluation-runner.mjs --identity-file /private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json
```

The outer tool/process identity must be retained before any yield. Poll that same
process only. Missing final output never authorizes another invocation. Use the
wrapper-produced new invocation file and fresh ledger, not predecessor files.

### G7 — Postrun infrastructure preservation

```bash
python3 - <<'PY_CLUSTER'
import json,subprocess,time
from pathlib import Path
phase='postrun'
def check_toolchain(out):
 import os,hashlib
 raw=(out/'admitted-toolchain.json').read_bytes()
 assert hashlib.sha256(raw).hexdigest()==os.environ['EVAL_ADMITTED_TOOLCHAIN_SHA256'],'admitted tools record changed'
 d=json.loads(subprocess.check_output(['docker','--context','orbstack','version','--format','{{json .}}'],text=True))
 k=json.loads(subprocess.check_output(['kubectl','--context','orbstack','--request-timeout=10s','version','-o','json'],text=True))
 now={'dockerClient':d['Client']['Version'],'dockerServer':d['Server']['Version'],'dockerApi':d['Server']['ApiVersion'],'kubectlClient':k['clientVersion'],'kubectlServer':k['serverVersion']}
 assert json.dumps(now,sort_keys=True).encode()==raw,'tool/server version drift'
out=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
check_toolchain(out)
apps=['auth-service','api-gateway','provisioning-service','channel-service','workflow-service','tracking-ingester-service','admin-console']
ksvc=['auth-service','api-gateway','provisioning-service','channel-service-api','workflow-service-api','admin-console']
deploy=['channel-service-worker','workflow-service-worker','workflow-worker','tracking-ingester-worker']
k=['kubectl','--context','orbstack','--request-timeout=10s']
def get(*args):return json.loads(subprocess.check_output(k+list(args)+['-o','json'],text=True))
def items(*args):return get(*args)['items']
def ready(o):return any(c['type']=='Ready' and c['status']=='True' for c in o.get('status',{}).get('conditions',[]))
start=time.monotonic();sample=0
while True:
 nodes=items('get','nodes');assert nodes and all(ready(x) for x in nodes),'node not Ready'
 pvcs=items('get','pvc','-A');assert len(pvcs)==10 and all(x.get('status',{}).get('phase')=='Bound' for x in pvcs),'PVC count/binding'
 pairs=sorted((x['metadata']['namespace'],x['metadata']['name'],x['metadata']['uid'],x['spec']['volumeName'],json.dumps({'storageClass':x['spec'].get('storageClassName'),'accessModes':x['spec'].get('accessModes'),'requested':x['spec'].get('resources'),'capacity':x.get('status',{}).get('capacity')},sort_keys=True)) for x in pvcs)
 workloads=items('get','deployments','-n','platform-services-dev')
 services=items('get','ksvc','-n','platform-services-dev')
 cron=get('get','cronjob','tracking-payload-scrub','-n','platform-services-dev')
 assert cron['spec'].get('suspend') is True and not cron.get('status',{}).get('active'),'scrub unsafe'
 jobs=items('get','jobs','-n','platform-services-dev','-l','app.kubernetes.io/name=tracking-payload-scrub')
 assert all(not j.get('status',{}).get('active') for j in jobs),'active scrub Job'
 scrub={'uid':cron['metadata']['uid'],'generation':cron['metadata']['generation'],'specHash':__import__('hashlib').sha256(json.dumps(cron['spec'],sort_keys=True).encode()).hexdigest(),'jobs':sorted(j['metadata']['name'] for j in jobs)}
 assert set(ksvc)<=set(x['metadata']['name'] for x in services),'missing required Knative service'
 assert set(deploy)<=set(x['metadata']['name'] for x in workloads),'missing required Deployment'
 expectedTargets={'auth-service':'auth-service','api-gateway':'api-gateway','provisioning-service':'provisioning-service','channel-service-api':'channel-service','channel-service-worker':'channel-service','workflow-service-api':'workflow-service','workflow-service-worker':'workflow-service','workflow-worker':'workflow-service','tracking-ingester-worker':'tracking-ingester-service','admin-console':'admin-console'}
 for x in workloads+services:
  name=x['metadata']['name']
  if name in expectedTargets:
   c=next((v for v in x['spec']['template']['spec']['containers'] if v['name']=='user-container'),None)
   assert c and c['image']=='dev.local/'+expectedTargets[name]+':local','unexpected target image/container: '+name
   assert not any('--watch' in v for v in c.get('command',[])+c.get('args',[])),'watch command in target'
 for x in workloads+services:
  for m in [x['metadata'],x['spec']['template'].get('metadata',{})]:
   assert m.get('annotations',{}).get('yoizen.io/dev-mode') not in ['true','on','enabled'],'dev mode active'
  assert not any('hostPath' in v for v in x['spec']['template']['spec'].get('volumes',[])),'hostPath workload'
 pods=items('get','pods','-n','platform-services-dev')
 live=[x for x in pods if x.get('status',{}).get('phase') not in ['Succeeded','Failed']]
 assert all(not any('hostPath' in v for v in x['spec'].get('volumes',[])) for x in live),'live hostPath'
 observed=[]
 for x in live:
  for c in x.get('status',{}).get('containerStatuses',[]):
   spec=next((v for v in x['spec']['containers'] if v['name']==c['name']),{})
   observed.append({'pod':x['metadata']['name'],'container':c['name'],'image':spec.get('image'),'imageID':c.get('imageID'),'ready':c.get('ready') is True})
 selected=[x for x in observed if any(x['image']=='dev.local/'+a+':local' for a in apps)]
 currentReady=all(ready(x) and x.get('status',{}).get('latestCreatedRevisionName')==x.get('status',{}).get('latestReadyRevisionName') for x in services) and all(x.get('status',{}).get('observedGeneration',0)>=x['metadata']['generation'] and x.get('status',{}).get('readyReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('updatedReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('availableReplicas',0)==x['spec'].get('replicas',1) and x.get('status',{}).get('unavailableReplicas',0)==0 for x in workloads if x['spec'].get('replicas',1)>0)
 good=currentReady and len(selected)==10 and all(ready(x) for x in live) and all(x['ready'] and x['imageID'] for x in observed)
 record={'phase':phase,'pvcPairs':pairs,'containers':observed,'selected':selected,'currentReady':currentReady,'scrubSuspended':True,'scrub':scrub,'sourceMounts':False,'devMode':False}
 if phase!='preflight':
  before=json.loads((out/'cluster-preflight.json').read_text())
  assert pairs==[tuple(v) for v in before['pvcPairs']],'PVC changed'
  assert scrub==before['scrub'],'scrub spec/jobs changed'
  built=json.loads((out/'built-images.json').read_text())
  for a in apps:
   expected=[built[a]['Id']]+built[a]['RepoDigests'];assert expected,'missing immutable image identity'
   matches=[x for x in selected if x['image']=='dev.local/'+a+':local']
   good=good and len(matches)==({'channel-service':2,'workflow-service':3}.get(a,1)) and all(any(x['imageID'].removeprefix('docker-pullable://').removeprefix('containerd://').removeprefix('docker://')==d for d in expected) for x in matches)
  oldDeps=sorted((x['container'],x['image'],x['imageID']) for x in before['containers'] if x not in before['selected'])
  newDeps=sorted((x['container'],x['image'],x['imageID']) for x in observed if x not in selected)
  good=good and oldDeps==newDeps
 record['accepted']=good
 with (out/('cluster-'+phase+'-sample-'+str(sample)+'.json')).open('x') as f:json.dump(record,f,indent=2)
 print(json.dumps({'phase':phase,'sample':sample,'accepted':good,'selectedContainers':len(selected)}),flush=True)
 if good:
  with (out/('cluster-'+phase+'.json')).open('x') as f:json.dump(record,f,indent=2)
  break
 if phase=='preflight' or time.monotonic()-start>=120:raise SystemExit('Readiness/image correspondence failed; no retry authorized')
 sample+=1;time.sleep(5)
PY_CLUSTER
```

### G8 — New-run result and complete source preservation

```bash
python3 - <<'PY_RESULT'
from pathlib import Path
import json,hashlib,subprocess,re
out=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
raw=(out/'authoring-baseline.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='dce18ff11fd4feeb35fb45a40b5daffd58b494eb85a9a44c1d7f07e0cc41b6e6'
base=json.loads(raw)
assert (out/'execution-source.json').read_text()==json.dumps({'head':base['head'],'files':base['files']}),'derived source manifest changed'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==base['head'],'HEAD changed'
for n,e in base['files'].items():
 p=Path(n)
 if e.get('absent'):good=not p.exists() and not p.is_symlink()
 elif 'symlink' in e:good=p.is_symlink() and str(p.readlink())==e['symlink']
 else:good=p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256'] and p.stat().st_mode & 0o777==e['mode']
 assert good,'preexisting path changed: '+n
paths=list(filter(None,subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split(chr(0))))
new=[n for n in paths if n not in base['files']]
u='[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
play='manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/'
identity='manual-loops/architecture/end-to-end-evaluation/evidence/t02/identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30/'
fs='manual-loops/architecture/platform-evaluation-j3-offline-continuation/evidence/checkpoint-boundary/'
for n in new:
 assert n=='manual-loops/architecture/platform-evaluation-j1-j5.md' or n.startswith('manual-loops/architecture/platform-evaluation-j1-j5/') or re.fullmatch(re.escape(play)+u+'/.+',n) or re.fullmatch(re.escape(identity)+'invocation-'+u+r'\.json',n) or re.fullmatch(re.escape(fs)+u+'/.+',n),'out-of-scope new path: '+n
inv=[n for n in new if n.startswith(identity) and re.fullmatch('invocation-'+u+r'\.json',Path(n).name)]
led=[n for n in new if re.fullmatch(re.escape(play)+u+'/ledger.json',n)]
assert len(inv)==1 and len(led)==1,'requires one fresh invocation and one fresh ledger'
r=json.loads(Path(inv[0]).read_text());l=json.loads(Path(led[0]).read_text())
assert l['runId']==Path(led[0]).parent.name
assert r['invocationId']==Path(inv[0]).stem.removeprefix('invocation-')
assert r['identityId']=='8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30'
assert r['identityFile']=='/private/tmp/platform-evaluation-identity-8313fea9-2f39-4e9c-9d98-c5c0bc3f4c30.json'
assert l['j3Diagnostic']['lastCompletedCheckpoint']=='sent_event_observed' and not l['j3Diagnostic'].get('failure')
assert r['status']=='journeys-passed' and not r.get('primaryFailure') and not r.get('evidenceFailure') and not r.get('interruptedBy')
c=r['counts'];assert c['roleCreate']==c['userCreate']==0 and c['reactivate'] in [0,1] and c['childRun']==c['deactivate']==1
assert r['child']['exitCode']==0 and r['child']['signal'] is None and r['child']['timedOut'] is False
assert r['preservation']['exactMatch'] and r['preservation']['ownedUserInactive'] and r['preservation']['ownedRoleRetained']
d=r['deactivation'];assert d['getStatus']==404 and d['activeListAbsent'] and d['freshLoginStatus']==401 and d['issuedJwtRevocationClaimed'] is False
assert l['verdicts']=={j:'passed' for j in ['J1','J2','J3','J4','J5']}
assert l['preservation']=='passed' and l['finallyDisable']=='disabled' and not l.get('secondaryFailures') and not l.get('diagnosticWriteFailure') and not l.get('failedStage')
assert l['finallyDisableEvidence']=={'status':200,'state':'disabled'}
assert len(l['channelIds'])==2 and l.get('workflowId') and len(l['manifests'])<=2 and len({v['name'] for v in l['manifests']})==2
expected=[('channel',i,'retained') for i in l['channelIds']]+[('workflow',l['workflowId'],'disabled')]+[('manifest',v['name']+'@'+str(v['revision']),'retained') for v in l['manifests']]
assert len(expected)==5 and len(set(expected))==5
assert sorted((v['kind'],v['id'],v['status']) for v in l['retained'])==sorted(expected)
assert all(re.fullmatch('[0-9a-f]{64}',v['hash']) for v in l['retained'])
checkpoints=sorted(n for n in new if str(Path(n).parent)==str(Path(led[0]).parent) and re.fullmatch(r'j3-checkpoint-[0-9]{3}\.json',Path(n).name))
assert checkpoints,'missing fresh J3 diagnostic checkpoints'
result={'attempts':'1/1','wrapperInvocations':1,'journeys':l['verdicts'],'resourcePreservation':'passed','identityPreservation':'passed','workflowId':l['workflowId'],'workflowStatus':'disabled','runId':l['runId'],'invocationId':r['invocationId'],'sourcePreserved':True,'reviewStatus':'pending','temporaryGeneratedPaths':[n for n in new if n.startswith((play,identity,fs))]}
with (out/'verification-result.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps({k:v for k,v in result.items() if k!='temporaryGeneratedPaths'},indent=2))
PY_RESULT
```

J2 records two manifest names and their observed revisions. QA inspects the exact
name/revision sequence as source defines, rather than inferring write counts from
only a unique-name count. QA checks the frozen source's bounded writes plus actual
outcomes; no additional instrumentation or network interception is authorized.

### G9 — Frozen report integrity and final guards

Principal prepares `active/runtime-report.md` from actual results: each journey,
setup/build/poststate results, source/image identity, safety, preserved fixtures,
limitations, attempt count and any unknowns. Do not copy retired evidence. Freeze
it with current code, SPEC and the complete temporary validation packet before
these commands and dual review. Successful report is not approval by itself.

```bash
set -e
git diff --check
./scripts/checks/doc-code-guards.sh
python3 - <<'PY_REPORT'
from pathlib import Path
import json,hashlib
p=Path('manual-loops/architecture/platform-evaluation-j1-j5/active')
r=json.loads((p/'verification-result.json').read_text())
assert r['attempts']=='1/1' and r['wrapperInvocations']==1 and r['sourcePreserved']
assert r['journeys']=={j:'passed' for j in ['J1','J2','J3','J4','J5']}
t=(p/'runtime-report.md').read_text()
for heading in ['## Journeys','## Images and source','## Safety and preservation','## Limits and pending work']:assert heading in t,heading
assert t.strip()
print('report sha256',hashlib.sha256(t.encode()).hexdigest())
PY_REPORT
```

The textual report's truth/completeness is checked by two independent reviewers,
not established by heading checks. Both receive identical full untracked harness
content, current source/contract, baseline ownership, exact gate outputs/statuses,
all diagnostics and actual requested/observed native provenance. No self-review.
Any changed code/contract/result requires new gates/reviews; this one-attempt SPEC
authorizes no such rerun. A review rejection blocks with a decision, not correction.

## QA acceptance definitions A1–A10

These definitions are prospective acceptance criteria, supplied by native fp-qa
and reconciled by the principal. None is a claim of executed acceptance. Static
coverage is frozen before gates; runtime observations occur only in the one
approved attempt. A failure never authorizes another attempt or weaker assertion.

### A1 — Native role, provenance, cost and concurrent reviewers

Input: fresh native dev/QA/runner calls, two simultaneously running independent
reviewer tasks, task-scoped native metadata and applicable account billing basis.
Accept: requested dev/QA Sol/medium, runner Luna/low and both reviewers Astra/high
match actual run/turn/model/effort and native-source identity. Parent inherited
turns are excluded. Both reviewers coexist and are independently addressable;
final gate/review turns require their own provenance. Account evidence establishes
Luna's approved economical-tier exception and cost below Sol, not API prices,
configuration or self-report alone. Finished probes leave active capacity for
later roles; no future capacity reservation is inferred from probes.
Failure: missing role, provenance, concurrency or applicable cost is
BLOCKED_NOT_STARTED, attempt 0/1, wrapper 0/1; no retry/substitution/repair.
Mapping: A0, AGENTS Verification, native authoring provenance and cost record.

### A2 — Fresh inputs, ownership, seal and exact command packet

Input: current HEAD and 3816-entry source baseline, including 415 tracked absences,
six untracked harness files and compact-records changes; current authoring inputs.
Accept: source entries retain content/mode or absence/link identity; this task's
excluded SPEC/subtree are separately pinned as admission inputs. Harness/lockfile
match declared hashes. No retired input is recovered. Human approves reconciled
inputs; new seal covers SPEC and all five authoring inputs, with SPEC/seal hashes
pinned in native handoff outside the mutable workspace. QA statically verifies
12 literal common-prefix/body commands, fixed cwd and one command argv to
`/bin/bash -o pipefail -c`. No attempt marker exists until exclusive creation
immediately before G0; that creation consumes attempt 1/1 even if dispatch fails.
Failure: drift, missing input, ambiguous command or seal mismatch blocks and
requires explicit reconciliation/approval. After marker creation the attempt is
consumed; no silent refresh, reset or historical proof substitution.
Mapping: approval seal, common guard, baseline ownership, G0/G8.

### A3 — Offline regressions and prerequisites

Input: sealed sources/tools, frozen lock, retained identity metadata and installed
Chromium. Identity and `.env` contents remain private and unread by agents.
Accept: G0 pinned versions/guards pass; frozen G1 install/typecheck/syntax checks
exit 0 without lock drift. Runner self-test 26, config 14, state 34: zero
failed/skipped; four service suites and workflow typecheck pass with actual counts.
Discovery yields exactly one J1–J5 test. Chromium is executable, not launched.
Retained identity is regular, same-owner, 0600; credential file is readable.
Failure: PRE_EXECUTION_FAILURE after attempt consumption, wrapper 0/1. Stop at
first failure; no retry/install/upgrade/browser launch or live identity claim.
Mapping: G0/G1 and unchanged evaluator regression sources.

### A4 — Exclusive cluster, frozen builds and immutable image correspondence

Input: human confirms no concurrent cluster/source-mount operator; OrbStack already
running; orbstack context, platform-services-dev namespace; seven apps/ten selected
containers, existing suspended scrub and ten PVCs.
Accept: G2 records and pins actual Docker/kubectl client/server tuple; log access,
console routing and anonymous API 401 pass. All specified readiness, Bound PVC,
scrub/no-active-job, absent dev-mode/watch/hostPath predicates hold. G3 builds seven
images serially with frozen install, existing esbuild/Angular steps, full logs,
base/runtime versions and immutable identities. G4 affects only ten existing
workloads of seven apps. G5 proves Ready controller state and exact immutable
built/live image correspondence, preserving dependency/PVC/scrub identities.
Failure: PRE_EXECUTION_FAILURE, attempt 1/1, wrapper 0/1 once started; record partial
deployment and stop. No retry/startup/reset/bootstrap/rollback/repair. Before any
attempt marker, unresolved admission/exclusivity remains not started.
Mapping: constraints, G2–G5; no OrbStack invocation during authoring.

### A5 — J1 access and bounded tenancy claim

Input: exact retained restricted acme identity reused by the one wrapper, admin
login, anonymous navigation, missing token and mismatched tenant header.
Accept: anonymous workflows navigation redirects to login; missing token is 401;
real login is 201 with token/tenant:acme scope and dashboard/workflows load.
Restricted identity has neither wildcard nor tracking:payload:read. Mismatched
tenant request is 403. The harness does not inspect that response body: this
establishes rejection, not a body-level no-foreign-record assertion or broad
isolation/issued-JWT revocation proof.
Failure: J1 failed, later journeys pending; safe stage/status only and authorized
finalizers only. Auth setup failure before J1 stays setup failure.
Mapping: J1 source, G6 and G8 verdicts.

### A6 — J2 provisioning, exact ownership and idempotence

Input: fresh names, pre-apply semantic snapshots, valid two-channel/one-workflow
manifest, invalid schema and unresolved-reference manifest.
Accept: no collision; schema positive/negative cases hold. First valid PUT stores
revision/hash, plan is three creates, first apply is applied=3/noop=0. Capture IDs
before count assertions: two UUID channels and one NanoID workflow, exact
name/tenant verified. Second valid PUT advances revision; plan is all noop and
apply is applied=0/noop=3 with identical IDs. Invalid-reference plan identifies
unresolvable_external_ref and missing-owned-channel and is never applied.
Non-owned semantic snapshots remain equal. There are three manifest PUTs across
two retained names: ledger sequence is valid name at second observed revision,
then invalid name at its observed revision, each with hash. Two stored manifests
means two named resources, not two write calls; QA inspects actual sequence.
Failure: J2 failed; preserve exact captured/partial IDs, safe issues/revisions/hashes;
no adoption by prefix, DELETE or unresolved apply. Later journeys pending.
Mapping: J2, pure apply/ownership/snapshot tests, G6/G8 plus QA sequence inspection.

### A7 — J3 owned execution and safe ordered diagnostics

Input: exactly owned inbound account verified by captured ID/name/tenant/channel/
active/secret facts; externalId encoded once as one URL segment; first nonce.
Accept: immutable ordered checkpoints record attempts before completion across
eight operations; ingress accepted, owned NanoID execution COMPLETED within 120s,
expected result/branch and UUID correlation match; tracking resolves Temporal IDs,
send-owned/expected branch, no false step; exactly one sent event on e2e-tests.
J5 confirms same first nonce and recipient. Last checkpoint sent_event_observed,
no failure, only allowlisted safe observations persisted.
Failure: J3 failed with last completion, attempted operation, safe latest owned
state and supported category; diagnostic-write failure cannot replace primary.
No raw payload/token/secret/nonce, extra runtime probe or rerun.
Mapping: J3, state/diagnostic/checkpoint boundary regressions, G6/G8.

### A8 — J4 exact-ID toggle and bounded final disable

Input: captured NanoID workflow re-read by exact ID/name/tenant, execution baseline,
second disabled-attempt nonce and third re-enabled nonce.
Accept: disable; acknowledged disabled ingress with positive safe refusal-log
match; no new owned execution throughout 120s. Enable; third nonce yields new
COMPLETED execution within 120s. Disable again; finally performs at most one
additional owned disable with status 200/state disabled. Maximum four workflow
status PATCHes and exactly three total synthetic ingress POSTs on success.
Failure: J4 failed; only the existing single finally disable may proceed. Unknown
or failed final authority/state is safety failure with known ID; preserve primary,
record secondary, never rescue PATCH.
Mapping: J4/finally, authority/failure regressions, constraints, G6/G8.

### A9 — J5 correlated built UI and payload authorization

Input: owned workflow/execution, Temporal workflow/run IDs, correlation, admin and
restricted token, built workflow/trace/run routes.
Accept: completed API run and exact Temporal/correlation IDs; step detail/spans,
zero failed steps and at least three successful steps, compute/route/send-owned
completions, expected branch/no false step. Chain correlation and causal links
match, orphan count zero. Built UI shows corresponding owned IDs/status/actions.
Webhook/sent payloads match first nonce and sent recipient; unknown event is 404,
restricted payload access 403.
Failure: J5 failed with safe IDs/category only, no raw assertions, payload,
credentials, screenshots, traces, HAR or video. Authorized finalizers still run.
Mapping: J5, privacy config/regressions, G6/G8.

### A10 — One invocation, preservation, report and independent review

Input: exclusive wrapper marker, retained identity, fresh invocation/ledger/
checkpoints, actual gate output and source/build/cluster identities, frozen report.
Accept: wrapper1/child1/workers1/retries0; roleCreate=userCreate=0, reactivate0..1,
deactivate1. General runner self-tests allowing creation do not satisfy this exact
zero-create retained-identity contract; G8 assertions and actual outcomes do.
Identity GET404, active-list absence and fresh-login401, exact retained role and
preexisting identity hashes; no JWT-revocation claim. Two channels, disabled
workflow and two manifest name@revision hashes retained; non-owned API projections
match (not full database equality). G7 infrastructure and G8 complete source/
allowed-new-path preservation pass. All five journeys passed/zero skipped; no
primary/evidence/interruption/secondary/diagnostic failure; exact final disable
record present. G9/report cover actual journeys, build/setup/poststate, identities,
safety, attempts, limits and unknowns. Two parallel independent Astra/high reviewers
receive identical unchanged full task files/diffs, baseline ownership, actual
outputs/status/durations and requested/observed provenance; both APPROVED.
Failure: wrapper launch onward EXECUTION_FAILURE; postcheck/report/provenance or
review failure VERIFICATION_FAILURE. Preserve observed results and stop for a
human decision, never correct-and-rerun. The 15-minute child timeout can preempt
workflow finally; unknown workflow state stays unknown, outer user deactivation
is independently attempted. No extra cleanup except authorized finalizers and
later precisely verified evidence retirement. No commit authorized by this SPEC.
Mapping: G6–G9, failure/retirement contract, AGENTS verification and dual review.

## Task queue

### R01 — Evaluate current built product once and report honestly

Allowed writes and non-goals are exactly Constraints above. Read full AGENTS,
this SPEC, current6evaluator files and compact original/recovery/C01 summaries.
Never load retired packets as baselines or proof. Dev inspects source/read-only
and supplies failure handoff if needed; QA assesses cases A1–A10 before gates.
No source implementation/test edits are in scope. Principal freezes the packet;
mechanical runner executes G0–G9 in order once; independent reviewers judge it.

**Accept:** all exact gates exit0, J1–J5 passed with zero skips, source/image and
safety/preservation predicates satisfied, all actual provenance available, two
independent APPROVED reviews of the unchanged state. Record successful outcome
only when all hold. Otherwise stop and retain a comprehensible blocked outcome
with achieved/remaining, supported cause/uncertainty and one concrete human decision.
Do not proceed to original T03/T04 or another task.

## Failure handling and temporary evidence

After first failure, skip all later success gates. The existing wrapper/harness
finalizers are the only permitted further mutating operations. No automatic
redeploy/rollback, diagnostic HTTP call, job, fixture patch, or rerun. Native
outputs, completed command list, exclusive attempt/wrapper markers and available
fresh ledgers diagnose what actually ran. Missing evidence means unknown, not pass.
If partial infrastructure state needs inspection, the principal proposes its exact
read-only scope to the human; no unstated runtime diagnosis is part of this task.

Keep full sanitized output, hashes, diffs, source manifests, build recipes, run
identity and independent verdicts in this task's active packet through validation.
On pass or block verify `SUMMARY.md` against the packet, preserving achieved,
remaining/blocked, attempt1/1 (or admission0/1), per-journey result, safety state,
known owned IDs needed for a later decision, and actual verification outcome and
provenance limits. Preserve the SPEC and compact summary. Retire only this task's
verified temporary packet and the positively identified newly generated UUID/
invocation test evidence; no broad evidence-root deletion, fixtures, credentials,
preexisting summaries or other working files. Verify the exact retirement list
against the start baseline; uncertainty means stop before deletion. No git cleanup.
Retirement is record lifecycle, not application cleanup or reproducibility proof.
A blocked result does not invalidate historical closures or restart any budget.

## Progress

- Achieved: original scope approved; resumed A0 with fresh baseline/tools and
  observed native role turns, including two reviewers concurrently running.
- Remaining: final frozen current input/command QA assessment,
  approve reconciled input digests, resolve account-cost applicability, then A0/R01.
- Pending runtime prerequisites: OrbStack already running, explicit confirmation
  of no concurrent cluster/source-mount operator, and the declared G2 observations.
- Attempts: R01 0/1; wrapper 0/1; Playwright children 0; gates/builds/tests/runtime 0.
- Validation: preparation only; no final task APPROVED review, no product claim.
- Original exhausted and closed ledgers remain unchanged; see SUMMARY.md.

## Subsequent boundaries

Original T03 requires a selected useful finding, approved exact source/test paths,
regressions and actual rebuilt delivery proof. T04 still owes product findings and
record disposition linked to that proof; prior record compacting does not satisfy
it. Scheduler E13, MCP e2e, manifest parity, ValidationPipe, tenant messaging-tier
closure and compact-records provenance remain separate work. No budget reset,
tooling repair, product correction, broad inventory cleanup or inherited task rerun.

## Human approval requested

The original execution scope remains approved. Approve only this A0 adjustment:
explicit QA A1–A10, fresh authoring inputs, consistent baseline pins (including
build labels), reconciled authoring status, and the exact current command packet.
This approval does not waive role/cost admission or expand the one-attempt scope.
The new approval seal must bind the approved current SPEC and authoring inputs;
its digest is pinned in the native handoff after approval, never reconstructed
from the retired packet. No attempt marker is created during preparation.
Before runtime, OrbStack must already be running and the human must confirm no
concurrent cluster/source-mount operator. No implicit setup or restoration.
