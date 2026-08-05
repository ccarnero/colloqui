# Doc/code guard script — what `doc-code-guards.sh` actually pins

Class: descriptive
Summary: As-built description of every guard registered in `scripts/checks/doc-code-guards.sh` (G6a-G6g, G7-G11, G12-G14) and what each one fails on.

> Split out of the former `DOCS/guides/doc-code-validation-tests.md` by the
> docs-truth-audit T10 (ruling D9); this file is its "Implemented" half. The unimplemented test proposal that used to
> share this file now lives at
> [`../v_next/doc-code-validation-tests.md`](../v_next/doc-code-validation-tests.md).
> The script is the source of truth: when a guard changes, this file follows.

`scripts/checks/doc-code-guards.sh` implements the locks the 2026-07-07 audit
numbered **K6, K7 and K8** (`DOCS/archive/audits/DOC-VS-CODE-AUDIT.md`, "Locks"
section — that file is a RECORD and keeps its own K-numbering; its crosswalk
table maps each K to the guard that shipped), plus `G9`/`G9b`/`G10`/`G11` and
`G6g` added later by `manual-loops/architecture/docs-consistency.md` (T01-T06)
and `G12`/`G13`/`G14` added by `manual-loops/architecture/docs-truth-audit.md`
(T10). Every guard IN THIS SCRIPT carries a `G` prefix: the docs-truth-audit's
ruling D28 renamed the implemented family K→G, same numbers, because the audit's
K1-K10 proposal collided by number with the shipped K6a-K11. It is a standalone bash script — this repo has no `lefthook.yml`
or CI pipeline yaml yet, so there was no existing aggregate to wire it into.
Run it manually or from a future CI job:

```bash
scripts/checks/doc-code-guards.sh       # quiet: only prints failures
scripts/checks/doc-code-guards.sh -v    # verbose: also prints PASS lines
```

It exits non-zero the moment any guard fails, naming the failing guard ID.

What it pins:

- **G6a** — every service documented in `DOCS/architecture/overview.md`'s
  Service Roles table has a matching `services/*` directory (and vice
  versa). `workflow-service-api` / `workflow-service-worker` are normalized
  to the single `workflow-service` directory.
- **G6b** — no `kind: ScaledObject` resource exists anywhere under
  `knative/` or `infrastructure/` (KEDA was removed).
- **G6c** — the min-scale/max-scale annotations on each
  `knative/services/base/*.yaml` match the "Knative Autoscaling" table in
  `overview.md`. Rows marked `—` (plain Deployment, not Knative-scaled) are
  skipped by design.
- **G6d** — every `scripts/...` and `e2e/...`-shaped path referenced in
  `README.md` / `DOCS/README.md` exists on disk.
