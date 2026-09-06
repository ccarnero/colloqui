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

## User decisions (human boundary — do not reinterpret)

1. El código sigue siendo la fuente de verdad técnica.
2. Los cambios estructurales finales (T09/T10) requieren firma humana explícita.

## Constraints (apply to every task)

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

## Gates (the `/manual-loop` command runs these verbatim, in order)

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

## Human boundaries for this change

- Human approves this SPEC before its first run.
- Human approves the T09 structure and purge decision table before T10.
- TAXONOMY/SCHEMAS/AGENTS edits require explicit escalation and approval.

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
- [x] T04 — Audit: the 20 service READMEs
- [x] T05 — Audit: packages + sdk docs
- [x] T06 — Audit: integrations, demos, examples
- [x] T07 — Audit: scripts (docs AND behavior contracts)
- [x] T08 — Audit: root docs, cowork notes, skills
- [x] T09 — Structure proposal + purge list ⟶ HUMAN DECISION ROUND
- [x] T10 — Execute the approved structure + purge

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

### T04 — 2026-08-03

23/23 verdicts with evidence (20 READMEs + OPENAPI-TODO.md + trace README +
agent-ai code-review SKILL.md): 21 FIXED, 2 TRUE (cache-service README,
OPENAPI-TODO.md — its DTO counts and "0 `@ApiProperty`" still exact).
Run interrupted by a machine crash mid-attempt-1 (8 READMEs edited, ledger
untouched); resumed by re-verifying the 8 against source (all held; 3
extended) rather than redoing. Biggest drifts: agent-scheduler README
described a service that does not exist as written (phantom tenant
discovery, wrong reconciler model, wrong ADMIN_API_KEY semantics, missing
NATS/storage/test surface); workflow-service README self-contradicted on
action-type count and three of four worked examples used nonexistent
fields; connector-runtime "Error Handling" wrong on every axis (breaker
constants, 4xx semantics, phantom 300 s timeout, phantom response fields
`duration`/`retriesUsed`/`body`); POSTGRES_PASSWORD documented with a
default in two READMEs but `requireEnv` throws. Escalations E10–E13 (code
bugs, NOT fixed): E10 proxy-service + tenant-service `test` scripts recurse
via `pnpm test` forever; E11 connector-admin accepts `authType:
"oauth2-client"` but both header injectors switch on `"oauth2"` — such
connectors get NO Authorization header; E12 `parseFrontmatter`'s
`indexOf(":")` splitter turns `description: >` into a literal `">"`; E13
agent-scheduler cannot schedule anything as deployed (no tenant seeding, no
LEADER_ELECTION_POSTGRES_URL/REDIS_URL in manifest, health still `ok`).
Rule-4 sweep: every `file:N-M` cite in the 23 docs machine-verified
in-range; only stale/ambiguous ones converted to name-based (~34), rest
recorded — full conversion parked as a T09 judgement call.
Two attempts: R1 split (A APPROVED / B REJECTED — the POSTGRES_HOST "fix"
was itself false: `createPostgresProvider` defaults `defaultHost =
"localhost"`, postgres.js never sees `undefined`; plus a
`bootstrapFastifyService` ghost cite). Attempt 2 corrected both;
2× APPROVED (A recorded that B's catch was real). G0 green every attempt;
docs-only (G1/G6b skipped).

### T05 — 2026-08-03

13/13 verdicts with evidence: 10 FIXED, 3 TRUE (`sdk/CHANGELOG.md` —
classified RECORD, dated claims never rewritten; `sdk/examples/README.md`;
`reference-pattern/README.es.md`, the more accurate of the two twins).
Biggest drifts: `sdk/README.md` contradicted ITSELF seven times (per-resource
"Bug:/Pending deploy" notes vs its own "Known platform gaps" section saying
the same items were fixed — the e2e suite settles it); `sdk/ci-notes.md`'s
evidence block had rotted into falsehoods (`.github` now holds zero files,
no `azure-pipelines` match repo-wide, the `skills/devops` template it claims
to mirror is gone); `packages/shared/README.md` was missing 14 modules
including the whole `provisioning/` subsystem and had no Testing section;
`packages/database/README.md`'s three `src/index.ts:NN` cites had all rotted
onto unrelated exports; `packages/observability/README.md` claimed "every
service is deployed twice" — 6 of 20 call `bootstrapSplitService`, and
`workflow-service` actually runs THREE pods off one image. Counts corrected:
SDK unit tests 283→343, e2e "57 across 8 files"→9 files/62 cases,
"19 namespaces"→21. Escalations E14–E16 (NOT fixed): E14
`ensureDurableConsumer`'s JSDoc calls `backoff` immutable while
`reconcileDurableConsumer` both diffs and updates it; E15 `sdk/package.json`'s
`"test": "tsx --test 'test/**/*.test.ts'"` never runs the 14 co-located
`src/cli/**/*.test.ts` specs, so the whole `yoizen` CLI (incl.
`--secrets-from-env`) is untested by its documented command — `bun test`
catches them (471 vs 343); E16 five `sdk/src` resource headers (registry,
agents, structured-kb, config-files, channels) still assert "pending
deploy / 404s" against e2e files that assert the opposite, and
`config-files/types.ts` contradicts itself in consecutive sentences —
`sdk/src` is outside the allowed-file list, so T09 rules on it.
Two attempts, both reviewers REJECTED R1 independently on the SAME defect:
the README rewrite declared those gaps closed while leaving the contradicting
`sdk/src` comments silent (E16 was the fix), plus a `runtime.stream()` claim
that asserted deployment when the evidence proved only "committed", plus six
FRESH `:NNN` cites re-seeded in `angular-shared`'s new table by the same diff
that called such cites "textbook rule 4". Attempt 2 fixed all three;
2× APPROVED. Rule-4 note: `packages/testing/README.md` keeps untouched-row
offsets — partial sweep by design, same judgement call parked in T04.
Gates: G0 green every attempt; `cd sdk && bun run build && bun test` green
(tsc clean, 471 pass / 0 fail).

### T06 — 2026-08-03

30/30 verdicts with evidence: 27 FIXED, 3 TRUE (`demos/README.md`,
`GUION-DEMO.md`, the `support-faq.md` fixture — byte-identical to the
manifest's inline copy). Nine `.env`/`env.example` templates were fixed
alongside their READMEs. Biggest drifts: `hosted-services-api` EN+ES
documented a `checkEnvSupport` restriction that no longer exists anywhere
under `services/` (`serviceEnvValueSchema` is now a 4-way union and
`buildEnvVars` resolves all four) while a sibling sample documented the
opposite; `ai-agent-triage` showed an expected Telegram DM no branch can
emit (`route` builds only `🚨 ESCALATION — ` / `✅ Triage — `);
`telegram-transform-reply/README.es.md` contradicted itself twice, false
half each time (the manifest DOES pin `accountIds`; the appSecret mapper
returns it on every read); the `acme-telco-policy.md` FIXTURE had drifted
from the manifest's inline copy (3420 vs 3450 bytes) and was restored to
byte parity; `mcp-repo-support-bot/README.es.md` had no `manifests apply`
step at all, so following the ES twin alone ran the driver against an
unprovisioned tenant. Escalations: E18 `ai-system-variables/src/index.ts`
looks up camelCase names while the manifest declares slugs — the sample's
headline step always prints `(missing!)`; E19 the `🎧 Triage` sample
output; E20 `hosted-services-api/manifest.yaml`'s header still asserts the
lifted restriction; E21 restated as a pair (template FIXED,
`reference-pattern/src/setup.ts`'s `resolve-env.sh` comment still false);
E22 `registry-services-writer.ts`'s "COMPARABLE LIMITATION" header
describes the SUPERSEDED comparator; E23 two dot-less `env.example`
templates — disproved cause removed, rename deferred to T10 for a T09
ruling. **E17 is the lesson of this task**: attempt 1 raised it as
"every `.env.*` file is unwritable from this environment" — false; the
Write/Edit TOOLS refuse those paths, the filesystem does not, and the
orchestrator disproved it by fixing one through the shell. A tool refusal
is not a filesystem fact. E17 survives only as a FIXED summary (eight
files, five finding classes) plus that process note.
Four attempts. R1 2× REJECTED on the same two defects, both self-inflicted
by the fixes: (a) the `hosted-services-api` rewrite IMPORTED a falsehood
from E22's stale source comment ("a VALUE-only edit produces no `update`
verdict") — the planner's `serviceEnvMechanismComparable` omits `value` on
mismatch precisely so the diff surfaces, pinned by
`service-comparable.spec.ts`; and (b) the disproved E17 sandbox claim
survived VERBATIM in `mcp-repo-support-bot`'s README and `env.example`
while that row was graded TRUE with a four-line defence of the omission —
a row cannot return TRUE while the ledger it lives in refutes a sentence
inside the file. Both fixed in attempt 3; 2× APPROVED. A final polish
round corrected the census recipe: the ledger cited
`fd -H -g '.env.example'` = 11 when unscoped it returns 13 (`scripts/e2e`
and `scripts/reset` ship templates too) — the conclusion was right, the
command did not reproduce its own number, and 13 happened to be both the
correct sample total and the wrong unscoped count. Now scoped to
`integrations demos sdk/examples` and verified: 11 / 13 / 2.
G0 green every attempt; docs-only (G1/G6b skipped).

### T07 — 2026-08-03

31/31 verdicts with evidence: 23 FIXED, 8 TRUE. Every `.sh` change is
comment-only — verified each round by a scripted scan of non-comment
added/removed lines across `git diff -- '*.sh'` (empty), plus `bash -n`
on all 28 scripts. Biggest drifts: `long-agent-execution.sh` (1409 lines)
was documented NOWHERE and is reachable from no orchestrator;
`purge-temporal.sh`'s four runbook paths were all dead and its header
asserted an HA + split-visibility topology that was REVERTED (the code
auto-detects and resolves precisely because of that); `http-workflow.sh`
— the G6b script itself — claimed `workflowComparable` is existence-only
and `workflows-writer.ts`'s `update()` a no-op stub, when `update()` is a
real PUT; `purge-circuit-breakers.sh` listed two "NEVER touched" Redis
prefixes that do not exist (`http:cache:*`, `adapter:swr:*` vs the real
`httpcache:v1:*`, `adapter:config:*`); `doc-code-guards.sh` — this loop's
own gate — advertised "K6/K7/K8" while `main()` runs 13 guards. Two
scripts had NO header at all (`smoke-test.sh`, `port-forward.sh`) and
were given one, verified line by line. Escalations E24–E35, all behavior
(never fixed here): highlights are E27 `smoke-test.sh` gates on 8 of 11
worker Deployments while both startup orchestrators poll it, E29 dev-mode
flips 1 of connector-runtime's 3 Deployments while `rebuild-redeploy.sh`
rolls all 3, E33 a phantom `connector-runtime` ksvc, E34
`DOCS/guides/dev-mode.md` carrying the same omissions fixed in the
scripts. Machine-verified TRUE and worth recording: `rebuild-redeploy.sh`'s
mapping now diffs EMPTY against the 11 base Deployments — the 2026-08-01
agent-admin worker fix is complete — and `reset-tenant.sh`'s 18 tables ≡
INVENTORY's list ≡ INVENTORY's TRUNCATE block.
Four attempts, three rejection rounds, every one finding something real.
R1: the fix REWROTE A TRUE SENTENCE INTO A FALSE ONE in
`kustomize-safe-apply.sh` (claimed the detector counts `^kind:` lines "so
it is not limited to `$patch: delete` files" — backwards; the gate is
`grep -cE '^\$patch: delete' > 1` in `fix_multidelete_in_tree`, and the
`^kind:` count is a post-gate guard inside the splitter) — reverted
byte-identical to HEAD, row FIXED→TRUE; and the brand-new
`port-forward.sh` header invented a failure contract ("never fatal")
contradicted by a hard `exit 1` on a missing platform namespace. R2: E30
certified a false negative — `rebuild-changed.sh` DOES spill shell into
`--help` (header ends 35, `usage()` is `sed -n '3,40p'`) — and
`purge-temporal.sh`'s header still asserted, in the ALLOWED comment
surface, the very topology E35 escalates, which made E35's own premise
false. R3: a count carrying "Rendered and confirmed" that an actual
render contradicted (5 printed lines, 3 live shell, ONE colour line — not
"two colour lines"). Requiring the "N printed, M live shell" form then
surfaced a second miscount nobody had named. The full sweep of
`purge-temporal.sh`'s header found EIGHT stale claims across three
passes, incl. an exit-code-1 recovery command (`kubectl scale
deploy/temporal-{frontend,history,matching,worker}`) that fails outright
against the single `temporal` Deployment the cluster runs. Final
2× APPROVED. Structural note for T09: that header states the same
topology fact in ~8 independent places with no single source of truth —
the same shape as the `usage()`-heredoc duplication behind E33/E35.
Gates: G0 green every attempt; `bash -n` clean; **G6b
`./scripts/e2e/http-workflow.sh` run against the LIVE cluster four times,
green every time** (all 17 stages + cleanup).

### T08 — 2026-08-03

46/46 verdicts with evidence: 24 FIXED, 22 TRUE (3 of them
`TRUE (flag-only, NOT edited)` — AGENTS.md, TAXONOMY.md, SCHEMAS.md, per
ground rule 5). **9 DELETE proposals + 1 ARCHIVE**, each with a reason and
a named replacement verified to exist on disk — this is T09's purge list.
RECORD discipline held: `DRIFT.md` was extended ONLY through its own
declared append-only Code-fix log (60 insertions, 0 deletions, no dated
finding text altered), `INDEX.md` edits confined to the pre-`## Change:`
header tables, every dated entry untouched.
Biggest drifts: `skills/git-commit/**` legislated for a stack this repo
has never had — a `lefthook.yml` with three stanzas, `commitlint`,
`core.hooksPath`, a `develop` integration branch, and `npm run
lint:fix|typecheck|test:unit` against a root `package.json` that has NO
`scripts` key — with frontmatter carrying the `metadata:` block THREE
times (two copies auto-invoking on the retired `sdd` keyword) and a
worked example shipping a `Co-authored-by:` trailer that AGENTS.md rule 5
forbids; `README.md`'s smoke-test invocation was fabricated (the script
reads only `SMOKE_TEST_NAMESPACE`); `skills/envelope-messages/SKILL.md`
still carried the 5-producer census T02 had replaced with 11 — the skill
that teaches the envelope contradicting the canonical doc for it.
Escalation **E36**: `cache-service` is deployed with `min-scale: "1"` and
has NO `@Controller("cache")` anywhere in api-gateway and no caller in
admin-console — a service running permanently that nothing can reach.
Three attempts, two rejection rounds, both about the same thing:
**numbers and commands that do not reproduce.** R1 (2× REJECTED): six
sites asserted the root `package.json` "declares an empty `scripts`
object" backed by a python one-liner stated to print `{}` — it prints
`None`, there is no `scripts` key at all; the Angular architecture skill
said "the **eleven** feature folders are" and then listed **ten** (`fd
-td -d1` confirms ten); and E36's own evidence named
`gateway-health.service.ts` as carrying `CACHE_SERVICE_URL` (it carries
the derived `gatewayConfig.services.cache`) and listed one env overlay
where there are two. Reviewer B added three more: the fix had made
`skill-resolver.md` MISQUOTE the contract it exists to quote verbatim, a
`post-checkout` hook recipe that re-indexes on every file-only checkout,
and a DRIFT.md summary whose arithmetic did not match its own table.
R2 (A APPROVED / B REJECTED): the frontmatter revert left the
`angular/forms` ledger row claiming "plus the frontmatter repair" — an
edit the diff did not contain, contradicting its own sibling row. Fixed,
then a machine-checked sweep of all 46 rows against the diff (zero
mismatches both ways, including the inverse check for TRUE rows claiming
edits). Final 2× APPROVED.
T09 sequencing blockers recorded: `INDEX.md`'s "see CHECKPOINT.md for the
full runbook" pointer must be repointed in the same commit that deletes
it; `METERING-FOUNDATION.md` cannot move until E6's six source-comment
paths are fixed; and `DOC-VS-CODE-AUDIT.md`'s K1–K10 collide by number
with the shipped K6a–K11.
Gates: G0 green every attempt; skill claim-guard
`packages/shared/test/unit/envelope-schema.spec.ts` 21/21 and full
package 373/373 green before and after.

### T09 — proposal (awaiting ruling)

> **NOTHING IS EXECUTED.** This section is a decision document. No file was
> moved, merged, deleted or renamed; no guard was edited. The only file this
> task wrote is this SPEC. Christian rules D1–D34 (`yes` / `no` / `modify`),
> the rulings get recorded verbatim under "### T09 — ruling", and **T10**
> executes exactly what is approved and nothing else.
> Every count below was produced by the command shown, run at the repo root on
> **2026-08-03** on `feature/fix-docs-codigo-manda` @ `fbd15311`, tree clean.
> G0 (`./scripts/checks/doc-code-guards.sh`) green before and after writing
> this section.

#### (a) The target tree

**CURRENT shape** — `fd -H -e md --type f | wc -l` → **273** markdown files in
**18** top-level doc roots (`… | python3 -c "…split('/')[0]"` → 18 keys), plus
28 script headers and 5 claim-bearing skill assets = the ledger's 306 rows.
Per-root, `fd -H -e md --type f . <dir> | wc -l`:

| Root | md | What lives there today | Problem |
| --- | --- | --- | --- |
| `.sdd/` | 54 | RECORD (per-change adr/design/tasks/archive) | hidden; a **second** record system AGENTS.md never mentions (F1) |
| `DOCS/` | 48 | descriptive + prescriptive + RECORD (`adr/`, `runbooks/archive/`, `decision-log.md`) + future (`v_next/`) | four classes, no banner, no guard — the reader cannot tell which is which |
| `manual-loops/` | 40 | RECORD (loop specs + Progress) | correct, and the model |
| `integrations/` | 27 | descriptive (13 samples × EN + ES twins + index) | 13 `.es.md` twins hand-synced (O1) |
| `services/` | 25 | 20 READMEs + 3 in-tree docs + 2 `.sdd/` | co-location is right (K6g already guards it) |
| `cowork/` | 18 (+1 `.html`) | RECORD, dead working notes, 2 prescriptive, 1 register | **8 of 17 notes are dead**; no class, no convention, no guard |
| `skills/` | 16 | skill | fine, but not the only skills root |
| `.agents/` | 8 | skill (adr-skill) | a **second** skills root (F, T01) |
| `sdk/` | 8 | descriptive + RECORD | fine |
| `(repo root)` | 7 | prescriptive ×4, RECORD ×1, future ×1, descriptive ×1 | `backlog.md` is a dead future doc |
| `packages/` | 5 | descriptive | fine |
| `.claude/` | 4 | prescriptive (the loop engine) | 1 of the 4 has a stale duplicate in `cowork/staging/` |
| `demos/` | 3 | descriptive + prescriptive | fine |
| `manual-loops-templates/` | 3 | prescriptive | named by AGENTS.md → cannot move without a rule-5 ruling |
| `scripts/` | 3 | prescriptive/descriptive | fine |
| `golden/` | 2 | RECORD | named by AGENTS.md → same |
| `fixtures/` | 1 | descriptive | orphan (section U) |
| `knative/` | 1 | descriptive | orphan (section U) |

Sum reconciles: `48+18+40+3+16+8+4+54+2+27+3+8+5+3+25+1+1+7 = 273`.

**The diagnosis behind "tanto documento es confuso"** is not raw volume — it is
that the repo runs **five parallel record systems** (`manual-loops/`, `cowork/`,
`.sdd/`, `golden/`, `DOCS/adr/` + `decision-log.md`), **two skills roots**
(`skills/`, `.agents/skills/`), **two copies of the loop command**, and **zero
markers of doc class** anywhere. A reader has no way to tell an as-built
description from a 2026-06 handoff.

**PROPOSED shape** — same rules, four classes, and every class has exactly one
home:

```
DOCS/                  descriptive + prescriptive, cross-cutting.  Class banner MANDATORY (K12).
  architecture/ messaging/ channels/ agents/ workflows/ skb/ guides/ runbooks/
  adr/                 RECORD (decision records, dated, never rewritten)
  v_next/              future (the ONLY future-class dir; promotion rule already documented)
  archive/             RECORD — retired working notes, banner-guarded (K6f extended)
    audits/            the surviving cowork audits
    runbooks/          (already exists as DOCS/runbooks/archive/ — folded in or left, D3b)
<component>/README.md  descriptive, co-located, ONE per component (K6g already enforces)
manual-loops/          RECORD — loop specs + Progress (unchanged; the model)
manual-loops-templates/, golden/   unchanged (AGENTS.md names them — moving needs D31)
.claude/, skills/      prescriptive/skill — ONE loop-command copy, ONE skills root
.sdd/                  RECORD — blessed in AGENTS.md (D4) or folded into DOCS/archive/sdd/
```

Net arithmetic if D1–D22 are approved as recommended:
`273 − 11 deleted + 2 from splits = 264` md files; doc roots `18 → 16`
(`cowork/` dissolved, `.agents/` folded); and for the first time every file
declares its class and a guard checks it.

#### (b) Decisions — structure (D1–D6)

| ID | Decision | Why | Impact if approved | Default |
| --- | --- | --- | --- | --- |
| **D1** | Make the four classes explicit: every file under `DOCS/**` and every service/package README declares `Class: descriptive\|prescriptive\|future\|RECORD` in its first 10 lines; new guard **K12** fails otherwise | the SPEC's Goal clause; today nothing marks class and T01 had to reclass 4 files by hand | **73** files get a 1-line banner in T10 (48 `DOCS/**` + 20 service + 5 package READMEs); K12 added. The 27 sample READMEs under `integrations/`/`demos/` are excluded unless this is modified | **YES** |
| **D2** | RECORDS live in exactly two homes: `manual-loops/**` (loop records) and `DOCS/archive/**` (everything else dated). Extend the *existing* `DOCS/runbooks/archive/` + K6f banner convention rather than inventing one | reuse before rewrite — K6f already enforces "Status: historical" in the first 10 lines of `DOCS/runbooks/archive/*.md` | new dir `DOCS/archive/`; K6f glob widened | **YES** |
| **D3** | Dissolve `cowork/` after the purge. Survivors route: (a) audits `ASYNC-RESILIENCE-AUDIT`, `DOC-VS-CODE-AUDIT`, `TRACEABILITY-audit`, `METERING-FOUNDATION`, `CACHE-architecture` → `DOCS/archive/audits/`; (b) prescriptive `LOOP-PLAYBOOK`, `codebase-memory-mcp-setup` → `DOCS/guides/`; (c) `INDEX.md` → `DOCS/archive/INDEX.md`, still append-only; (d) `DOCS-TRUTH-LEDGER.md` (this audit's instrument) → `DOCS/archive/audits/` when T10 closes it | `cowork/` is the only root with no class, no convention and no guard, and 8 of its 17 notes are dead | 9 git mv + link fixes; `cowork/` gone. **Blocked for METERING-FOUNDATION until E6 is fixed (SB2)** | **YES**, except METERING-FOUNDATION → sequence |
| **D4** | `.sdd/` (54 + 2 docs) is **blessed** as a RECORD system and named in AGENTS.md, not deleted | it is the *named replacement* for 2 of the 9 deletes (`CHANGES-for-dev` → `.sdd/changes/traceability-*/archive.md`; `DESIGN-http-channel-instances` → `.sdd/changes/http-channel-instances/adr.md`). Deleting it breaks the purge's own justification | AGENTS.md gains 1 line (needs D30); `.sdd/` gains a README banner | **YES (bless)** |
| **D5** | One skills root: fold `.agents/skills/adr-skill/**` (8 docs) into `skills/adr/` | AGENTS.md names `skills/` and `.claude/skills` is a symlink to it; a second root prescribing ADR conventions that `DOCS/adr/` obeys is invisible to every reader | 8 files moved, `skills/` 16 → 24, `.agents/` gone | **YES** |
| **D6** | Section-U orphans (`fixtures/bus-events/README.md`, `knative/services/overlays/_components/README.md`) stay co-located as component docs and get added to K10's corpus | they describe the artifacts beside them; moving them would break co-location | 2 rows classed `descriptive`, K10 corpus +2 | **YES** |

#### (c) Decisions — merges & splits (D7–D12)

| ID | Merge / split | Source | Impact | Default |
| --- | --- | --- | --- | --- |
| **D7** | `DOCS/channels/meta-provider-pattern.md` → merged into `DOCS/channels/instagram.md` | T03 disposition | −1 file; `DOCS/channels/` 4 → 3 | **YES** |
| **D8** | Split `DOCS/skb/architecture.md`: as-built (§3, §4.2, §8, §10, §11) stays `descriptive`; the design body becomes `future`/RECORD | T03 disposition — one file currently carries two classes | +1 file, both class-clean | **YES** |
| **D9** | Split `DOCS/guides/doc-code-validation-tests.md`: the "Implemented" half is `descriptive`, the test-proposal half is `future` | T03 disposition — same two-class problem | +1 file | **YES** |
| **D10** | `DOCS/reference/ai-sdk.md` (**1365 lines**, `wc -l`) DELETED in favour of an upstream link + the ~2 repo-facing paragraphs folded into `DOCS/agents/`. `DOCS/reference/` then holds 0 files and the dir goes | T03 disposition — it is a vendor manual, not platform truth; T03 had to add a scope banner precisely so nobody reads it as as-built | −1 file, −1 dir | **YES** |
| **D11** | Hybrid class names: `DOCS/architecture/decision-log.md` (T02), `SCHEMAS.md` (T08) and `cowork/INDEX.md` (T08) are all `prescriptive`-labelled dated registers. Introduce the class `register` (dated rows amended in place) rather than forcing them into `RECORD` | three tasks raised the identical problem independently | class vocabulary gains 1 term; K12 accepts it. **SCHEMAS.md is read-only → needs D30** | **YES (add `register`)** |
| **D12** | The `:NNN` line-cite sweep parked by T04, T05 and T08: do **not** mass-convert existing in-range cites; ban them where they rot hardest — inside `services/`/`packages/` source (K13, D24) — and convert on touch | 3 tasks parked the same call; a mass conversion is a 100+ file diff with no test | policy line in AGENTS.md/ledger; no bulk diff | **YES (targeted)** |

#### (d) The DELETE list — 11 files + 1 archive-move (D13–D23)

Nine DELETE + one ARCHIVE come verbatim from the ledger's
`### T08 DELETE / ARCHIVE proposals` table (10 rows, each with a named
replacement verified on disk); D10 above adds `ai-sdk.md` and D7 adds
`meta-provider-pattern.md` → **11 deletions total**.

| ID | File | Why it is dead | What replaces it | Default |
| --- | --- | --- | --- | --- |
| **D13** | `backlog.md` | 8 undated, unowned Spanish one-liners, no code counterpart; one ("WF el habilitado/desabilitado se persiste?") is already answered (`WORKFLOW_STATUS.ENABLED` shipped). Violates AGENTS.md rule 5 | Nothing, deliberately — the work queue is `manual-loops/*.md` + Engram | **YES** |
| **D14** | `cowork/CHECKPOINT.md` | session resume point whose session ended; cites `scripts/e2e-http-workflow.sh` (never existed) and `/sdd:*` (retired) | `README.md` + `bootstrap-from-scratch.md` | **YES** — **SB1**: `INDEX.md`'s "see CHECKPOINT.md for the full runbook" must be repointed in the SAME commit |
| **D15** | `cowork/SESSION-HANDOFF.md` | documents `setup.sh` files under `integrations/` that no longer exist | trace feature README + 2 sample READMEs + `.sdd/changes/processes-message-trace/` | **YES** — **SB4**: verify its "Known gaps" list is present in the trace README first |
| **D16** | `cowork/CHANGES-for-dev.md` | handoff to a developer who read it; work shipped. Points at `services/audit-service/CLAUDE.md`, which K6g now forbids recreating | the four `.sdd/changes/traceability-*/archive.md` + `TRACEABILITY-audit.md` | **YES** (depends on D4) |
| **D17** | `cowork/DEBUG-fanout-telegram.md` | deadest file in `cowork/`: drives `setup.sh` scripts that no longer exist, cites `sdk/src/**/*.js` where 0 `.js` remain, machine-specific UUIDs, Spanish | `integrations/channels/http-fanout-telegram/README.md` | **YES** |
| **D18** | `cowork/SDK-http-sdk.md` | describes a JS ingest-only SDK; 0 `.js` in `sdk/src`, SDK ships 21 namespaces + a CLI. Already banner-marked SUPERSEDED | `sdk/README.md`, `sdk/examples/README.md` | **YES** |
| **D19** | `cowork/DESIGN-http-channel-instances.md` | Option B shipped; its three "Decisiones abiertas" are answered by the code. Cites `.js` SDK paths + a deleted `setup.sh`. Spanish | `.sdd/changes/http-channel-instances/adr.md`, `DOCS/messaging/ingress.md` | **YES** (depends on D4) |
| **D20** | `cowork/staging/manual-loop.command.md` | unmaintained second copy of the loop engine that had already drifted on the reviewer-context rule | `.claude/commands/manual-loop.md`, versioned on purpose | **YES** — decide together with its section-U twin row |
| **D21** | `cowork/ARCHITECTURE-ANALYSIS.md` | self-declared stale snapshot; architecture half superseded on every axis | `DOCS/architecture/overview.md` + `runtime-streaming.md` + `mcp-connections.md` | **YES** — **SB5**: §11–§12 (the `codebase-memory-mcp` fit assessment) must be carved out into `codebase-memory-mcp-setup.md` first |
| **D22** | `DOCS/reference/ai-sdk.md` (= D10) | 1365-line vendor manual | upstream link + repo-facing notes in `DOCS/agents/` | **YES** |
| **D23** | **ARCHIVE, do NOT delete**: `cowork/DESIGN-run-view.md` + `cowork/DESIGN-run-view.html` → `DOCS/archive/` | fulfilled BINDING visual contract for a shipped feature; nothing replaces it, `manual-loops/run-view.md` cites rather than contains it | Nothing — it IS the record | **YES (archive)** — **SB6**: both files move together or neither does |

Explicitly **KEEP** (audited, still load-bearing, re-homed by D3, not deleted):
`ASYNC-RESILIENCE-AUDIT.md` (origin of K7), `DOC-VS-CODE-AUDIT.md` (origin of
the K-family), `METERING-FOUNDATION.md` (SB2), `TRACEABILITY-audit.md` (model
RECORD), `CACHE-architecture.md`, `codebase-memory-mcp-setup.md`,
`LOOP-PLAYBOOK.md`, `INDEX.md`.

**Considered and rejected on evidence** (recorded so it is not re-proposed):
`integrations/http/http-connectors/connectors/*.json` — five files nothing in
that sample reads, which read as dead weight, but `scripts/e2e/README.md` uses
them as ready-made `POST /api/connectors` bodies (`curl … -d @…/pokeapi.json`).
They stay; their real status is now written down (T06).

#### (e) Decisions — guards (D24–D29)

| ID | Guard | Closes | Cost | Default |
| --- | --- | --- | --- | --- |
| **D24** | **K12 — class banner**: every `DOCS/**/*.md` and every component README declares its class in the first 10 lines | D1; the whole "which kind of doc is this?" confusion | modelled byte-for-byte on the shipped `k6f_archive_banner` | **YES** |
| **D25** | **K13 — doc references inside source resolve**: fail when a `DOCS/**`- or `cowork/**`-shaped path inside `services/`, `packages/`, `sdk/`, `scripts/` does not exist on disk, and fail on any `DOCS/**.md:NNN` line cite | **E6** (6 files cite `DOCS/cowork/METERING-FOUNDATION.md`, a path that has never existed) and **E4** (7 files pin `envelope.md:77`/`:402`). Nothing catches either today — K10 scans links in docs, not doc paths in source | one new guard function; unblocks SB2 | **YES** |
| **D26** | **K10 widened**: add `DOCS/archive/**` to the corpus, and fail on lowercase `docs/…` path refs anywhere in it | the case-sensitivity bug: `git ls-files \| rg -c '^DOCS/'` → **48**, `'^docs/'` → **0**, yet `rg -o 'docs/[a-z]+/[A-Za-z0-9._-]+\.md' TAXONOMY.md SCHEMAS.md DRIFT.md \| wc -l` → **31** refs (TAXONOMY 25, SCHEMAS 4, DRIFT 2) that are dead on Linux/minikube. **Ledger correction: T08 recorded 28; the reproducible count is 31** — T08 counted matching *lines*, and three lines carry two refs each | corpus +1 dir, 1 new check | **YES** |
| **D27** | **K6f extended** from `DOCS/runbooks/archive/*.md` to `DOCS/archive/**/*.md` | D2's archive convention has to be enforced or it rots like `cowork/` did | 1-line glob change | **YES** |
| **D28** | **K-number collision resolved before any new guard lands**: `cowork/DOC-VS-CODE-AUDIT.md` proposes K1–K10; `doc-code-guards.sh` ships K6a–K6g, K7, K8, K9, K9b, K10, K11 (13 guards in `main()`). "K9" and "K10" each name two different things | T08 sequencing blocker SB3 — adding K12/K13 on top of a collision makes it permanent | rename the *proposal* family (it is a RECORD → add a crosswalk table instead of rewriting rows) | **YES (crosswalk, don't rewrite the RECORD)** |
| **D29** | **K14 — fixture/manifest byte parity** (optional): assert the sample fixtures equal the manifest's inline copy | T06 found `acme-telco-policy.md` had drifted 3420 vs 3450 bytes; `support-faq.md` is byte-identical today (781 bytes) but hand-synced | 1 guard, 2 file pairs | **MODIFY — nice-to-have, defer to a follow-up loop** |

#### (f) Decisions — repo-state / policy (D30–D34)

| ID | Question | Ledger evidence | Default |
| --- | --- | --- | --- |
| **D30** | **AGENTS.md may be edited by T10** (ground rule 5 requires an escalated ruling — this round is it) to: name `.sdd/` (F1), name the four classes + `register`, and name `DOCS/archive/` | AGENTS.md today implies "all SDD is gone" (its retirement list) while 56 `.sdd/` docs live, and `scripts/sdd-profile.mjs` + `.claude/sdd-profiles.json` survive | **YES, minimal edits only** |
| **D31** | `manual-loops-templates/` (3) and `golden/` (2) stay where they are | AGENTS.md names `manual-loops-templates/README.md` and `golden/labeled.tsv` by path; moving them is a bigger rule-5 edit for no reader benefit | **YES (leave)** |
| **D32** | **F2 — the unenforced hex clause**: `rg -c '#[0-9a-fA-F]{6}' -g '*.ts' services/admin-console/src/app/features \| wc -l` → **58** files break AGENTS.md's "no hard-coded hex — reviewer rejection" | a clause the code has never honoured (rule 4). Three options: guard it (fails today, 58 files), soften the clause to "new code", or leave it aspirational | **MODIFY → soften to new code + add the guard scoped to `git diff`** |
| **D33** | **F3 — Spanish artifacts vs rule 5**: `cowork/LOOP-PLAYBOOK.md`, `cowork/DESIGN-http-channel-instances.md` (D19 deletes it), `cowork/DEBUG-fanout-telegram.md` (D17 deletes it), `backlog.md` (D13 deletes it), + the Spanish-*named* `skills/envelope-messages/references/diseno-mensajes.md` | the purge already kills 3 of the 5. Remaining: translate `LOOP-PLAYBOOK.md` (155 lines) or name the exception | **MODIFY — translate LOOP-PLAYBOOK, grant the filename exception (its header already explains it)** |
| **D34** | **E23 — dot-less templates**: `integrations/mcp/{mcp-connections,mcp-repo-support-bot}/env.example` are the only 2 of the 13 sample templates without a leading dot; the stated reason was disproved by E17 | rename both to `.env.example` + the `cp env.example .env` lines in 4 READMEs | **YES (rename)** |

#### (g) Escalations E1–E36 — grouped for one ruling each

36 escalations, no gaps: E1–E23 (`### Escalations`), E24–E35 (T07), E36 (T08).

**SECURITY — fix first, own loop, this week (1)**

| ID | Finding |
| --- | --- |
| **E9** | **GENUINE SQL INJECTION.** `SKBRowsRepository.executeQuery` interpolates `containerId` (a bare `@Param("id")` — **no `ParseUUIDPipe`, no format check anywhere on the path**) and `categories` (typed only `@IsArray()`, no `@IsString({each:true})`) into `sql.unsafe()`. Demonstrated: `POST /api/admin/structured-kb/containers/x' OR '1'='1/query` → `WHERE container_id = 'x' OR '1'='1' AND tenant_id = …` → every row of every container in the tenant, and the same hole accepts arbitrary trailing SQL. The ONE bound is `getSql(tenantId)` (per-tenant connection), so observed blast radius is cross-container within one tenant — but the injection point itself is unbounded (simple query protocol, no keyword filtering). Fix: parameterise (`sql.unsafe(text, params)` is already used elsewhere **in the same file**) *and* validate `containerId` as a UUID + constrain `categories` element-wise. |

**GROUP B — genuine bugs, each needs a fix ticket (13)**

| ID | One-line finding | Recommend |
| --- | --- | --- |
| **E36** | `cache-service` deployed with `min-scale: "1"` (a pod runs permanently) with **no `@Controller("cache")` proxy in api-gateway** and no caller in admin-console. `rg -n "CACHE_SERVICE_URL"` → exactly 4 hits: 1 source (`gateway.config.ts`), 1 README row, 2 overlays — none a call. Its own README agrees it calls nothing and is called by nothing | **DELETE the service**, or wire the gateway proxy. Doing neither is the only option that costs resources for no behaviour |
| **E11** | connector-admin accepts `authType: "oauth2-client"` but both header injectors switch on `"oauth2"` → such connectors get **NO `Authorization` header**, silently | fix ticket |
| **E13** | agent-scheduler-service **cannot schedule anything as deployed**: no tenant discovery/seeding, no `LEADER_ELECTION_POSTGRES_URL`/`REDIS_URL` in the manifest, health still reports `ok` | fix ticket, or admit it as unshipped |
| **E18** | `ai-system-variables` — the sample's **headline step** looks up camelCase names while the manifest declares slugs, so it always prints `(missing!)` | fix ticket (sample source) |
| **E10** | `proxy-service` + `tenant-service` `package.json` `test` scripts are defined in terms of `pnpm test` — **infinite recursion, no test ever runs** | fix ticket |
| **E15** | `sdk`'s `"test": "tsx --test 'test/**/*.test.ts'"` never runs the **14 co-located `src/cli/**/*.test.ts`** specs — the whole `yoizen` CLI (incl. `--secrets-from-env`) is untested by its documented command (`bun test` finds them: 471 vs 343) | widen the glob + re-baseline the count |
| **E27** | `scripts/smoke-test.sh` gates on **8 of 11** worker Deployments (omits `connector-runtime-http`, `connector-runtime-invoke`, `tracking-ingester-worker`), and BOTH startup orchestrators use it as their readiness gate → bring-up can be "ready" with three workloads crash-looping | fix ticket |
| **E29** | `dev-mode.sh` + `dev-mode-minikube.sh` map `connector-runtime` to 1 Deployment; the manifests declare 3 and `rebuild-redeploy.sh` rolls all 3 | fix ticket (with E34's table) |
| **E33** | `rebuild-redeploy.sh` chases a **phantom `connector-runtime` ksvc** (warns on every rebuild); its `usage()` also understates the deploy phase and advertises `qa/staging/production` overlays that do not exist | fix ticket (a) + string fixes (b)(c) |
| **E24** | `purge-circuit-breakers.sh` can **never** report a failed sweep — `any_error` is declared and never assigned; every per-master op runs under `|| true` | fix ticket |
| **E25** | `mapfile` in the Redis-cluster branch breaks the repo's own bash-3.2 rule (latent only because dev Redis is standalone) | fix ticket |
| **E28** | the Claude PostToolUse hook runs `vitest related`, but `vitest` exists in **one** manifest repo-wide (`admin-console`) → the test half is inert for nearly every edit | pick the real runner |
| **E12** | `SkillFileService.parseFrontmatter` splits YAML on `indexOf(":")` → `description: >` becomes the literal `">"` | parse real YAML, or guard/lint the frontmatter |

**GROUP C — dead or lying data/config, delete-or-wire (4)**

| ID | Finding | Recommend |
| --- | --- | --- |
| **E5** | 2 Prometheus alerts (`alerts.yaml`, group `nats-consumer-lag`) filter on durables `webhook-dispatcher` / `event-processor` that appear in no `DURABLE_NAME` under `services/` | delete the two filters (infra ticket) |
| **E7** | `services/agent-admin-service/data/jobs.yaml` — the reference seed — is wrong on **three** axes: `interval:3600` means 3600 **minutes** (60 h) not hourly, `enabled:` where `IJob` declares `is_active`, and `payload.action` where `JobExecutorService` reads `payload.action_type` (falls to `default` → `execution_failed`) | correct the fixture (a new dev copies it) |
| **E8** | `validateSelectOnly()` + `enforceLimit()` in `skb-sql-safety.ts` are **exported, tested and never called** — yet `security.md` presented them as Layers 2 and 5 of a 5-layer defence | wire them (natural companion to the E9 fix) |
| **E23** | 2 dot-less `env.example` templates (see D34) | rename |

**GROUP D — documentation-of-record defects inside code/config files (10).**
Fix = comment/manifest text only, no behaviour change. This loop could not touch
them (source is outside every task's allowed set).

`E4` (7 source files pin `DOCS/messaging/envelope.md:77`/`:402`) · `E6` (6 files
cite the nonexistent `DOCS/cowork/METERING-FOUNDATION.md` — **blocks D3/SB2**) ·
`E14` (`ensureDurableConsumer`'s JSDoc calls `backoff` immutable while
`reconcileDurableConsumer` diffs and updates it) · `E16` (5 `sdk/src` resource
headers still say "404s / pending deploy" against e2e files that assert the
opposite; `config-files/types.ts` contradicts itself in consecutive sentences) ·
`E19` (`ai-agent-triage` prints a `🎧 Triage` example no branch can emit) ·
`E20` (`hosted-services-api/manifest.yaml` header asserts a lifted restriction) ·
`E21` (`reference-pattern/src/setup.ts` names a `resolve-env.sh` that does not
exist in its tier) · `E22` (`registry-services-writer.ts`'s "COMPARABLE
LIMITATION" block describes the superseded comparator — **it already
manufactured drift once**: a reviewer caught T06 importing it into a README) ·
`E26` (`reset-dev.ts` header lists Mongo vars as required; `REQUIRED_ENV` holds
ten names and none is a Mongo var) · `E34` (`DOCS/guides/dev-mode.md`'s table
omits `tracking-ingester-service` + `provisioning-service`, both implemented in
`get_targets`) — **recommend: one comment-reconciliation ticket, and D25's K13
makes E4/E6 unrepeatable.**

**GROUP E — string fixes inside executable lines (4).** T07 was allowed
comment-only edits; these live in `log`/`fail` arguments, `usage()` heredocs and
`sed` ranges, so it had to escalate: `E30` (three `usage()` helpers print past
the end of their header — `kustomize-safe-apply.sh` 8 printed / 6 live shell,
`rebuild-changed.sh` 5 / 3, `scripts/orbstack/startup.sh` 4 / 2) · `E31`
(`purge-temporal.sh` prints two dead doc paths at runtime) · `E32`
(`doc-code-guards.sh` K6c tells the operator to edit `ROW_FILES`; the symbol is
`row_files_for`) · `E35` (`purge-temporal.sh`'s `usage()` heredoc still asserts
the reverted HA topology in three places). **Recommend: one small PR, no logic
touched.**

**GROUP P — policy calls, nothing is broken (4)**

| ID | Question | Recommend |
| --- | --- | --- |
| **E1** | `envelope.md` §2.1 prescribes `type = io.yoizen.<domain>.<channel>.<provider>.<kind>.v1`; only the channel/webhook path obeys it — every internal producer emits `io.yoizen.platform.<area>.<kind>.v1` | **narrow the clause to the channel domain** and document the platform form as the second sanctioned shape |
| **E2** | same for `source`: real values include `//agent-admin-service/admin/agents/publish` and a bare `"agent-ai-service"` (not a URI) | **document `//service/path` + name the bare-string exception**, or ticket the producers |
| **E3** | `ExecutionHandler.publishStatus` publishes to `…ai-agent-gateway.automation…` while the envelope says `producer: "agent-ai-service"` | doc-only today (`runtime-streaming.md` already calls it a pre-existing inconsistency); **ticket the subject fix or bless it explicitly** |
| **E17** | CLOSED, no action — recorded because it was a *false* escalation: "the sandbox cannot write `.env.*`" was a TOOL refusal, not a filesystem fact, disproved by fixing one through the shell. Kept as a process note | no ruling needed |

#### (h) Sequencing blockers T10 must honour

| # | Blocker |
| --- | --- |
| **SB1** | `cowork/INDEX.md`'s "see CHECKPOINT.md for the full runbook" pointer must be repointed at `README.md` in the SAME commit that deletes `CHECKPOINT.md` (D14) |
| **SB2** | `METERING-FOUNDATION.md` **cannot move** (D3) until E6's six source-comment paths are fixed — moving it first makes six wrong pointers *doubly* wrong |
| **SB3** | Resolve the K-number collision (D28) BEFORE K12/K13 land |
| **SB4** | Verify `SESSION-HANDOFF.md`'s "Known gaps" list exists in the trace README before D15 deletes it |
| **SB5** | Carve `ARCHITECTURE-ANALYSIS.md` §11–§12 into `codebase-memory-mcp-setup.md` before D21 deletes it |
| **SB6** | `DESIGN-run-view.md` and `DESIGN-run-view.html` move together or neither moves (D23) |
| **SB7** | `.sdd/` cannot be deleted or archived away while it is the named replacement for D16 and D19 |
| **SB8** | T10's link check must cover the moved/deleted set repo-wide, not just K10's corpus — K10 excludes `cowork/` and `manual-loops/` today, which is exactly why SB1 was invisible |

#### (i) OPEN questions — the ledger never framed these

| # | Question | Why it is open |
| --- | --- | --- |
| **O1** | The **13 `.es.md` sample twins** (`fd -H -e md \| rg '\.es\.md$' \| wc -l` → 13) + `GUION-DEMO.md` vs AGENTS.md rule 5 "all artifacts in English". F3 lists only 4 Spanish artifacts and never framed the twins | T06 audited and FIXED both halves of every pair and never proposed a merge — but it also proved the hazard: `telegram-transform-reply/README.es.md` contradicted its EN twin **twice**, false half each time, and `mcp-repo-support-bot/README.es.md` had no `manifests apply` step at all. Keep both languages (customer-facing) or English-only? |
| **O2** | Does `cowork/INDEX.md` (the append-only change register) survive D3's move as `DOCS/archive/INDEX.md`, or is it retired in favour of `manual-loops/` Progress logs? | it is the only cross-loop register, but nothing enforces it and it drifted (its CHECKPOINT pointer, SB1) |
| **O3** | `CLAUDE.md` is **gitignored** (`.gitignore` lines 1, 83, 128) → a fresh clone has NO pointer to AGENTS.md | if that pointer is load-bearing it belongs in a tracked file; if not, several docs still treat `CLAUDE.md` as a rules file |
| **O4** | Do the `DOCS/adr/` records (6) and `DOCS/architecture/decision-log.md` merge into ONE decision register, or stay two? | T03 confirmed all 6 ADRs as RECORD and T02 found `decision-log.md` is a *live* register ("rows are amended in place"), not history — but no task was asked whether the repo needs both |
| **O5** | `DOCS/adr/agent-architecture-improvements.md` is `status: proposed`, dated 2026-06-11, **nothing shipped** (verified absent: no `context/` module dir, no `USE_CONTEXT_PIPELINE`, no `ContextPipeline`) and its problem statement is still literally true | accept it, reject it, or move it to `DOCS/v_next/`? The SPEC's T03 line asked for this ruling; the ledger recorded the evidence but not a recommendation |

#### T09 — ruling

_(to be filled verbatim with Christian's decisions before T10 starts)_

| ID | Ruling |
| --- | --- |
| **D1** | **MODIFY — approved.** Banner is two lines, not one: `Class:` followed by a `Summary:` line with a one-sentence description of what the file does. Applies to all 73 files (48 `DOCS/**` + 20 service READMEs + 5 package READMEs); the 27 sample READMEs under `integrations/`/`demos/` stay excluded per the original default. Format:<br>`Class: descriptive`<br>`Summary: <one-line, what this file does>`<br>K12 must check for both lines, not just `Class:`. |
| **D2** | **YES — approved as proposed.** RECORDS live in `manual-loops/**` and `DOCS/archive/**` only; ~~K6f~~ **G6f**'s glob widens from `DOCS/runbooks/archive/*.md` to `DOCS/archive/**/*.md`. (Guard renamed to `G`-prefix per D28.) |
| **D3** | **YES — approved as proposed.** Dissolve `cowork/`: audits → `DOCS/archive/audits/`, prescriptive guides → `DOCS/guides/`, `INDEX.md` → `DOCS/archive/INDEX.md`, `DOCS-TRUTH-LEDGER.md` → `DOCS/archive/audits/` at T10 close. `METERING-FOUNDATION.md` stays put until **SB2** (E6 fix) clears. |
| **D4** | **YES — approved as proposed.** `.sdd/` is blessed as a named RECORD system in AGENTS.md (contingent on D30 approving the AGENTS.md edit), README banner added. |
| **D5** | **YES — approved as proposed.** Fold `.agents/skills/adr-skill/**` (8 docs) into `skills/adr/`; `.agents/` root removed. |
| **D6** | **MODIFY — split ruling.** `fixtures/bus-events/README.md`: **YES**, keep co-located, add to ~~K10~~ **G10** corpus as proposed — verified valid (11 fixtures on disk, actively used by `tracking-ingester-service` and `workflow-service` tests). `knative/services/overlays/_components/README.md`: **DELETE instead of keep** — verified the `_components/` composition pattern has zero consumers (no `kustomization.yaml` in the repo uses `components:` or references `_components/`), and the file falsely claims `scale-to-zero-non-prod/`/`scale-to-zero-staging/` "remain on disk" when they do not (removed by `2c77968b` "back to dev mode for k8s"). Delete the file; T10 to confirm the `_components/` dir is otherwise empty before removing it too. |
| **D7** | **YES — approved as proposed**, for now. Verified Instagram is live, wired code (not premature) before ruling — `InstagramProvider` registered in `webhooks.module.ts` + `provider-registry.ts` + `Channel` union. Christian separately flagged the whole Instagram channel as stale and wants it removed in a **future, separate effort** — tracked as Engram memory #1239, out of scope for T09/T10. `meta-provider-pattern.md` → merged into `instagram.md` proceeds now regardless, since both would be deleted together later anyway. |
| **D8** | **YES — approved as proposed.** Split `DOCS/skb/architecture.md`: as-built sections (§3, §4.2, §8, §10, §11) stay `descriptive`; design body becomes `future`/RECORD in its own file. |
| **D9** | **YES — approved as proposed.** Split `DOCS/guides/doc-code-validation-tests.md`: "Implemented" half stays `descriptive`, test-proposal half becomes `future`, in its own file. |
| **D10 / D22** | **YES — approved as proposed.** Delete `DOCS/reference/ai-sdk.md` (1365 lines, vendor manual); replace with an upstream link + the ~2 repo-facing paragraphs folded into `DOCS/agents/`. `DOCS/reference/` dir removed (0 files left). |
| **D11** | **YES — approved as proposed.** New class `register` added (dated rows amended in place); K12 accepts it. Applies to `DOCS/architecture/decision-log.md`, `SCHEMAS.md` (contingent on D30 for edit rights), `cowork/INDEX.md` (moves to `DOCS/archive/INDEX.md` per D3, stays `register`). |
| **D12** | **MODIFY — approved with an added mass cleanup.** Policy as proposed: ban new `:NNN` cites inside `services/`/`packages/` source (K13, D25), convert existing ones on touch, no blanket sweep. **Additionally**: a mass conversion of existing `:NNN` cites runs now, scoped to LIVING docs only — `skills/multi-tenant/SKILL.md` (~40 cites), `skills/yz-ui/SKILL.md`, and the 7 source files pinning `envelope.md:77`/`:402` (E4). Explicitly EXCLUDED: `cowork/DOCS-TRUTH-LEDGER.md`, `cowork/INDEX.md`, `DOC-VS-CODE-AUDIT.md` — these are RECORD (D2: "dated, never rewritten") and their `:NNN` mentions are evidentiary prose describing audit findings, not live navigation pointers; rewriting them would corrupt the historical record, not fix rot. Verified before ruling: raw `\.md:[0-9]+` grep across `**/*.md` returns 111 hits, the large majority inside the three excluded RECORD files. |

#### (d) DELETE list — rulings

| ID | Ruling |
| --- | --- |
| **D13** | **YES — approved as proposed.** Delete `backlog.md`, no replacement. |
| **D14** | **YES — approved as proposed.** Delete `cowork/CHECKPOINT.md`; replaced by `README.md` + `bootstrap-from-scratch.md`. **SB1 applies**: `INDEX.md`'s "see CHECKPOINT.md" pointer must be repointed in the SAME commit. |
| **D15** | **YES — approved as proposed.** Delete `cowork/SESSION-HANDOFF.md`; replaced by the trace feature README + 2 sample READMEs + `.sdd/changes/processes-message-trace/`. **SB4 applies**: verify its "Known gaps" list is present in the trace README BEFORE deleting. |
| **D16** | **YES — approved as proposed.** Delete `cowork/CHANGES-for-dev.md`; replaced by the four `.sdd/changes/traceability-*/archive.md` + `TRACEABILITY-audit.md`. Depends on D4 (approved), no blocker. |
| **D17** | **YES — approved as proposed.** Delete `cowork/DEBUG-fanout-telegram.md`; replaced by `integrations/channels/http-fanout-telegram/README.md`. |
| **D18** | **YES — approved as proposed.** Delete `cowork/SDK-http-sdk.md` (already banner-marked SUPERSEDED); replaced by `sdk/README.md`, `sdk/examples/README.md`. |
| **D19** | **YES — approved as proposed.** Delete `cowork/DESIGN-http-channel-instances.md`; replaced by `.sdd/changes/http-channel-instances/adr.md`, `DOCS/messaging/ingress.md`. Depends on D4 (approved), no blocker. |
| **D20** | **YES — approved as proposed.** Delete `cowork/staging/manual-loop.command.md` (unmaintained duplicate, previously drifted on the reviewer-context rule, synced by T07 but still redundant). Twin row closed together: `.claude/commands/manual-loop.md` is confirmed as the sole canonical copy, versioned on purpose (`.gitignore:132` exception). |
| **D21** | **YES — approved as proposed.** Delete `cowork/ARCHITECTURE-ANALYSIS.md` (self-declared stale); replaced by `DOCS/architecture/overview.md` + `runtime-streaming.md` + `mcp-connections.md`. **SB5 applies**: carve out §11-§12 (the `codebase-memory-mcp` fit assessment) into `codebase-memory-mcp-setup.md` BEFORE deleting — it exists nowhere else. |
| **D23** | **YES — approved as proposed (ARCHIVE, not delete).** `cowork/DESIGN-run-view.md` + `cowork/DESIGN-run-view.html` → `DOCS/archive/`. **SB6 applies**: both files move together in the same commit, or neither moves — they are coupled as one binding visual contract record. |

#### (e) Guards — rulings

| ID | Ruling |
| --- | --- |
| **D24** | **YES — approved as proposed.** New guard, named `G12` directly (not `K12` — see D28), enforces D1's banner (`Class:` + `Summary:` per Christian's D1 modification), modelled on the shipped `k6f_archive_banner` (itself renamed `g6f_archive_banner` per D28). |
| **D25** | **YES — approved as proposed.** New guard `G13`: fails when a `DOCS/**`/`cowork/**`-shaped path inside `services/`, `packages/`, `sdk/`, `scripts/` doesn't exist on disk, and fails any `DOCS/**.md:NNN` line cite. Closes E6 + E4. Unblocks SB2. |
| **D26** | **YES — approved as proposed.** ~~K10~~ **G10** widened to cover `DOCS/archive/**` and fails on lowercase `docs/…` refs (case-sensitivity bug — dead on Linux/minikube, silent on Mac). Ledger correction stands: reproducible count is 31 refs, not T08's 28 (T08 counted lines, not refs; 3 lines carry 2 refs each). |
| **D27** | **YES — approved as proposed.** ~~K6f~~ **G6f** extended from `DOCS/runbooks/archive/*.md` to `DOCS/archive/**/*.md` (1-line glob change), enforcing D2's archive convention. |
| **D28** | **MODIFY — approved, upgraded from crosswalk to full rename.** The entire implemented guard family in `doc-code-guards.sh` is renamed from `K`-prefix to **`G`-prefix** (G = guard), same numbers: `K6a-K6g→G6a-G6g`, `K7→G7`, `K8→G8`, `K9→G9`, `K9b→G9b`, `K10→G10`, `K11→G11`. The three guards born in this ruling round (D24-D25-D26 above, D29 below) are named `G12`/`G13`/`G14` directly — they never carry a `K`-number. The RECORD `cowork/DOC-VS-CODE-AUDIT.md` (its original K1-K10 proposal, §"Locks") is **NOT rewritten** (D2: RECORD is never rewritten) — a crosswalk table is added there instead, mapping each of its K-numbers to the real `G`-guard it maps to (if any survived) or marking it "never implemented." Function names, `main()` registration, and every doc that references a `K`-guard by name (this SPEC's own D2/D6/D24-D27 rows above included) are updated to `G`. |
| **D29** | **MODIFY — approved, upgraded from optional guard to sync script.** Instead of the optional `G14` byte-parity guard, a script makes the `.md` fixture the single hand-edited source of truth: `acme-telco-policy.md`/`support-faq.md` are edited directly, and their manifest's inline `content:` block (`manifest.yaml`) is regenerated FROM the `.md` — drift becomes structurally impossible instead of merely detected. Investigated first: the manifest schema (`packages/shared/src/provisioning/manifest.schema.ts`) only supports `type: "inline"` for KB document sources today, no file-reference alternative — a real `type: "file"` schema addition was considered and parked as a separate TODO (Engram #1249) since it's a product/schema change affecting `ai-skill-support-agent`, `ai-knowledge-base-agent`, and `demos/crm-support-telegram` alike, out of scope for this docs loop. |

#### (f) Repo-state / policy — rulings

| ID | Ruling |
| --- | --- |
| **D30** | **YES — approved as proposed, minimal edits only.** T10 may edit AGENTS.md to: name `.sdd/` (F1, per D4), name the four classes + `register` (D1, D11), and name `DOCS/archive/`. Confirmed: F1/F2/F3 are the complete set of false claims found in AGENTS.md across all 8 audit tasks — D30 (F1) + D32 (F2) + D33 (F3) together close all of it, nothing left over. |
| **D31** | **YES — approved as proposed.** `manual-loops-templates/` and `golden/` stay where they are — AGENTS.md names them by exact path; moving is a bigger rule-5 edit for no reader benefit. |
| **D32** | **MODIFY — approved with the proposed default.** F2 (58 files under `services/admin-console/src/app/features` break the "no hardcoded hex" clause). AGENTS.md's clause softens to "no NEW hex literals" (ratchet); new guard scoped to `git diff` — fails only on hex introduced in added lines, existing 58 files grandfathered as known debt, not re-checked until touched. |
| **D33** | **MODIFY — approved with the proposed default.** F3 (Spanish artifacts vs rule 5). 3 of 5 already gone via the purge (D13, D17, D19). `cowork/LOOP-PLAYBOOK.md` (155 lines, survives the purge) gets translated to English. `skills/envelope-messages/references/diseno-mensajes.md` keeps its Spanish filename as an explicit, named exception (its own header already justifies it). |
| **D34** | **YES — approved as proposed.** E23: `integrations/mcp/mcp-connections/env.example` and `integrations/mcp/mcp-repo-support-bot/env.example` renamed to `.env.example` (their original no-dot rationale was disproved by E17); the 4 READMEs' `cp env.example .env` lines corrected to match. |

#### Escalations E1-E36 — rulings

| Group | Ruling |
| --- | --- |
| **SECURITY (E9)** | **CONFIRMED — separate, prioritized security loop, this week, NOT part of T10.** T10 (this SPEC) is docs-only reorganization; E9 is a genuine exploitable SQL injection in `SKBRowsRepository.executeQuery` and gets its own loop ahead of everything else in this SPEC. |
| **GROUP B (13 bugs)** | **CONFIRMED — each becomes an independent fix ticket, out of scope for T10.** E36, E11, E13, E18, E10, E15, E27, E29, E33, E24, E25, E28, E12 — no code changes happen inside the docs-truth-audit SPEC. |
| **GROUP C (4)** | **CONFIRMED, out of scope for T10, each its own ticket.** E5: delete the 2 dead Prometheus alert filters (infra ticket). E7: correct `jobs.yaml` fixture (interval unit, `enabled`→`is_active`, `action`→`action_type`). E8: wire `validateSelectOnly()`/`enforceLimit()` into the actual call path (natural companion to the E9 security fix). E23 already closed via D34. |
| **GROUP D (10)** | **CONFIRMED — one comment-reconciliation ticket, out of scope for T10.** E4, E6, E14, E16, E19, E20, E21, E22, E26, E34 — comment/JSDoc/header text fixes only, no behaviour change, bundled into a single ticket. D25 (guard G13) makes E4/E6's class of drift (dead doc paths cited from source) unrepeatable going forward. |
| **GROUP E (4)** | **CONFIRMED — one small commit on this branch (`feature/fix-docs-codigo-manda`), no logic touched.** E30 (3 `usage()` helpers printing more steps than the script has), E31 (`purge-temporal.sh` prints two dead doc paths at runtime), E32 (`doc-code-guards.sh` — now `G6c` post-D28 — tells the operator to edit `ROW_FILES`; real symbol is `row_files_for`), E35 (`purge-temporal.sh`'s `usage()` heredoc still asserts the reverted HA topology). String-only fixes, not a GitHub PR — no PR-to-main workflow exists for this repo (Engram: PR-to-main abandoned, this branch is where work lands). |
| **GROUP P — E1** | **CONFIRMED — doc-only, part of T10.** `envelope.md` §2.1 documents BOTH forms of `type` that already exist in code: the 5-segment `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` for channel/webhook producers, and the shorter `io.yoizen.<domain>.<kind>.v1` for internal producers (workflow, runtime, provisioning) that have no channel/provider. No code changes — the two forms reflect a real semantic distinction. |
| **GROUP P — E2** | **DONE (2026-08-04).** `source` no longer a URI. `envelope.md` §2.1/§10/§11 + `skills/envelope-messages/SKILL.md` + its `references/diseno-mensajes.md` + `assets/envelope-builder.ts` updated to the plain `service/path` form (no `//`). All 33 real production call sites fixed across `channel-service`, `api-gateway`, `agent-memory-service`, `workflow-service`, `agent-scheduler-service`, `agent-admin-service`, `connector-runtime`, `provisioning-service`, `registry-service` (constant `REGISTRY_EVENT_SOURCE`) — plus the 7 `agent-ai-service` sites that previously published a bare `"agent-ai-service"` string now carry context mirroring their sibling `resource` field (e.g. `agent-ai-service/execution/<id>`, `agent-ai-service/heartbeat`, `agent-ai-service/tools/request`). Matching test fixtures updated across `packages/shared`, `packages/database`, and affected services' unit/e2e specs. `cowork/DOCS-TRUTH-LEDGER.md` and this SPEC's own escalation-evidence text left untouched (RECORD, D2 — historical quotes of what the audit found, not live pointers). Full test suites green + typecheck clean on every touched service/package. |
| **GROUP P — E3** | **CONFIRMED — fix ticket, out of scope for T10.** `ExecutionHandler.publishStatus` publishes to a subject naming `ai-agent-gateway` while the envelope's `producer` field says `agent-ai-service`. Ticket to correct the subject (likely should read `agent-ai-service`, matching the producer) — not blessed as-is. |
| **GROUP P — E17** | Closed, no action — false escalation (a sandbox tool refusal misread as a filesystem fact), kept as a process note only. |

#### OPEN questions O1-O5 — rulings

| ID | Ruling |
| --- | --- |
| **O1** | **English-only. Delete all 13 `.es.md` twins + `GUION-DEMO.md`.** No content loss — T06 already audited and fixed both halves of every pair before this ruling, so the English half is complete and accurate on its own. Does NOT affect D33's `diseno-mensajes.md` exception — verified that file's CONTENT is already English (translated in the envelope-drift loop, 2026-07-31); only its filename stays Spanish because `SKILL.md` references it by that exact path. Two different things: O1 is full-document Spanish twins, D33 is a legacy filename on an English file. |
| **O2** | **CONFIRMED — already closed by D3 + D11, no new decision needed.** `cowork/INDEX.md` survives as `DOCS/archive/INDEX.md`, stays append-only, classed `register`. |
| **O3** | **YES — approved.** `README.md` (versioned) gains a line pointing to `AGENTS.md` as the normative document, so a fresh clone has a tracked pointer to the rules even without `CLAUDE.md` (gitignored, lines 1/83/128). |
| **O4** | **Stay two — resolved by the class system already built this round.** `DOCS/adr/` (6 ADRs, confirmed RECORD by T03 — frozen, dated, never rewritten per D2) and `DOCS/architecture/decision-log.md` (confirmed a LIVE register by T02, rows amended in place, classed `register` per D11) are structurally different classes. Merging them would undo the exact class separation D1-D11 just established. No new decision needed beyond applying D2/D11. |
| **O5** | **Move to `DOCS/v_next/`.** `DOCS/adr/agent-architecture-improvements.md` is `status: proposed`, dated 2026-06-11, verified nothing shipped (no `context/` module, no `USE_CONTEXT_PIPELINE`, no `ContextPipeline`), and its problem statement is still literally true today. `v_next/` is exactly the class D1's target tree reserves for this: not-yet-implemented but still relevant. Reclassed from RECORD-shaped ADR to `future`. |

#### T09 ruling round — CLOSED

All of D1-D34, E1-E36 (grouped), and O1-O5 ruled above. SB1-SB8 cross-checked against the rulings: SB1 (D14), SB2 (D3+D25), SB3 (superseded by D28's full rename), SB4 (D15), SB5 (D21), SB6 (D23), SB7 (D4) are each honoured by the ruling that names them. **SB8** (T10's own link check must cover the full moved/deleted set repo-wide, not just G10's corpus — the gap that made SB1 invisible in the first place) is a T10 execution instruction, not a decision point; T10 must implement it, not rule on it.

**What T10 executes** (docs-only, this branch, one loop): D1-D34 in full (banners, merges, splits, 11 deletes + 1 archive, `register` class, G-prefix guard rename G6a-G14, AGENTS.md minimal edits, hex-clause softening, LOOP-PLAYBOOK translation, `.env.example` renames) + O1 (delete 13 `.es.md` twins + `GUION-DEMO.md`) + O3 (README.md → AGENTS.md pointer) + O4/O5 (no-op / ADR reclass) — honouring SB1-SB8.

**What is explicitly OUT of T10, tracked separately:**
1. E9 — SQL injection, own security loop, priority, this week
2. E2 — envelope `source` drops URI shape, separate loop (Engram #1253)
3. E3 — `ExecutionHandler` subject fix ticket
4. Group B — 13 independent bug tickets (E36, E11, E13, E18, E10, E15, E27, E29, E33, E24, E25, E28, E12)
5. Group C — 3 tickets (E5, E7, E8)
6. Group D — 1 comment-reconciliation ticket (E4, E6, E14, E16, E19, E20, E21, E22, E26, E34)
7. Group E — 1 small commit, string-only (E30, E31, E32, E35)
8. TODO: Instagram/Meta channel removal (Engram #1239)
9. TODO: manifest schema `file`-type source (Engram #1249)

### T10 — 2026-08-04

The T09 ruling executed. **273 → 249 markdown files, 18 → 15 doc roots**, and
for the first time every cross-cutting doc declares its class under a guard.
Both counts by section (a)'s own methodology — one key per first path segment,
repo-root files as a single `(repo root)` key: `git ls-tree -r --name-only HEAD
| rg '\.md$' | … split('/')[0]` → 18 keys / 273 files, `git ls-files --cached |
rg '\.md$' | …` → 15 keys / 249 files. Three roots went: `cowork/` (D3),
`.agents/` (D5) and `knative/`, whose single markdown file was deleted under D6.
`DOCS/reference/` and `DOCS/runbooks/archive/` also went but are sub-directories
of `DOCS/`, never separate roots in the 18, so they do not change this number.
These supersede the conditional forecast in T09's proposal above (`264` files,
`18 → 16` roots), which was scoped to "if D1–D22 are approved as recommended";
the ruling approved more than D1–D22 — O1's 14 deletes and D6's `knative/`
delete are the difference. That paragraph is a frozen record of what was
proposed and is deliberately left as written.

**Purge (26 files).** `backlog.md` (D13); seven `cowork/` notes — `CHECKPOINT`,
`SESSION-HANDOFF`, `CHANGES-for-dev`, `DEBUG-fanout-telegram`, `SDK-http-sdk`,
`DESIGN-http-channel-instances`, `ARCHITECTURE-ANALYSIS` (D14-D21) — plus
`staging/manual-loop.command.md` (D20); `DOCS/reference/ai-sdk.md` (1365 lines,
D10/D22) and `DOCS/channels/meta-provider-pattern.md` (D7), both folded into a
survivor first; `knative/services/overlays/_components/README.md` (D6 as
MODIFIED — verified zero consumers of the `components:` pattern and a false
"remain on disk" claim; the emptied dir went too); and the 13 `.es.md` twins +
`GUION-DEMO.md` (O1). `DOCS/reference/` and `DOCS/runbooks/archive/` no longer
exist. Arithmetic: `1 + 7 + 1 + 1 + 1 + 1 + 13 + 1 = 26`, matching the ledger's
"DELETED (26 files in 14 rulings)" table row for row. `git diff --cached -M
--diff-filter=D --name-only | wc -l` reports **28**, two more, because
`cowork/LOOP-PLAYBOOK.md` and `cowork/codebase-memory-mcp-setup.md` were edited
past git's rename-similarity threshold while moving to `DOCS/guides/` (D33
translation, SB5 carve) and so show as delete + add. They are moves with a live
destination, not purges, and are counted under Structure below.

**Structure.** `cowork/` dissolved (D3): 5 audits + the closed ledger →
`DOCS/archive/audits/`, `INDEX.md` → `DOCS/archive/INDEX.md` (`register`,
`Status: append-only`), `LOOP-PLAYBOOK` + `codebase-memory-mcp-setup` →
`DOCS/guides/`, `DESIGN-run-view.md`+`.html` → `DOCS/archive/` together (D23,
SB6). `.agents/skills/adr-skill/**` → `skills/adr/**`, `.agents/` gone (D5).
`DOCS/runbooks/archive/**` → `DOCS/archive/runbooks/**`, because D2 says
records live in `DOCS/archive/**` *only* and D27 widens G6f to exactly that
glob. `DOCS/adr/agent-architecture-improvements.md` → `DOCS/v_next/` (O5).
Splits: `skb/architecture.md` §7+§9 → `skb/design-decisions.md` (D8 — §9's
SQL-injection "defence" is design intent the query path never calls, which is
precisely why it cannot sit in a descriptive doc);
`guides/doc-code-validation-tests.md` → `guides/doc-code-guards.md`
(descriptive) + `v_next/doc-code-validation-tests.md` (future) (D9). Every move
is a `git mv`. `git diff --cached -M --diff-filter=R --name-status | wc -l` →
**27** detected renames, of which **12** are `R100`, i.e. 0 insertions and 0
deletions (`… --numstat --diff-filter=R | awk '$1!=0 || $2!=0'` lists the other
15). Those 15 changed because the same commit also edited them: the class
banner on each archived audit and runbook, the register's repointed
`CHECKPOINT` link (SB1), the K→G crosswalk appended to `DOC-VS-CODE-AUDIT.md`
(D28), the D9 split's removed descriptive half, this ledger's own closing
sections, and D34's documented env vars. Two further moves —
`LOOP-PLAYBOOK` and `codebase-memory-mcp-setup` — fell below the similarity
threshold and appear in the delete list instead, which is why the removal count
there is 28 and the purge count is 26.

**Class system.** 83 files carry D1's two-line banner — `Class:` plus a
per-file `Summary:` written from reading the file, not a template — and **G12**
fails on a missing or invalid one. D28's rename landed in full: the whole
implemented family is `G`-prefixed (`k6a_…`→`g6a_…`, IDs and messages
included), the RECORD `DOC-VS-CODE-AUDIT.md` keeps its K1-K10 and gained a
crosswalk appendix instead — which is where the collision becomes visible:
its K9/K10 (tenant precedence, MCP enums) were **never implemented**, and the
script's `G9`/`G10` are different checks that had reused the numbers. New:
**G13** (doc paths cited from source resolve; no `:NNN` doc cites) and **G14**
(D32's hex ratchet over `git diff`, so 58 grandfathered files stay debt instead
of a permanently red guard). Widened: **G6f** (all of `DOCS/archive/**`, with
`Status: append-only` as the one named, checked exception for the register)
and **G10** (archive + `fixtures/bus-events/` in the corpus, plus the
lowercase-`docs/` check — 31 refs across TAXONOMY/SCHEMAS/DRIFT that are dead
on Linux and silently fine on macOS, all corrected).

**Also shipped:** AGENTS.md's minimal D30/D32/D33 edits (`.sdd/` blessed, the
five classes named, `DOCS/archive/` named, the hex clause softened to a
ratchet, the `diseno-mensajes.md` filename exception written down);
`LOOP-PLAYBOOK.md` translated to English (D33); E1 closed —
`envelope.md` §2.1 now documents BOTH `type` shapes with verified code
examples and forbids a third; D12's scoped cite conversion (7 E4 source files,
`multi-tenant/SKILL.md` 56 cites, `yz-ui/SKILL.md` 18, the three excluded
RECORDs untouched); D34's `.env.example` renames; O3's README→AGENTS.md
pointer; and D29's `scripts/sync-kb-fixtures.mjs`, which regenerates each
manifest's inline KB block FROM the `.md` (round-trip tested: perturb → `--check`
exits 1 naming the byte delta → sync → byte-identical restore).

**Deviations, all recorded in the ledger's closing section.** (1) E6's six
source-comment paths were fixed here although Group D bundles E6 elsewhere —
SB2 makes it the precondition for D3's move and D25's G13 fails on exactly
those paths, and a guard must be green when it lands. (2) One `log` string in
`purge-temporal.sh` printing a nonexistent `DOCS/RUNBOOK-TEMPORAL.md`, same
reason, overlapping E31. (3) **O1's premise is false for `GUION-DEMO.md`** — it
has no English twin, so "the English half is complete" does not hold; its
unique content (seeded state + re-seed recipe, the live-verified 2026-07-25
responses, the 60 s cache warning, housekeeping) was folded into the sample
README before the delete. (4) `demos/crm-support-telegram/README.md` is still
fully Spanish — an open rule-5 violation no D/O item covers; flagged, not
silently rewritten. (5) `manual-loops/**` was not rewritten, so 134 `cowork/…`
mentions survive there by design (76 of them `cowork/INDEX.md`, the rest the
purged and archived notes those closed loops cite — including the
`DESIGN-run-view` pair named by `run-view.md` and `workflow-step-events.md`);
**Correction (round 3 review):** the two `cowork/TRACEABILITY-audit.md` cites
in `.sdd/changes/processes-message-trace/{design.md,tasks.md}` were
mis-classed here as exempt "dated change records" under ground rule 2 — that
change has no `archive.md` and its `tasks.md` is still mostly unchecked, so
it is a LIVE planning artifact, not a frozen RECORD. Both cites were repointed
to `DOCS/archive/audits/TRACEABILITY-audit.md` (round 3), and
`DOCS-TRUTH-LEDGER.md`'s "Gate results at close" was updated in the same
round to record G6b's actual pass (see the entry above). Every live surface
is now repointed and `DOCS/archive/INDEX.md` carries a forwarding table.

Gates: **G0 green, all 16 guards.** Full-repo link sweep — 236 relative `.md`
links over 249 files (corrected 2026-08-05 — an earlier "330" figure in this
paragraph was stale from before this round's fixes and never reconciled with
the ledger's count; independently re-verified at 234-236 depending on regex
strictness), plus a string sweep over non-markdown files for every path this
task moved (SB8). **Three dangling refs were introduced by this
task's own moves, and are fixed in this same change**: `.gitignore`'s `.claude`
comment still pointed at `cowork/LOOP-PLAYBOOK.md` (now
`DOCS/guides/LOOP-PLAYBOOK.md`), and the archived `DESIGN-run-view.md` /
`.html` pair each still cited its own sibling under the pre-move `cowork/`
path (now `DOCS/archive/DESIGN-run-view.{md,html}`). None of the three is a
markdown relative link — one is a shell comment, one is HTML body text, one is
a backticked path — which is why G10 could not see them and only the string
sweep caught them. Seven further hits are pre-existing at HEAD and left
untouched: six are false positives (the `@Matches` regex in
`tenant-service/README.md`, the `{NNNN-title.md}` placeholders and the
`0003-…` example cross-links inside the ADR skill), and one is a genuinely
dangling pre-existing link — `../../design.md`, cited by
`.sdd/changes/traceability-channel-ingress-causal/archive.md`.
Affected suites green (api-gateway 13, agent-memory 33, audit 5,
`packages/shared` 373, `sdk` 471); `bash -n` clean on five scripts.
**G6b NOT RUN — the dev cluster is down** (`connection refused` on
127.0.0.1:26443, inside and outside the sandbox). T10's Accept asks for the
cluster e2e as the final integration proof; it remains genuinely unsatisfied
and must be run before this work is called closed.

**G6b — closed 2026-08-05.** Christian reset the cluster from scratch and
re-ran `scripts/e2e/http-workflow.sh` against it. Two environment fixtures
were stale from the fresh reset (unrelated to T10/E9/E2's own diffs, verified
before touching anything): (a) the pokeapi connector adapter id — re-seeded
via `POST /api/connectors` with `integrations/http/http-connectors/connectors/
pokeapi.json`; (b) the `sample-echo` hosted service the `probeService` action
targets — provisioned declaratively via a minimal `LibraryManifest`
(`services:` only, `ealen/echo-server:latest`, port 8080, matching
`integrations/http/hosted-services-api/manifest.yaml`'s already-audited
values) applied with `yoizen manifests apply`, not an imperative API call.
Both `E2E_ENDPOINT_ADAPTER_ID` and `E2E_SERVICE_CALL_SERVICE_ID` updated
accordingly. Full 17-stage suite green, exit 0, reproduced twice. **T10's
Accept is now fully satisfied — G0, G1, G6b all green.**
