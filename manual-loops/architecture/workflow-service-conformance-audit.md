# SPEC: Workflow-service conformance audit

> Origin: user authorization on 2026-09-05 to audit one service without OrbStack.
> Engram topic: architecture/workflow-service-conformance-audit

## Goal

Establish an evidence-backed baseline of workflow-service conformance to current
contracts and engineering rules, separating proven defects, design debt and checks
that require the running stack.

## User decisions

Start with one service and critical contracts. Do not perform a general rewrite.
Audit source and run isolated checks now; live integration is a later checkpoint.

## Constraints

Full AGENTS.md applies. Source, existing tests and contracts are read-only.
No dependency installation, runtime service execution, cluster calls, commits,
deployment or fixes during this task. Existing changes must be preserved.
Findings need concrete source evidence and the rule/contract they violate.
Do not treat framework usage alone as a violation or infer whole-service coverage
from a passing suite. Record failed tests without weakening or suppressing them.

## Gates

```sh
cd services/workflow-service && bun test test/unit
```

From the repository root, using the already installed compiler only:

```sh
./node_modules/.bin/tsc --noEmit --incremental false -p services/workflow-service/tsconfig.json
/bin/bash scripts/checks/doc-code-guards.sh
```

Inspect isolated-test setup first. If a suite requires external infrastructure,
record it as unavailable rather than starting the stack. This is a diagnostic
audit: failed checks become findings, not a claim of service conformance.

## Task queue

### T01: Audit critical workflow contracts and persist findings

Allowed writes: this SPEC; new DOCS/architecture/workflow-service-conformance.md;
append-only DOCS/archive/INDEX.md. Source, dependencies and tests remain unchanged.

Compare Temporal determinism, execution and cancellation semantics, publication
and causal contracts, tenant isolation, storage parity and FP boundaries against
AGENTS.md, the service README and relevant cross-cutting specs. Prioritize concrete
risks over stylistic preferences. Run isolated unit tests and local typecheck;
capture command, exit, output, runtime and file-state identity.

**Accept:** The diagnostic report records source-backed findings with severity,
observed check results and coverage limits; two independent reviewers approve
the report's evidence, not the service. A failing service test is not concealed
and does not prevent completing this diagnostic report.

## Progress

- [x] T01: Audit workflow-service and record findings and integration follow-up.

### T01 completion evidence (2026-09-05)

- Deliverable: `DOCS/architecture/workflow-service-conformance.md`; six source-backed findings. This closes the diagnostic task, not service remediation or certification.
- Unit gate: `bun test test/unit`, run from `services/workflow-service`, Bun 1.3.1, exit 0: 283 passed, 0 failed, 615 assertions across 18 files, 2.66 seconds. Log: `/tmp/workflow-conformance-20260905/unit.log`.
- Type gate: `./node_modules/.bin/tsc --noEmit --incremental false -p services/workflow-service/tsconfig.json`, TypeScript 5.9.3, exit 0 without diagnostics. Log: `/tmp/workflow-conformance-20260905/types.log`.
- KISS gate: `/bin/bash scripts/checks/doc-code-guards.sh`, exit 0. DI guard scanned 0 modified files; this is not evidence of whole-service architectural conformance. Log: `/tmp/workflow-conformance-20260905/kiss.log`.
- Integrity: all 71 captured source, test and configuration files remained unchanged against the pre-test manifest `/tmp/workflow-conformance-20260905/source.sha256`. Manifest SHA-256: `f62531ede9cf64e4870201affd8e0b3cc809e9a8f93f16ee91acaa4740c6e062`.
- Report SHA-256: `6e089896b6e38e85fa4dfb00839e3d43d7f3077d9ca4120d917abcb5bfdc22b4`. All 21 local report links resolved; source anchors were independently reviewed.
- Dependency identity: `pnpm-lock.yaml` SHA-256 `edf298f7be61b797430cdd6edb41ebe920e142239afd24e00baf1f6bcab83a68`; `bun.lock` SHA-256 `90c4fb1eafe7dd649451ac0789e31d11634295a5a11fefbb197c358b369b65c1`. Used existing installed dependencies; no fresh frozen installation or reproducible-build certification.
- Independent reviewer McClintock (`01a07254-0268-7f23-bd44-26eef28a19b0`): APPROVED, report only, no required corrections. Independently checked all six findings and source anchors; did not rerun gates.
- Independent reviewer Kierkegaard (`01a07254-02ad-7863-bdb7-4f77917e9d3a`): APPROVED, report only, no required corrections. Independently checked all six findings and source anchors; did not rerun gates.
- Both reviewers inherited the parent model without a weaker model override. Gate results were supplied by the parent and identified as such in both verdicts.
- No failed gates, retries, runtime fixes, dependency installs, cluster calls, commits or pushes during this audit. Live Temporal, NATS and database behavior remains unverified and is explicitly separated in the report. This was not an exhaustive security or dependency audit.
- Engram was unavailable in this session. Decisions and evidence are persisted in this SPEC and the report, with an append-only archive index entry; no external memory persistence is claimed. Temporary logs are local evidence, not durable CI artifacts.

## Out of scope

Code fixes, unit-test modifications, full-repository certification, benchmarks,
dependency upgrades and real NATS/Temporal/database/cluster validation.

## Human boundaries

The audit and isolated tests are approved. Present fixes and required live checks
as follow-up scope; do not start OrbStack or reinterpret product decisions.
