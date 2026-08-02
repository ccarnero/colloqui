# SPEC — docs truth audit: every doc vs the code, restructure, then purge

> Task queue for the `/manual-loop` discipline. One task at a time, gated,
> dual-reviewed, one commit per green checkpoint.
> Origin: Christian, 2026-08-02 — "tanto documento es confuso: primero revisar
> todo y cada uno de los servicios, ejemplos, scripts y contrastarlos con los
> documentos, identificar fallos y diferencias. el codigo manda es la fuente
> de verdad. planificar y sugerir una estructura correcta, una vez completo
> borrar todo documento que no sirva."
> HUMAN APPROVAL REQUIRED BEFORE THIS SPEC RUNS (authoring it is not
> authorization). Additionally, T09's structure + deletion list is its own
> HUMAN DECISION ROUND — nothing moves or dies before Christian signs it.
> Engram topic: `architecture/docs-truth-audit`.

## Goal

Every document in the repo ends in exactly one of four states, recorded in a
single verdict ledger: **TRUE** (verified against code, kept where it is),
**FIXED** (drift corrected in place — the code wins, always), **RECLASSIFIED**
(moved/merged into the approved structure), or **DELETED** (adds nothing).
The final tree is smaller, every survivor is verified, and the doc classes
(descriptive / prescriptive / future / RECORD) are explicit and guarded.

## Ground rules (apply to every task)

1. **The code is the source of truth.** A doc-vs-code difference is a DOC bug
   by default. The ONE exception: if the diff reveals a genuine CODE bug
   (behavior nobody could want), STOP and escalate it as a decision — this
   loop never changes runtime code silently. Prescriptive docs
   (`envelope.md`, AGENTS.md contracts) keep their class, but any clause the
   code has never honored gets flagged in the ledger for the T09 round
   instead of being silently "fixed" either way.
2. **RECORDS are not audited for present-truth.** `manual-loops/*` Progress
   logs, `cowork/INDEX.md` entries, `DRIFT.md`, `golden/*` describe their
   date. They get CLASSIFIED (and dead working notes proposed for deletion in
   T09) but their historical claims are never rewritten.
3. **Verdicts need evidence.** Every FIXED entry cites the code that
   contradicted the doc; every DELETE proposal states what (if anything)
   replaces it. No citation, no verdict — same standard as `golden/REVIEW.md`.
4. **Line-number cites are a smell.** When fixing drift, prefer name-based
   references (constant/function names) — this week's reviews showed `:NNN`
   cites rot within days.
5. **TAXONOMY.md / SCHEMAS.md / AGENTS.md stay read-only** except through an
   escalated decision.
6. **Ledger lives at `cowork/DOCS-TRUTH-LEDGER.md`** — one row per document:
   path, current class, verdict, evidence, disposition. Built by T01, filled
   by T02–T08, adjudicated in T09, executed in T10.

## Gates (per checkpoint)

```
G0   ./scripts/checks/doc-code-guards.sh        (every task)
G1   affected package/service unit suite         (only if a task touches code-adjacent files: skills assets, scripts)
G6b  ./scripts/e2e/http-workflow.sh              (only for tasks touching executable scripts — T07; docs-only tasks skip it, stated per task)
Dual adversarial review (2× APPROVED) before each commit.
```

## Task queue

### T01 — Inventory + ledger skeleton
Enumerate EVERY documentation artifact: `DOCS/**` (48 files, 11 dirs), root
docs (`README.md`, `AGENTS.md`, `TAXONOMY.md`, `SCHEMAS.md`, `DRIFT.md`,
`backlog.md`, `bootstrap-from-scratch.md`), 20 service READMEs,
packages+sdk docs (13), integrations+demos docs (28), scripts docs (3) + the
18 shell scripts' header contracts, cowork notes (16), skills (11 SKILL.md +
assets), manual-loops (39, RECORDS). Ledger row per artifact with current
class and the code area it claims to describe. No verdicts yet.
Accept: ledger complete (spot-check: `fd -e md | wc -l` reconciles), each row
names its code counterpart or is classed RECORD.

### T02 — Audit: DOCS/messaging + DOCS/architecture
The two densest dirs, against packages/shared, packages/database and the
services they cite. Fix in-place drift; verdict every file.
Accept: every file in both dirs has a ledger verdict with evidence; G0 green.

