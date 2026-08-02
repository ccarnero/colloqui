# DOCS-TRUTH-LEDGER.md — one row per documentation artifact

Built by T01 of `manual-loops/architecture/docs-truth-audit.md` on **2026-08-02**.
Filled by T02–T08, adjudicated in T09, executed in T10.

## Purpose

Every documentation artifact in this repo gets exactly one row here, and every
row ends the loop with exactly one verdict. This file is the single place where
"is this document true?" is answered — no verdict lives anywhere else.

## Verdict vocabulary

| Verdict | Meaning |
| --- | --- |
| `pending` | not audited yet (T01 leaves every row here) |
| `TRUE` | verified against the code, kept where it is, unchanged |
| `FIXED` | drift corrected in place — the code won |
| `RECLASSIFIED` | class changed and/or moved/merged into the approved structure |
| `DELETED` | adds nothing; removed (T10 only, after the T09 human round) |

## Rules that bind this ledger

1. **The code is the source of truth.** A doc-vs-code difference is a DOC bug by
   default. If a difference reveals a genuine CODE bug, STOP and escalate as a
   decision — this loop never changes runtime code silently.
2. **No citation, no verdict.** Every `FIXED` row cites the code that
   contradicted the doc (name-based: constant/function/file names, never `:NNN`
   line cites — they rot within days). Every DELETE proposal states what, if
   anything, replaces it. A row with a verdict and an empty Evidence cell is
   invalid and must be sent back.
3. **RECORDS are not audited for present-truth.** `manual-loops/*`, `golden/*`,
   `DRIFT.md`, `cowork/INDEX.md` and friends describe their date. They get
   CLASSIFIED (and dead working notes proposed for deletion in T09), but their
   historical claims are never rewritten.
4. **Prescriptive docs keep their class.** Any clause the code has never honored
   is flagged in the Evidence cell for the T09 round instead of being silently
   "fixed" in either direction.
5. **TAXONOMY.md / SCHEMAS.md / AGENTS.md are read-only** except through an
   escalated decision.

## Class vocabulary

