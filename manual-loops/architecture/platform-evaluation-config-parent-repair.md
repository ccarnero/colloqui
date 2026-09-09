# SPEC — Restore configuration-test parent directory setup

> Origin: user approved the concrete two-line correction with "ok adelante con el cambio" on 2026-09-09.
> Scope: this SPEC records that approved correction and its necessary offline validation; no product evaluation is authorized.
> Engram topic: `platform-cluster/platform-evaluation-config-parent-repair`.
> Engine: `DOCS/guides/manual-loop.md`; template: simple.
> Predecessor navigation: `platform-evaluation-j1-j5/SUMMARY.md` only; retired evidence is not reusable.

## Goal

The 14 configuration regressions pass when their evidence parent is absent and
when it already exists. Collision rejection, UUID leaf exclusivity, sentinel
preservation and worker privacy settings remain unchanged.

## User decisions and human boundaries

The human approved adding parent creation before the two existing strict leaf
creations. Limit implementation to those two additions. This approval authorizes
necessary offline regression verification and independent review, not a new
runtime evaluation or changes to production/configuration behavior. The separate
R01 stays exhausted at 1/1. No commit or Git mutation; preserve the untracked harness
and all compact-records work. New requirements need a separate human decision.

This is one new offline repair task under the standard manual-loop maximum of
four implementation attempts. It grants zero runtime/wrapper/cluster attempts
and resets no predecessor ledger. Same-error-twice and stop-on-first-failure rules
apply. Cold and warm tests below are distinct acceptance cases, not retries.

## Constraints

- Full AGENTS.md, engine and shared role contracts apply. Principal coordinates;
  native fp-dev implements; fp-qa supplies cases and validates coverage; native
  script-runner executes exact gates; two independent fp-reviewer agents judge
  the same unchanged implementation and evidence in parallel.
- Use project native roles: dev/QA Sol-medium, runner Luna-low, reviewers
  Astra-high. Observe actual run/turn/model provenance for this task. The human
  confirmed this session uses his subscription; documented Codex subscription
  relative rates put Luna below Sol, satisfying the existing economical-tier
  exception. No exact invoice/plan-label mapping, new exception or model fallback.
- Developer writes only `e2e/platform-evaluation-config.test.mjs`. Principal
  writes this SPEC and `platform-evaluation-config-parent-repair/{active/**,SUMMARY.md}`.
  No other harness, production, package/lockfile, role/configuration/guard edits.
- Preserve every test name, assertion, sentinel literal, strict leaf mkdir,
  timeout and config-loader behavior. No hooks/helpers/refactor or new library.
  The existing failing cases are the regression tests; no assertions are weakened.
- Data/calculations are unchanged. The two added filesystem actions belong to
  the existing imperative test setup. Existing test-runner failures remain visible.
- Fresh baseline: `active/baseline.json`, SHA256
  `043abcda5a252639a9735392e744fd95144c2d8566f942149d68b2b20bc4c9cf`,
  HEAD `a5e6146250bfcee197c32dc6fab9b6107c7510a6`, 3818 entries, 415 absences.
  The test file starts at SHA256
  `acabe00eef56e86b9db257c2ebf344d53c35b7d8a618352a3d6bd501c9d259f7`.
  Its complete fresh source is retained separately for an exact two-line diff.
  All other baseline paths, modes, links and absences remain unchanged.
- Generated effects: tests may recreate absent parent directories and new UUID
  children containing only their existing sentinel files below
  `manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright/`.
  Never recreate retired file content or overwrite/adopt an existing UUID child.
  No browser launch, wrapper, HTTP, identity access, runtime, cluster, builds,
  install/upgrade, dev-mode toggling or fixture mutation. Config CLI `--list`
  subprocesses are offline test behavior, not product execution.
- No cold-state cleanup before gates. Require the evidence root absent; if an
  external operator creates it, stop and reconcile ownership rather than deleting
  their work. Keep generated sentinels through review. After successful or blocked
  summary verification, retire only exact positively identified task-generated
  files and temporary packet files. Remove their UUID directories and each newly
  created parent only if empty, leaf-to-root; never remove a preexisting directory.
  Preserve every preexisting file and record.
- This test-only correction affects no deployable build. No image/build/runtime
  gate applies, and no artifact reproducibility or product-readiness claim follows.

## QA acceptance