- **G6e** — every alert name in `observability.md` §4 ("Implemented
  Alerts") has a matching `alert:` entry in
  `infrastructure/base/observability/prometheus/alerts.yaml`, and
  `TemporalHistoryShardImbalance` does NOT exist in that file (removed; see
  §4.7's note — the guard is careful to only read table rows, not that
  explanatory prose, when extracting "implemented" alert names).
- **G6f** — every runbook under `DOCS/archive/runbooks/` carries a
  "Status: Historical" banner in its first 10 lines.
- **G6g** — no `services/*/AGENTS.md` or `packages/*/AGENTS.md` exists. Every
  per-component agent file was absorbed into that component's README (T02-T04),
  so the README is the single descriptive doc per component; the root
  `AGENTS.md` (repo constitution) is anchored out of both globs and never
  matches.
- **G7** — NATS durable-consumer ackWait census: every registration via
  `MultiTenantConsumerManager`/`ensureDurableConsumer` under `services/`
  must declare an explicit `ackWaitMs`, OR be on an explicit allowlist (with
  a one-line justification) inside the script. A repo-wide scan also fails
  the guard if a brand-new registration site appears that isn't in the
  script's known-files census, forcing a conscious ackWait decision instead
  of silently inheriting the 60s package default (see
  `DOCS/archive/audits/ASYNC-RESILIENCE-AUDIT.md` F1: long-running handlers under a
  60s ackWait cause JetStream redelivery and duplicate execution).
- **G8** — `knative/services/base/ai-agent-gateway.yaml` and
  `api-gateway.yaml` both set `spec.template.spec.timeoutSeconds >= 960`
  (900s `AGENT_CALL_TIMEOUT_MS` + margin), and
  `knative/serving/config-defaults.yaml`'s `max-revision-timeout-seconds`
  is at least the same.
- **G9** — constructor-injected classes are never imported type-only (Biome's
  `useImportType` vs NestJS `emitDecoratorMetadata`: a runtime DI failure that
  `tsc` cannot see). Delegates to `scripts/checks/check-di-imports.mjs`, scoped
  to git-modified files.
- **G9b** — numeric claims in docs match generated reality. Today it pins the
  golden row count: `services/tracking-ingester-service/README.md`, the test
  name and the `expect(rows.length).toBe(N)` assertion in
  `test/classify.golden.spec.ts` must all equal the data-row count of
  `golden/labeled.tsv` (non-blank lines minus the header).
- **G10** — every relative `.md` link in `README.md`, `DOCS/**/*.md` (including
  `DOCS/archive/**`), `services/*/README.md`, `packages/*/README.md` and
  `fixtures/bus-events/README.md` resolves to an existing file. Fenced code
  blocks and inline code spans are skipped to avoid false positives; for
  `file.md#anchor` only the file part is resolved. `manual-loops/**` is
  excluded as frozen loop history — the archive is NOT, because its prose is
  frozen but its links are navigation and repointing one falsifies nothing.
  G10 also fails on a lowercase `docs/…` path reference whose `DOCS/`-cased
  twin exists on disk: lowercase resolves on macOS and is a dead path on
  Linux/minikube. That sub-check additionally scans `TAXONOMY.md`,
  `SCHEMAS.md` and `DRIFT.md` (where the bug lived: 31 refs, all corrected),
  and deliberately skips `DOCS/archive/**`, whose records QUOTE the bad paths
  as evidence.
- **G11** — every service whose non-test source calls `resolveStorageEngine()`
  documents `DB_ENGINE` (or `STORAGE_ENGINE`) in its README. The service set is
  DISCOVERED from the code rather than hardcoded, so a new dual-backend service
  is caught without editing the script. Covers 10 services today.
- **G12** — every `DOCS/**/*.md`, `services/*/README.md` and
  `packages/*/README.md` declares its class in the first 10 lines as a
  `Class: descriptive|prescriptive|future|RECORD|register` line PLUS a
  non-empty `Summary:` line. The 27 sample READMEs under `integrations/` and
  `demos/` are deliberately outside the corpus. Added by the docs-truth-audit
  T10 (ruling D1/D24).
- **G13** — doc references written inside source stay true: every
  `DOCS/…`- or `cowork/…`-shaped `.md` path mentioned under `services/`,
  `packages/`, `sdk/` or `scripts/` must exist on disk, and no source file may
  pin a doc by line number (`envelope.md:77`-style). Closes the two drift
  classes the audit found: six files citing a `DOCS/cowork/` path that never
  existed, and seven pinning `envelope.md` line 77/402. Added by T10 (D25).
- **G14** — no NEW hard-coded hex colour literal (`#rrggbb`) is added under
  `services/admin-console`. It reads only ADDED lines in `git diff HEAD`, so
  the 58 files that already carry one are grandfathered debt rather than a
  permanently red guard; AGENTS.md's clause was softened to match. Added by
  T10 (D32).

**Genuine finding while calibrating G7**: the audit's lock description
assumed only `workflow-service`'s `trigger-consumer` needed allowlisting for
the 60s default. A full repo census found that several registrations omit
`ackWaitMs` entirely; the allowlist in `doc-code-guards.sh` now carries
**11 entries** — auto-reply, both usage-aggregator managers,
webhook-ingress-consumer, execution-projector, ai-agent-gateway's executions
consumer, channel-egress, all three audit-service consumers, plus
tracking-ingester's `main.ts` and its `consume-events.ts` doc-comment mention.
None of their handlers do LLM/embedding calls or large-file processing, so
the implicit 60s default is safe for all of them today — they are allowlisted
explicitly in the script with a one-line justification each, rather than
silently ignored, so a *future* consumer with a slow handler that forgets
`ackWaitMs` still fails this guard. `workflow-service`'s `trigger-consumer`
in fact already sets `ackWaitMs: 60_000` explicitly (it doesn't rely on the
implicit default) and needs no allowlist entry at all.