`descriptive` (as-built) · `prescriptive` (contract/how-to the code must obey)
· `future` (design not yet built) · `RECORD` (dated, historical) · `skill`
(agent-facing SKILL.md and its assets) · `script-header` (a shell script's
header comment block, which is that script's document of record) · `fixture`
(sample content shipped as data, not a description of code).

## Reconciliation (T01)

Commands run at the repo root on 2026-08-02, **after** this ledger existed. `-H`
is mandatory: without it fd skips dotted directories and 68 tracked documents
(`.claude/`, `.agents/`, `.sdd/`) vanish from the census.

```
fd -H -e md --type f | wc -l              →  273
git ls-files '*.md' | wc -l               →  272   (= 273 − this ledger, untracked)
fd -e md --type f | wc -l                 →  205   (no -H: 68 hidden docs missing)
fd -H -e md --type f | rg '(^|/)\.' | wc -l → 68   (the hidden surfaces)
fd -H -e sh --type f | wc -l              →   47   (= git ls-files '*.sh')
fd -H -e sh --type f . scripts | wc -l    →   18
fd -H -e sh --type f --max-depth 1 | wc -l →  10
fd -H . skills/*/assets --type f | wc -l  →   12
```

Two files need manual handling and neither can be recovered by any `fd` census:

- `cowork/DOCS-TRUTH-LEDGER.md` (this file) is the audit's **instrument**, not
  one of its subjects: **−1**.
- `CLAUDE.md` is **gitignored** (`.gitignore` line 128, `git check-ignore -v
  CLAUDE.md` confirms) and untracked, so it appears in neither `fd -e md`,
  `fd -H -e md`, nor `git ls-files` — only `fd -I` would show it. It is
  nevertheless a real doc in every working tree and makes a checkable claim
  ("follow AGENTS.md"), so it is added by hand: **+1**.

Arithmetic to the row count:

```
  273  fd -H -e md --type f
-   1  this ledger (instrument, not subject)
+   1  CLAUDE.md (gitignored → invisible to fd/git, added by hand)
-----
  273  markdown rows
+  18  shell scripts under scripts/       (header comment = the document)
+  10  shell scripts at the repo root     (header comment = the document)
+   5  skill assets that make code claims (skills/*/assets/*.ts|json|css)
-----
  306  ledger rows
```

Excluded on purpose, with the reason:

- **19 `.sh` files** = `47 − 18 − 10`: the sample/demo/SDK runners
  (`integrations/*/*/run.sh`, `integrations/channels/telegram-onboard.sh`,
  `integrations/lib/resolve-env.sh`, `demos/crm-support-telegram/{bootstrap,run}.sh`,
  `demos/crm-support-telegram/lib/resolve-demo-env.sh`,
  `sdk/examples/reference-pattern/{run,setup}.sh`). These are the **code
  counterpart** the T06 rows are audited *against*, not documents in their own
  right. T07 owns only `scripts/**` + the root scripts.
- **7 of the 12 `skills/*/assets/*` files**: the brand SVGs and logos under
  `skills/yz-ui/assets/` (`icon.svg`, `logo*.svg`) carry no verifiable claim
  about the code.
- **Nothing else.** Every tracked hidden document is rowed, not excluded: the
  12 agent-facing docs under `.claude/` and `.agents/` are in section U, the 56
  `.sdd/**` change records are in section R.

### The 68 hidden documents (all tracked, all rowed)

| Surface | Files | Why it is tracked | Section |
| --- | --- | --- | --- |
| `.claude/commands/*.md` | 2 | `.gitignore` line 132 `!.claude/commands/` — the written loop is versioned on purpose | U |
| `.claude/agents/*.md` | 2 | `.gitignore` line 133 `!.claude/agents/` — same | U |
| `.agents/skills/adr-skill/**` | 8 | a **second skills root** parallel to `skills/`, prescribing ADR authoring conventions | U |
| `.sdd/changes/**` | 54 | spec-driven-development change records (adr/design/tasks/archive per change) | R |
| `services/admin-console/.sdd/changes/**` | 2 | same, scoped to the console | R |

`2 + 2 + 8 + 54 + 2 = 68`. The 12 `.claude`/`.agents` docs go to section U
rather than T08 so they do not silently inflate a task whose SPEC contract says
"the 11 skills"; T09 assigns their owner. Note the ledger already rowed the
**staged** copy `cowork/staging/manual-loop.command.md` — the **live**
`.claude/commands/manual-loop.md` is now rowed beside it, and T09 must decide
which of the two survives.

Markdown rows per section sum back to 273:
`13 + 35 + 23 + 13 + 30 + 3 + 41 + 101 + 14 = 273`
(section T07 additionally holds the 28 script-header rows and section T08 the 5
skill-asset rows: `273 + 28 + 5 = 306`).

Deltas found against the SPEC's estimates (T01 counted, the SPEC guessed):
`manual-loops` is 40 not 39 (this SPEC itself is new); integrations+demos is 30
not 28; `cowork` is 17 not 16 (`cowork/staging/manual-loop.command.md`); the
root shell surface is 10 scripts, not the 2 the SPEC names; the services tree
holds 3 docs beyond the 20 READMEs; 2 visible doc files (`fixtures/`,
`knative/`) belong to no SPEC task; and the SPEC never mentions the 68 tracked
hidden docs at all — the single biggest surface it missed. All parked per the
table above.

---

## Section T02 — DOCS/messaging + DOCS/architecture (13 rows)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| DOCS/messaging/claim-check.md | descriptive | packages/database `claim-check.ts` + NATS object store users | pending | |
| DOCS/messaging/envelope.md | prescriptive | packages/shared `envelope.utils.ts`; SCHEMAS.md | pending | |
| DOCS/messaging/ingress.md | descriptive | channel-service webhook bridge; agent-ai-service pipelines | pending | |
| DOCS/messaging/service-bus.md | descriptive | packages/database `nats-provider.ts`, `nats-durable-consumer.ts` | pending | |
| DOCS/messaging/tenant-messaging-tiers.md | descriptive | packages/shared `tenant-stream.constants.ts`; tenant-service tiers | pending | |
| DOCS/architecture/decision-log.md | RECORD | repo-wide (dated decisions) | pending | |
| DOCS/architecture/infrastructure.md | descriptive | knative/ overlays; bootstrap-*.sh | pending | |
| DOCS/architecture/mcp-connections.md | descriptive | connector-admin + connector-runtime MCP; admin-console connections | pending | |
| DOCS/architecture/multi-tenancy.md | descriptive | tenant-service; packages/database multi-tenant providers | pending | |
| DOCS/architecture/observability.md | descriptive | packages/observability; knative grafana/tempo overlays | pending | |
| DOCS/architecture/overview.md | descriptive | services/* topology | pending | |
| DOCS/architecture/runtime-streaming.md | descriptive | agent-ai-service token publish; ai-agent-gateway SSE relay; api-gateway passthrough; sdk `runtime.stream()` | pending | |
| DOCS/architecture/security.md | descriptive | auth-service; api-gateway guards; packages/shared `auth.constants.ts` | pending | |

Class notes (T01) — neither of these two is `future`, despite living beside
design docs and being titled "— Design":

- `mcp-connections.md` opens with `Status: Implemented (commit c4da71a)` and
  carries an "As-implemented delta (2026-07-07)" section → **descriptive**, with
  a design record embedded. T02 audits the as-built claims and the "known gap"
  list; the historical design body below the delta is RECORD and is not rewritten.
- `runtime-streaming.md` opens with `Status: Implemented (commit 4d77d0a; SDK
  e2e 61/61 passing)` → **descriptive**. T02 verifies the named path
  (`agent-ai-service` → NATS subject → `ai-agent-gateway` SSE → `api-gateway`
  passthrough → `runtime.stream()`), not whether the design is a good idea.

## Section T03 — remaining DOCS dirs (35 rows)

ADRs are parked as `RECORD (ADR)`; T03 confirms or re-classes each one per the
SPEC's "adr/v_next verify class rules" clause — an ADR that makes present-tense
claims about the code is descriptive and must be audited as such.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| DOCS/adr/agent-architecture-improvements.md | RECORD (ADR) | agent-ai-service context pipeline + skill routing | pending | |
| DOCS/adr/connector-runtime-separation.md | RECORD (ADR) | connector-runtime; connector-admin | pending | |
| DOCS/adr/rag-system.md | RECORD (ADR) | agent-admin-service KB; agent-ai-service retrieval tools | pending | |
| DOCS/adr/temporal-and-nats.md | RECORD (ADR) | workflow-service Temporal; packages/database NATS providers | pending | |
| DOCS/adr/tenant-postgres-model.md | RECORD (ADR) | packages/database postgres engine; tenant-service | pending | |
| DOCS/adr/variable-system.md | RECORD (ADR) | agent-admin-service `system-variables`; workflow-service resolution | pending | |
| DOCS/agents/adapter-tools.md | descriptive | agent-ai-service adapter tools; packages/shared `adapter-*.ts` | pending | |
| DOCS/agents/execution.md | descriptive | agent-ai-service execution; ai-agent-gateway | pending | |
| DOCS/agents/jobs.md | descriptive | agent-scheduler-service `scheduler` module | pending | |
| DOCS/agents/long-running-executions.md | descriptive | agent-ai-service long-running executions; workflow-service | pending | |
| DOCS/agents/memory.md | descriptive | agent-memory-service | pending | |
| DOCS/channels/channel-service.md | descriptive | channel-service | pending | |
| DOCS/channels/instagram.md | descriptive | channel-service Instagram provider | pending | |
| DOCS/channels/meta-provider-pattern.md | descriptive | channel-service Meta providers (WhatsApp/Instagram) | pending | |
| DOCS/channels/telegram-sequence.md | descriptive | channel-service Telegram provider; workflow-service trigger | pending | |
| DOCS/guides/dev-mode.md | prescriptive | dev-mode.sh; scripts/validate-dev-mode.sh; scripts/dev-poll-reload.sh | pending | |
| DOCS/guides/doc-code-validation-tests.md | prescriptive | scripts/checks/doc-code-guards.sh; per-service doc-claim tests | pending | |
| DOCS/guides/onboarding.md | prescriptive | bootstrap-*.sh; scripts/{orbstack,minikube}/startup.sh | pending | |
| DOCS/guides/trace-console.md | descriptive | admin-console trace feature; tracking-ingester-service | pending | |
| DOCS/guides/ui-flows.md | descriptive | admin-console features/* | pending | |
| DOCS/reference/ai-sdk.md | descriptive | agent-ai-service Vercel AI SDK usage | pending | |
| DOCS/runbooks/storage-engines.md | prescriptive | packages/database postgres/mongo engines | pending | |
| DOCS/runbooks/temporal.md | prescriptive | workflow-service Temporal; knative temporal overlays | pending | |
| DOCS/runbooks/archive/README.md | RECORD | meta (archive index) | pending | |
| DOCS/runbooks/archive/temporal-ha-migration.md | RECORD | knative temporal overlays (historical migration) | pending | |
| DOCS/runbooks/archive/temporal-visibility-split.md | RECORD | postgres-temporal overlays (historical migration) | pending | |
| DOCS/skb/api.md | descriptive | agent-admin-service `structured-kb` controllers; api-gateway admin routes | pending | |
| DOCS/skb/architecture.md | descriptive | agent-admin-service `structured-kb` modules | pending | |
| DOCS/skb/runbook.md | prescriptive | agent-admin-service skb ingestion worker + watchdog | pending | |
| DOCS/skb/security.md | descriptive | agent-admin-service skb NL→SQL pipeline | pending | |
| DOCS/workflows/connector-vs-workflow.md | descriptive | connector-runtime vs workflow-service | pending | |
| DOCS/workflows/engine.md | descriptive | workflow-service engine | pending | |
| DOCS/workflows/patterns.md | prescriptive | workflow-service step types; integrations samples | pending | |
| DOCS/README.md | descriptive | meta (DOCS tree index) | pending | |
| DOCS/v_next/README.md | future | meta (v_next class + promotion rule) | pending | |

## Section T04 — service docs (23 rows)

The SPEC names 20 service READMEs; T01 found 3 further docs inside the services
tree, listed at the end of this section.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| services/admin-console/README.md | descriptive | services/admin-console | pending | |
| services/agent-admin-service/README.md | descriptive | services/agent-admin-service | pending | |
| services/agent-ai-service/README.md | descriptive | services/agent-ai-service | pending | |
| services/agent-memory-service/README.md | descriptive | services/agent-memory-service | pending | |
| services/agent-scheduler-service/README.md | descriptive | services/agent-scheduler-service | pending | |
| services/ai-agent-gateway/README.md | descriptive | services/ai-agent-gateway | pending | |
| services/api-gateway/README.md | descriptive | services/api-gateway | pending | |
| services/audit-service/README.md | descriptive | services/audit-service | pending | |
| services/auth-service/README.md | descriptive | services/auth-service | pending | |
| services/cache-service/README.md | descriptive | services/cache-service | pending | |
| services/channel-service/README.md | descriptive | services/channel-service | pending | |
| services/connector-admin/README.md | descriptive | services/connector-admin | pending | |
| services/connector-runtime/README.md | descriptive | services/connector-runtime | pending | |
| services/provisioning-service/README.md | descriptive | services/provisioning-service | pending | |
| services/proxy-service/README.md | descriptive | services/proxy-service | pending | |
| services/registry-service/README.md | descriptive | services/registry-service | pending | |
| services/tenant-service/README.md | descriptive | services/tenant-service | pending | |
| services/tracking-ingester-service/README.md | descriptive | services/tracking-ingester-service | pending | |
| services/usage-aggregator-service/README.md | descriptive | services/usage-aggregator-service | pending | |
| services/workflow-service/README.md | descriptive | services/workflow-service | pending | |
| services/api-gateway/OPENAPI-TODO.md | future | api-gateway OpenAPI decorators (coverage gaps) | pending | |
| services/admin-console/src/app/features/processes/trace/README.md | descriptive | admin-console processes/trace feature | pending | |
| services/agent-ai-service/skills/code-review/SKILL.md | skill | agent-ai-service skill loading (shipped sample skill) | pending | |

## Section T05 — packages + SDK docs (13 rows)

`sdk/examples/*` rows are co-owned with T06 (its "how to run vs run.sh reality"
check); T05 owns the verdict, T06 supplies runner evidence.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| packages/angular-shared/README.md | descriptive | packages/angular-shared | pending | |
| packages/database/README.md | descriptive | packages/database | pending | |
| packages/observability/README.md | descriptive | packages/observability | pending | |
| packages/shared/README.md | descriptive | packages/shared | pending | |
| packages/testing/README.md | descriptive | packages/testing | pending | |
| sdk/README.md | descriptive | sdk/src (client + resources) | pending | |
| sdk/GROWTH-PLAN.md | future | sdk/src resource coverage ("verified YYYY-MM-DD" headers) | pending | |
| sdk/CHANGELOG.md | RECORD | sdk/package.json versions | pending | |
| sdk/ci-notes.md | future | sdk CI (proposal, no pipeline yet) | pending | |
| sdk/test/e2e/README.md | descriptive | sdk/test/e2e suites vs live cluster | pending | |
| sdk/examples/README.md | descriptive | sdk/examples/* | pending | |
| sdk/examples/reference-pattern/README.md | descriptive | sdk/examples/reference-pattern (src + run.sh + setup.sh) | pending | |
| sdk/examples/reference-pattern/README.es.md | descriptive | sdk/examples/reference-pattern (ES twin of the above) | pending | |

## Section T06 — integrations, demos, examples (30 rows)

Each sample README is audited against its own `manifest.yaml`, `src/`, `run.sh`
and `integrations/lib/resolve-env.sh` (demos: `lib/resolve-demo-env.sh`).

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| integrations/README.md | descriptive | integrations/* sample catalogue; integrations/lib/resolve-env.sh | pending | |
| integrations/ai/ai-agent-playground/README.md | descriptive | ai-agent-playground manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-agent-playground/README.es.md | descriptive | ai-agent-playground (ES twin) | pending | |
| integrations/ai/ai-agent-triage/README.md | descriptive | ai-agent-triage manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-agent-triage/README.es.md | descriptive | ai-agent-triage (ES twin) | pending | |
| integrations/ai/ai-call-center-supervisor/README.md | descriptive | ai-call-center-supervisor manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-call-center-supervisor/README.es.md | descriptive | ai-call-center-supervisor (ES twin) | pending | |
| integrations/ai/ai-knowledge-base-agent/README.md | descriptive | ai-knowledge-base-agent manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-knowledge-base-agent/README.es.md | descriptive | ai-knowledge-base-agent (ES twin) | pending | |
| integrations/ai/ai-knowledge-base-agent/docs/support-faq.md | fixture | KB ingestion payload for that sample | pending | |
| integrations/ai/ai-skill-support-agent/README.md | descriptive | ai-skill-support-agent manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-skill-support-agent/README.es.md | descriptive | ai-skill-support-agent (ES twin) | pending | |
| integrations/ai/ai-skill-support-agent/policy/acme-telco-policy.md | fixture | skill content ingested by that sample | pending | |
| integrations/ai/ai-system-variables/README.md | descriptive | ai-system-variables manifest.yaml + src + run.sh | pending | |
| integrations/ai/ai-system-variables/README.es.md | descriptive | ai-system-variables (ES twin) | pending | |
| integrations/channels/http-fanout-telegram/README.md | descriptive | http-fanout-telegram manifest.yaml + run.sh; telegram-onboard.sh | pending | |
| integrations/channels/http-fanout-telegram/README.es.md | descriptive | http-fanout-telegram (ES twin) | pending | |
| integrations/channels/telegram-transform-reply/README.md | descriptive | telegram-transform-reply manifest.yaml + run.sh | pending | |
| integrations/channels/telegram-transform-reply/README.es.md | descriptive | telegram-transform-reply (ES twin) | pending | |
| integrations/http/hosted-services-api/README.md | descriptive | hosted-services-api manifest.yaml + src + run.sh | pending | |
| integrations/http/hosted-services-api/README.es.md | descriptive | hosted-services-api (ES twin) | pending | |
| integrations/http/http-connectors/README.md | descriptive | http-connectors manifest.yaml + src + run.sh | pending | |
| integrations/http/http-connectors/README.es.md | descriptive | http-connectors (ES twin) | pending | |
| integrations/mcp/mcp-connections/README.md | descriptive | mcp-connections manifest.yaml + env.example + run.sh | pending | |
| integrations/mcp/mcp-connections/README.es.md | descriptive | mcp-connections (ES twin) | pending | |
| integrations/mcp/mcp-repo-support-bot/README.md | descriptive | mcp-repo-support-bot manifest.yaml + src + run.sh | pending | |
| integrations/mcp/mcp-repo-support-bot/README.es.md | descriptive | mcp-repo-support-bot (ES twin) | pending | |
| demos/README.md | descriptive | demos/* catalogue | pending | |
| demos/crm-support-telegram/README.md | descriptive | crm-support-telegram manifest.yaml + src + bootstrap.sh + run.sh | pending | |
| demos/crm-support-telegram/GUION-DEMO.md | prescriptive | crm-support-telegram run.sh flow (demo script) | pending | |

## Section T07 — scripts: docs and header contracts (31 rows)

3 markdown + 28 shell headers. The SPEC names only `rebuild-redeploy.sh` and
`dev-mode.sh` at the root; T01 found 10 root scripts and lists all of them —
their headers are the only document those entry points have.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| scripts/e2e/README.md | prescriptive | scripts/e2e/*.sh vs the live dev cluster | pending | |
| scripts/reset/README.md | prescriptive | scripts/reset/*.sh; reset-dev.ts | pending | |
| scripts/reset/INVENTORY.md | descriptive | scripts/reset/*.sh data-wipe surface; reset-dev.ts | pending | |
| scripts/cbm-reindex.sh | script-header | codebase-memory-mcp index for this repo | pending | |
| scripts/checks/doc-code-guards.sh | script-header | the K6/K7/K8 doc claims it guards (cowork/DOC-VS-CODE-AUDIT.md) | pending | |
| scripts/claude-hook-lint-test.sh | script-header | Claude Code PostToolUse hook: lint + test the edited file | pending | |
| scripts/dev-poll-reload.sh | script-header | minikube 9p source-mount reload loop; dev-mode-minikube.sh | pending | |
| scripts/e2e/connector-invoke.sh | script-header | connector-runtime + connector-admin invoke API (sync/async) | pending | |
| scripts/e2e/http-workflow.sh | script-header | channel-service http channel → workflow-service trigger → jsFunction | pending | |
| scripts/e2e/long-agent-execution.sh | script-header | agent-ai-service long-running executions | pending | |
| scripts/e2e/manifest-apply.sh | script-header | provisioning-service manifest apply | pending | |
| scripts/e2e/run-all.sh | script-header | orchestrates scripts/e2e/*.sh | pending | |
| scripts/e2e/teardown-regression.sh | script-header | mid-run driver-death teardown path (workflow-service) | pending | |
| scripts/minikube/startup.sh | script-header | minikube dev startup orchestration | pending | |
| scripts/orbstack/startup.sh | script-header | OrbStack dev startup orchestration | pending | |
| scripts/reset/purge-circuit-breakers.sh | script-header | packages/shared `circuit-breaker.ts` distributed state | pending | |
| scripts/reset/purge-temporal.sh | script-header | postgres-temporal workflow state | pending | |
| scripts/reset/reset-all.sh | script-header | orchestrates scripts/reset/*.sh + reset-dev.ts | pending | |
| scripts/reset/reset-tenant.sh | script-header | tenant-service + provisioning-service tenant resources | pending | |
| scripts/smoke-test.sh | script-header | knative/deployment workload health in dev mode | pending | |
| scripts/validate-dev-mode.sh | script-header | dev-mode.sh round-trip against the live cluster | pending | |
| bootstrap-minikube-linux.sh | script-header | full minikube cluster bootstrap (Linux) | pending | |
| bootstrap-orbstack-osx.sh | script-header | full OrbStack cluster bootstrap (macOS) | pending | |
| dev-mode-minikube.sh | script-header | source-mounted dev mode (minikube variant) | pending | |
| dev-mode.sh | script-header | source-mounted dev mode (OrbStack); DOCS/guides/dev-mode.md | pending | |
| kustomize-safe-apply.sh | script-header | knative/ overlay apply path ($patch:delete workaround) | pending | |
| port-forward.sh | script-header | dev port-forwards incl. grafana/tempo for trace console | pending | |
| rebuild-all.sh | script-header | build+deploy of every services/* image | pending | |
| rebuild-changed.sh | script-header | git-diff → service mapping → rebuild+redeploy | pending | |
| rebuild-redeploy.sh | script-header | logical-service → image/deployment mapping | pending | |
| setup-tenant.sh | script-header | tenant-service tenant + auth-service admin user creation | pending | |

## Section T08 — root docs, cowork notes, skills (46 rows)

41 markdown + 5 skill assets that make code claims.

### Root docs (8)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| README.md | descriptive | repo entry point: services/*, scripts/*, DOCS/ | pending | |
| CLAUDE.md | prescriptive | meta — pointer to AGENTS.md (gitignored, untracked; see reconciliation) | pending | |
| AGENTS.md | prescriptive | meta (repo constitution) — flag-only, read-only per ground rule 5 | pending | |
| TAXONOMY.md | prescriptive | packages/shared bus subjects; fixtures/bus-events — read-only | pending | |
| SCHEMAS.md | prescriptive | packages/shared `envelope.utils.ts` + schemas — read-only | pending | |
| DRIFT.md | RECORD | packages/shared envelope (dated three-way cross-check) | pending | |
| backlog.md | future | meta (product/idea backlog, no code counterpart) | pending | |
| bootstrap-from-scratch.md | prescriptive | bootstrap-*.sh; integrations/demos run.sh chain | pending | |

### cowork notes (17)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| cowork/INDEX.md | RECORD | meta (cowork index) | pending | |
| cowork/ARCHITECTURE-ANALYSIS.md | RECORD | services/* topology (dated analysis) | pending | |
| cowork/ASYNC-RESILIENCE-AUDIT.md | RECORD | workflow-service + agent-ai-service long-running paths | pending | |
| cowork/CACHE-architecture.md | descriptive | cache-service; packages/shared cache clients | pending | |
| cowork/CHANGES-for-dev.md | RECORD | tracking-ingester-service traceability handoff | pending | |
| cowork/CHECKPOINT.md | RECORD | meta (session state) | pending | |
| cowork/codebase-memory-mcp-setup.md | prescriptive | scripts/cbm-reindex.sh; codebase-memory-mcp config | pending | |
| cowork/DEBUG-fanout-telegram.md | RECORD | integrations/channels/http-fanout-telegram (dated debug) | pending | |
| cowork/DESIGN-http-channel-instances.md | RECORD | channel-service HTTP channel instances (Option B shipped) | pending | |
| cowork/DESIGN-run-view.md | prescriptive (RECORD) | admin-console workflow run view; manual-loops/run-view.md | pending | |
| cowork/DOC-VS-CODE-AUDIT.md | RECORD | scripts/checks/doc-code-guards.sh (source of the K-guards) | pending | |
| cowork/LOOP-PLAYBOOK.md | prescriptive | meta (manual-loop discipline) | pending | |
| cowork/METERING-FOUNDATION.md | RECORD | usage-aggregator-service (audit + plan) | pending | |
| cowork/SDK-http-sdk.md | descriptive | sdk/src HTTP client + resources | pending | |
| cowork/SESSION-HANDOFF.md | RECORD | meta (session handoff) | pending | |
| cowork/TRACEABILITY-audit.md | RECORD | tracking-ingester-service + packages/shared correlation | pending | |
| cowork/staging/manual-loop.command.md | prescriptive | meta — staged copy of `.claude/commands/manual-loop.md` (rowed in section U) | pending | |

Class notes (T01) — the two `DESIGN-*` notes are not `future`:

- `DESIGN-run-view.md` is dated 2026-07-11 and declares itself the **BINDING**
  visual contract for the (completed) `manual-loops/run-view.md` loop →
  `prescriptive (RECORD)`: reviewers judged the implementation against it, and
  ground rule 3 keeps its dated claims intact. T08 checks only that it still
  matches the shipped run view, or proposes archiving it.
- `DESIGN-http-channel-instances.md` weighs "Option A vs Option B", but Option B
  shipped: `/api/webhooks/http/<tenant>/<instance>` exists in sdk
  `ingest-adapter.ts`, admin-console `channels.component.ts` and
  `sdk/examples/reference-pattern`, and `.sdd/changes/http-channel-instances/adr.md`
  records "the per-instance URL redeploy is complete" → **RECORD** (superseded
  decision note), not a pending design.

### skills (16 markdown)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| skills/_shared/skill-resolver.md | skill | meta (skill activation protocol) | pending | |
| skills/angular/architecture/SKILL.md | skill | services/admin-console app structure; packages/angular-shared | pending | |
| skills/angular/core/SKILL.md | skill | services/admin-console standalone components/signals | pending | |
| skills/angular/forms/SKILL.md | skill | services/admin-console forms | pending | |
| skills/angular/performance/SKILL.md | skill | services/admin-console performance patterns | pending | |
| skills/envelope-messages/SKILL.md | skill | packages/shared `envelope.utils.ts`; SCHEMAS.md; TAXONOMY.md | pending | |
| skills/envelope-messages/references/diseno-mensajes.md | skill | packages/shared envelope + DOCS/messaging/* as-built sources | pending | |
| skills/git-commit/SKILL.md | skill | meta (git workflow for this repo) | pending | |
| skills/git-commit/references/BRANCHING.md | skill | meta (branching strategy) | pending | |
| skills/git-commit/references/COMMIT-MESSAGE-FORMAT.md | skill | meta (commit conventions) | pending | |
| skills/git-commit/references/GIT-HOOKS.md | skill | repo git hooks; scripts/claude-hook-lint-test.sh | pending | |
| skills/judgment-day/SKILL.md | skill | meta (adversarial review discipline) | pending | |
| skills/multi-tenant/SKILL.md | skill | tenant-service; packages/database tenant scoping | pending | |
| skills/playwright/SKILL.md | skill | services/admin-console Playwright e2e setup | pending | |
| skills/skill-registry/SKILL.md | skill | meta (skills/ registry) | pending | |
| skills/yz-ui/SKILL.md | skill | services/admin-console UI; packages/angular-shared | pending | |

### skill assets that make code claims (5)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| skills/envelope-messages/assets/envelope-builder.ts | skill (asset) | packages/shared `envelope.utils.ts` | pending | |
| skills/envelope-messages/assets/envelope-schema.json | skill (asset) | packages/shared envelope schema; SCHEMAS.md | pending | |
| skills/envelope-messages/assets/subject-builder.ts | skill (asset) | packages/shared bus subject helpers; TAXONOMY.md | pending | |
| skills/yz-ui/assets/component-template.angular.ts | skill (asset) | services/admin-console component conventions | pending | |
| skills/yz-ui/assets/admin-console-snippets.css | skill (asset) | services/admin-console styles | pending | |

## Section R — RECORDS and meta (101 rows) — classified, NOT audited

Ground rule 2: these describe their date. No present-truth verdict; T09 may
propose archiving or deleting dead ones, nothing more.

### manual-loops (40)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| manual-loops/agent-mcp-tool-naming.md | RECORD | RECORD | pending | |
| manual-loops/connector-invoke-api.md | RECORD | RECORD | pending | |
| manual-loops/connector-trace-linking.md | RECORD | RECORD | pending | |
| manual-loops/declarative-provisioning.md | RECORD | RECORD | pending | |
| manual-loops/payload-capture.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-2.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-3.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-4.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-manifest-gaps-5.md | RECORD | RECORD | pending | |
| manual-loops/provisioning-skills-section.md | RECORD | RECORD | pending | |
| manual-loops/run-view.md | RECORD | RECORD | pending | |
| manual-loops/samples-reorg.md | RECORD | RECORD | pending | |
| manual-loops/trace-console.md | RECORD | RECORD | pending | |
| manual-loops/workflow-step-events.md | RECORD | RECORD | pending | |
| manual-loops/workflow-toggle.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/README-migracion.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-ai.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-builder-v2.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-channels.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-connections.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-dashboard.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-foundation.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-polish.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-processes-builder.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-trace.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/console-redesign-users-analytics-settings.md | RECORD | RECORD | pending | |
| manual-loops/admin-console/design/builder-v2-reference/NOTES.md | RECORD | RECORD | pending | |
| manual-loops/agents/long-running-agent-executions.md | RECORD | RECORD | pending | |
| manual-loops/architecture/dev-mode-validator-fix.md | RECORD | RECORD | pending | |
| manual-loops/architecture/docs-consistency.md | RECORD | RECORD | pending | |
| manual-loops/architecture/docs-truth-audit.md | RECORD | RECORD (this loop's SPEC) | pending | |
| manual-loops/architecture/phase0-rules-inventory.md | RECORD | RECORD | pending | |
| manual-loops/architecture/skills-cleanup.md | RECORD | RECORD | pending | |
| manual-loops/architecture/system-validation.md | RECORD | RECORD | pending | |
| manual-loops/connectors/connection-call-inspector.md | RECORD | RECORD | pending | |
| manual-loops/connectors/endpoint-scoped-recent-calls.md | RECORD | RECORD | pending | |
| manual-loops/demos/crm-support-telegram.md | RECORD | RECORD | pending | |
| manual-loops/messaging/envelope-drift.md | RECORD | RECORD | pending | |
| manual-loops/messaging/tenant-messaging-tiers.md | RECORD | RECORD | pending | |

### golden (2)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| golden/README.md | RECORD | RECORD (dated bus-event classification sample) | pending | |
| golden/REVIEW.md | RECORD | RECORD (dated post-fix correlation review) | pending | |

### manual-loop templates (3)

Not RECORDS and owned by no T02–T08 task; parked here as meta. T09 rules on
where they live.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| manual-loops-templates/README.md | prescriptive | meta (manual-loop template guide) | pending | |
| manual-loops-templates/spec-canonical-template.md | prescriptive | meta (canonical SPEC template) | pending | |
| manual-loops-templates/spec-simple-template.md | prescriptive | meta (simple SPEC template) | pending | |

### .sdd spec-driven-development change records (56)

Tracked but hidden from a bare `fd`. Same status as `manual-loops/*`: dated
per-change `adr`/`design`/`tasks`/`explore`/`archive`/`apply-progress` files.
RECORD class, never rewritten. T09 rules on whether this second record system
lives on beside `manual-loops/`.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/apply-progress.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/design.md | RECORD | RECORD | pending | |
| .sdd/changes/add-time-windows-to-avoid-remember-guids/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/design.md | RECORD | RECORD | pending | |
| .sdd/changes/backend-aggregate-endpoints/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/design.md | RECORD | RECORD | pending | |
| .sdd/changes/channel-trace-entry/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/design.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-call-detail/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/design.md | RECORD | RECORD | pending | |
| .sdd/changes/connector-recent-calls/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/design.md | RECORD | RECORD | pending | |
| .sdd/changes/http-channel-instances/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/design.md | RECORD | RECORD | pending | |
| .sdd/changes/processes-message-trace/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/design.md | RECORD | RECORD | pending | |
| .sdd/changes/telegram-channel-instances/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/design.md | RECORD | RECORD | pending | |
| .sdd/changes/temporal-run-detail-link/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/apply-progress.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/design.md | RECORD | RECORD | pending | |
| .sdd/changes/trace-visualization/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/explore.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-audit-persist-ids/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/explore.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-causal-chain-ingress/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-chain-endpoint/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/adr.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/design.md | RECORD | RECORD | pending | |
| .sdd/changes/traceability-channel-ingress-causal/tasks.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/archive.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/design.md | RECORD | RECORD | pending | |
| .sdd/changes/utc-enforcement/tasks.md | RECORD | RECORD | pending | |
| services/admin-console/.sdd/changes/landing-page-aggregation/design.md | RECORD | RECORD | pending | |
| services/admin-console/.sdd/changes/landing-page-aggregation/tasks.md | RECORD | RECORD | pending | |

## Section U — unassigned surfaces (14 rows)

Real docs describing real code or prescribing real process, named by no SPEC
task. T09 assigns an owner or folds them into the target tree; they must not
silently escape the audit.

### Visible (2)

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| fixtures/bus-events/README.md | descriptive | fixtures/bus-events/*.json provenance; TAXONOMY.md | pending | |
| knative/services/overlays/_components/README.md | descriptive | knative/services/overlays/_components/* kustomize components | pending | |

### Agent-facing, tracked but hidden (12)

The loop's own executable prose. `.claude/commands/manual-loop.md` is the LIVE
command this SPEC runs under; `cowork/staging/manual-loop.command.md` (rowed in
T08) is a staged copy of it — T09 must rule on the duplicate.
`.agents/skills/adr-skill/` is a **second skills root** beside `skills/`,
prescribing ADR authoring conventions that `DOCS/adr/` is subject to.

| Path | Class | Code counterpart | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| .claude/commands/manual-loop.md | prescriptive | meta — live `/manual-loop` command (this loop's own runner) | pending | |
| .claude/commands/build-console.md | prescriptive | meta — `/build-console` command | pending | |
| .claude/agents/implementer.md | prescriptive | meta — loop implementer role contract | pending | |
| .claude/agents/reviewer.md | prescriptive | meta — loop reviewer role contract | pending | |
| .agents/skills/adr-skill/SKILL.md | skill | meta — ADR authoring conventions; DOCS/adr/* is subject to them | pending | |
| .agents/skills/adr-skill/references/adr-conventions.md | skill | meta — ADR conventions reference | pending | |
| .agents/skills/adr-skill/references/examples.md | skill | meta — ADR examples | pending | |
| .agents/skills/adr-skill/references/review-checklist.md | skill | meta — ADR review checklist | pending | |
| .agents/skills/adr-skill/references/template-variants.md | skill | meta — ADR template variants | pending | |
| .agents/skills/adr-skill/assets/templates/adr-madr.md | skill (asset) | meta — MADR template | pending | |
| .agents/skills/adr-skill/assets/templates/adr-readme.md | skill (asset) | meta — adr/ index template | pending | |
| .agents/skills/adr-skill/assets/templates/adr-simple.md | skill (asset) | meta — minimal ADR template | pending | |