- Cold parent: the full suite succeeds with the evidence root initially absent,
  proving fixture setup recreates parents without prerequisite manual mkdir.
- Existing parent: the full suite succeeds again with the parent present and
  preserves the prior run's sentinel files byte-for-byte.
- Every run reports exactly 14 tests, 14 passed, zero failed/skipped/cancelled.
  Coordinator collision still rejects and retains its sentinel; worker reload
  still enforces workers1/retries0 and screenshot/trace/video off.
- The implementation diff is exactly two parent mkdir additions; strict UUID
  leaf mkdir remains `recursive: false`. Every other baseline entry is preserved.
- No product runtime, prior packet recovery, historical-task reopen or budget reset.

## Gates

After implementation and pre-gate QA, the native runner executes each body once
in order from repository root using `/bin/bash -o pipefail -c`, with the whole
body as one argv value. Stop on first failure; no automatic command replay.
Principal owns any correction under this new task's budget. Retain exact command,
full sanitized output/status/duration, source identity and actual native turn.
Before first dispatch, pin the current SPEC, two-line diff and full changed test
hashes in the native handoff. Do not alter them during validation or dual review.

### G0 — Versions, syntax and repository guards

```bash
set -e
python3 - <<'PY_EXACT'
from pathlib import Path
original=Path('manual-loops/architecture/platform-evaluation-config-parent-repair/active/original-config-test.mjs').read_text()
current=Path('e2e/platform-evaluation-config.test.mjs').read_text()
needle='  await mkdir(directory, { recursive: false });'
insertion='  await mkdir(EVIDENCE_ROOT, { recursive: true });\n'+needle
assert original.count(needle)==2
assert current==original.replace(needle,insertion),'patch differs from the approved two-line repair'
print('exact two-line repair verified')
PY_EXACT
node -e 'if(process.version!=="v26.7.0")process.exit(1);console.log(process.version)'
node --check e2e/platform-evaluation-config.test.mjs
git diff --check
./scripts/checks/doc-code-guards.sh
```

### G1 — Cold-parent regression

```bash
set -e
python3 - <<'PY_COLD_PRE'
from pathlib import Path
p=Path('manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright')
for q in [p,p.parent,p.parent.parent]:assert not q.exists() and not q.is_symlink(),'cold parent chain must be absent; preserve existing work'
print('all three evidence parent levels absent')
PY_COLD_PRE
node --test e2e/platform-evaluation-config.test.mjs
python3 - <<'PY_COLD'
from pathlib import Path
import hashlib,json,re
root=Path('manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright')
u=r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
children=list(root.iterdir());assert len(children)==2
files={};contents=[]
for d in children:
 assert d.is_dir() and not d.is_symlink() and re.fullmatch(u,d.name)
 assert [p.name for p in d.iterdir()]==['sentinel.txt']
 p=d/'sentinel.txt';assert p.is_file() and not p.is_symlink()
 files[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest();contents.append(p.read_text())
assert sorted(contents)==['preserve-this-sentinel\n','worker-reload-sentinel\n']
with Path('manual-loops/architecture/platform-evaluation-config-parent-repair/active/cold-fixtures.json').open('x') as f:json.dump(files,f,indent=2)
print('cold run: two owned sentinel fixtures recorded')
PY_COLD
```

### G2 — Existing-parent regression and prior sentinel preservation

```bash
set -e
python3 - <<'PY_WARM_BEFORE'
from pathlib import Path
import hashlib,json
root=Path('manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright')
assert root.is_dir() and not root.is_symlink()
b=json.loads(Path('manual-loops/architecture/platform-evaluation-config-parent-repair/active/cold-fixtures.json').read_text())
for n,h in b.items():
 q=Path(n);assert q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==h
print('existing parent and cold sentinels verified')
PY_WARM_BEFORE
node --test e2e/platform-evaluation-config.test.mjs
python3 - <<'PY_WARM_AFTER'
from pathlib import Path
import hashlib,json,re
p=Path('manual-loops/architecture/platform-evaluation-config-parent-repair/active')
b=json.loads((p/'cold-fixtures.json').read_text())
for n,h in b.items():
 q=Path(n);assert q.is_file() and not q.is_symlink() and hashlib.sha256(q.read_bytes()).hexdigest()==h
root=Path('manual-loops/architecture/end-to-end-evaluation/evidence/t02/playwright')
u=r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
children=list(root.iterdir());assert len(children)==4
files={};newcontents=[]
for d in children:
 assert d.is_dir() and not d.is_symlink() and re.fullmatch(u,d.name)
 assert [q.name for q in d.iterdir()]==['sentinel.txt']
 q=d/'sentinel.txt';assert q.is_file() and not q.is_symlink()
 files[str(q)]=hashlib.sha256(q.read_bytes()).hexdigest()
 if str(q) not in b:newcontents.append(q.read_text())
assert sorted(newcontents)==['preserve-this-sentinel\n','worker-reload-sentinel\n']
with (p/'all-fixtures.json').open('x') as f:json.dump(files,f,indent=2)
print('warm run: four owned sentinels, cold pair unchanged')
PY_WARM_AFTER
```