### T03 — Audit: DOCS/channels, agents, workflows, skb, reference, adr, guides, runbooks
Same treatment for the remaining DOCS dirs. Runbooks additionally get an
"still executable?" check (commands exist, flags real). adr/v_next verify
class rules (v_next: rule-5 leftovers).
Accept: verdicts + evidence for every file; G0 green.

### T04 — Audit: the 20 service READMEs
Each README vs its service's code: routes tables, NATS contracts, env vars,
storage claims. (agent-admin/agent-memory were partially swept 2026-08-01/02
— re-verify cheaply, don't redo.)
Accept: 20 verdicts; every FIXED row cites code; G0 green.

### T05 — Audit: packages + sdk docs
packages/* READMEs and sdk docs (GROWTH-PLAN.md, resource type headers'
"verified YYYY-MM-DD" claims) vs code.
Accept: 13 verdicts; sdk `bun run build && bun test` green if touched.

### T06 — Audit: integrations, demos, examples
The 28 docs under integrations/demos (+ sdk/examples): READMEs vs
manifest.yaml/src, env contracts vs lib/resolve-env, "how to run" vs run.sh
reality.
Accept: verdicts for all; any README whose commands are broken is FIXED or
proposed DELETE with reason.

### T07 — Audit: scripts (docs AND behavior contracts)
The 18 shell scripts under scripts/ + rebuild-redeploy.sh + dev-mode.sh:
header comments vs actual behavior, scripts/reset docs vs reset-dev.ts,
checks/ guards vs what they actually guard. This task may fix COMMENTS and
docs; script behavior changes escalate.
Accept: verdicts; G6b (cluster e2e) green since this touches the executable
surface's documentation of record.

### T08 — Audit: root docs, cowork notes, skills
README.md, AGENTS.md (flag-only), backlog.md, bootstrap-from-scratch.md;
the 16 cowork notes (mostly RECORD or stale working notes → DELETE
candidates); the 11 skills' SKILL.md claims vs the code they teach (the
envelope-messages skill was verified 2026-08-01 — cheap re-check).
Accept: verdicts for all; skills' claim-guard tests still green.

### T09 — Structure proposal + purge list ⟶ HUMAN DECISION ROUND
From the full ledger, propose: (a) the target tree (which dirs exist, what
class each holds, where RECORDS live — e.g. `DOCS/records/` or archive
conventions); (b) merge list (docs saying the same thing once); (c) the
DELETE list with per-file reason; (d) guard changes so the structure stays
true (`doc-code-guards.sh` additions, class banners). STOP AND WAIT for
Christian's ruling on all four — present as a compact decision table.
Accept: decision round held; rulings recorded verbatim in this SPEC.

### T10 — Execute the approved structure + purge
Apply exactly what T09 approved: moves, merges, deletions, guard updates,
link fixes (`rg` proof: zero dangling links to moved/deleted files),
INDEX/ledger closing entries.
Accept: tree matches the approved proposal; G0 green; full-repo link check
clean; cluster e2e green (final integration proof); ledger closed with
final per-file dispositions.

## Out of scope (explicit)
- Rewriting history: manual-loops Progress logs, DRIFT.md findings,
  golden/* content, cowork INDEX entries keep their dated claims.
- Runtime code changes (escalate as decisions).
- TAXONOMY/SCHEMAS/AGENTS edits without an escalated ruling.
- New documentation that doesn't exist yet (structure may leave named gaps).

## Progress

- [x] T01 — Inventory + ledger skeleton
- [x] T02 — Audit: DOCS/messaging + DOCS/architecture
- [x] T03 — Audit: DOCS/channels, agents, workflows, skb, reference, adr, guides, runbooks
- [ ] T04 — Audit: the 20 service READMEs
- [ ] T05 — Audit: packages + sdk docs
- [ ] T06 — Audit: integrations, demos, examples
- [ ] T07 — Audit: scripts (docs AND behavior contracts)
- [ ] T08 — Audit: root docs, cowork notes, skills
- [ ] T09 — Structure proposal + purge list ⟶ HUMAN DECISION ROUND
- [ ] T10 — Execute the approved structure + purge

(per-task entries appended below)

### T01 — 2026-08-02

`cowork/DOCS-TRUTH-LEDGER.md` created: 306 rows (273 md + 28 script headers
+ 5 claim-bearing skill assets), all `pending`, grouped by owning task
(T02–T08 + RECORDS + section U for unassigned). CORRECTION to this task's
Accept text discovered en route: bare `fd -e md` does NOT reconcile — 68
tracked docs live in hidden dirs (`.claude` 4, `.agents/skills/adr-skill` 8,
`.sdd` 56) and `CLAUDE.md` is gitignored (manual +1); the honest census is
`fd -H -e md` (273) = `git ls-files '*.md'` (272) + the ledger. Four
class corrections applied with evidence (mcp-connections + runtime-streaming
future→descriptive per their own "Status: Implemented" headers;
DESIGN-run-view → prescriptive RECORD; DESIGN-http-channel-instances →
RECORD, Option B verified shipped). Escalations parked for T09: the
live-vs-staged `manual-loop.command.md` duplicate, the `.sdd/` second
record system, section U ownership, hybrid class names.
Attempt 1 2× REJECTED (hidden-dir omission, CLAUDE.md, misclasses,
non-verbatim checklist) — attempt 2 2× APPROVED. G0 green both attempts.

### T02 — 2026-08-02

13/13 verdicts with evidence: 11 FIXED, 2 TRUE (tenant-messaging-tiers.md,
observability.md — 21 metric names verified verbatim). Biggest drift killed:
envelope.md producer census 5→11 + false "DLQ is not canonical" claim +
invented example types; ingress.md missing `/api` prefix + WRONG lifecycle
publisher (it is agent-ai-service's `ExecutionHandler.publishStatus`, not
ai-agent-gateway) + stale secret header in an example; service-bus.md
invented prod/staging topology → real single-node dev, "core NATS only for
tenant.deleted" → producing-surface table (runtime `rt.` streaming is a
second live surface; caveat: PLATFORM_TENANTS does bind platform.tenant.>,
only `rt.` is stream-free), topology diagram regenerated 7→11 producers /
6→10 consumers; overview.md 12 drifts incl. three NONEXISTENT endpoints
removed and WORKFLOW_DEFAULT_TIMEOUT_MS 600k-not-60k; infrastructure.md
tenant DBs are plain StatefulSets not CNPG; security.md `forwarded_headers`
field never existed. Escalations E1–E5 parked for T09 (never-honored
type/source contract clauses, publishStatus producer/subject mismatch,
stale DOCS-line cites inside source files → proposed guard, alerts.yaml
watching two nonexistent durables). Three attempts: R1 caught a residual
unprefixed path + stale topology diagram + fresh line-cite assertions;
R2/R3 narrowed to a self-contradicting subgraph label, fixed. 2× APPROVED.
G0 green every attempt; docs-only (G1/G6b skipped).

### T03 — 2026-08-02

35/35 verdicts with evidence: 25 FIXED, 10 TRUE. Highest-stakes finds:
**E9 — GENUINE SQL INJECTION (code bug, escalated NOT fixed):**
`SKBRowsRepository.executeQuery` interpolates `containerId` (no
ParseUUIDPipe) and `categories` into `sql.unsafe()` — the injection point
is unbounded (simple query protocol, no keyword filtering); per-tenant
`getSql(tenantId)` is the only real bound. Documented as security.md open
risk 3b. Also: E6 (six source files cite a wrong METERING doc path), E7
(jobs.yaml wrong on schedule semantics/fields), E8
(`validateSelectOnly`/`enforceLimit` exported+tested+never called).
Runbook executability: skb/runbook.md failed hard (kubectl scale on a
ksvc, wrong labels/namespace, 400-rejected curl, four nonexistent SQL
columns) — salvaged; storage-engines.md port-forward claim false —
salvaged; temporal.md passes. jsFunction contract sweep (started by a
review catch): EIGHT documented payloads were bare statements that throw
SyntaxError under `new Function("return " + code)` — all converted to
expression form and EXECUTED against the activity's literal contract
(8 pass 0 fail). workflows/patterns.md: nine template variables silently
resolving to "". T09 dispositions: merge meta-provider-pattern→instagram,
split skb/architecture.md and doc-code-validation-tests.md, ai-sdk.md
(1355-line vendor reference) delete-in-favor-of-link, adr
agent-architecture-improvements accept/reject/move.
Four attempts: R1 caught fence-split diagram + false REST recipe; R2/R3
caught the jsFunction contract + a half-done body→data fix. Final
2× APPROVED. G0 green every attempt; docs-only (G1/G6b skipped).