### G3 — Complete source preservation

```bash
python3 - <<'PY_PRESERVE'
from pathlib import Path
import hashlib,json,subprocess
out=Path('manual-loops/architecture/platform-evaluation-config-parent-repair/active')
raw=(out/'baseline.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='043abcda5a252639a9735392e744fd95144c2d8566f942149d68b2b20bc4c9cf'
b=json.loads(raw)
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==b['head']
changed='e2e/platform-evaluation-config.test.mjs'
for n,e in b['files'].items():
 p=Path(n)
 if n==changed:
  assert p.is_file() and not p.is_symlink() and p.stat().st_mode & 0o777==e['mode']
  continue
 if e.get('absent'):good=not p.exists() and not p.is_symlink()
 elif 'symlink' in e:good=p.is_symlink() and str(p.readlink())==e['symlink']
 else:good=p.is_file() and not p.is_symlink() and hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256'] and p.stat().st_mode & 0o777==e['mode']
 assert good,'baseline drift: '+n
owned=json.loads((out/'all-fixtures.json').read_text())
for n,h in owned.items():assert hashlib.sha256(Path(n).read_bytes()).hexdigest()==h
paths=filter(None,subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split(chr(0)))
for n in paths:
 assert n in b['files'] or n in owned or n=='manual-loops/architecture/platform-evaluation-config-parent-repair.md' or n.startswith('manual-loops/architecture/platform-evaluation-config-parent-repair/'),'unexpected path: '+n
print('3817 unchanged baseline entries; only authorized test changed; four exact generated sentinel files')
PY_PRESERVE
```

## Task queue

### T01 — Make the two regression fixtures create their parent

Allowed writes: exactly the test file in Constraints; principal-owned records are
separate. Non-goals: production/runtime/config behavior, more tests, refactors,
new dependencies, prior task closure or new product evaluation.

At both existing `await mkdir(directory, { recursive: false });` calls, insert
immediately before them:

```js
await mkdir(EVIDENCE_ROOT, { recursive: true });
```

Do not change any other byte in the test file. Existing 14 tests carry regression
coverage; execute the two distinct parent-state runs via the mechanical runner.
QA validates exact cases/outputs and full-source preservation. Two independent
reviewers receive identical task SPEC, full AGENTS, full original/current test,
exact diff, baseline ownership, commands/results and actual model/run provenance.

**Accept:** G0–G3 all exit 0; cold and warm runs each 14/14 pass, zero skipped;
all original assertions and four sentinels preserved; exact two-line diff; all
other baseline paths unchanged; two parallel independent APPROVED reviews of the
same final state. No commit. No claim that blocked R01 or J1–J5 is now validated.

## Progress

- Achieved: exact approved two-line repair implemented; pre-gate QA ready;
  3817 other baseline entries preserved. Implementation remains uncommitted.
- Remaining: approval of `platform-evaluation-config-parent-repair/active/proposed-boundary-amendment.md`,
  then authorized fixture retirement, fresh gates, QA and parallel dual review.
- Blocker: attempt1 procedural replay/evidence loss; current contract does not
  permit intermediate cold-state cleanup. Preserve fixtures pending decision.
- Attempts: T01 1/4 consumed; 2/4 unused. Prior R01 remains exhausted1/1.
- Validation: second dispatch G0 exit0, G1 cold precondition exit1; its tests,
  G2/G3 not run. First dispatch full results unavailable; no final approval.
- Current navigation: `platform-evaluation-config-parent-repair/SUMMARY.md`.

## Out of scope

All cluster/product evaluation, changes to the other five harness files, package
or toolchain changes, commits, restoring retired evidence, reopening historical
loops, changing protected role configuration and any broader cleanup.
