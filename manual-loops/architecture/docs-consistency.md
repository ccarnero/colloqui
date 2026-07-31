# SPEC — Docs consistency: verify every document against code, fix it, and leave a guard behind

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/architecture/`.
> ABSORBS: `manual-loops/architecture/docs-consolidation.md` (L1, retired
> unrun 2026-07-30 by user decision — its full queue lives on as T01-T05 here).
> Depends on: `manual-loops/architecture/phase0-rules-inventory.md` and
> AGENTS.md (shipped 2026-07-29).
> Origin: user decisions 2026-07-30 (Cowork session).
> Engram topic: 'architecture/docs-consistency'.

## Goal

Every document in the repo tells the truth about the code — and every CLASS
of drift found gets an executable guard in `scripts/checks/doc-code-guards.sh`
so it cannot silently return. At the end: one truthful README per component,
one ADR channel, and a G0 that is strictly harder to pass than today's.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-30) Audit + guards, in one loop: a fixed drift that leaves no
   check behind is only half-fixed. Per CLASS of drift, not per instance.
2. (2026-07-30) This loop ABSORBS docs-consolidation (L1): consolidation
   tasks run first (T01-T05), validation + guard tasks after. L1's decisions
   carry over: absorb-then-delete per-service AGENTS.md with verified-only
   content; README bar = purpose, verified architecture claims (file:line),
   contracts, env vars incl. DB_ENGINE where `resolveStorageEngine()` is used.
3. A new guard lands in the SAME task as the fix that makes it green — a red
   guard never commits.
4. Scope = READMEs (root, services, packages), DOCS/**, SCHEMAS.md,
   TAXONOMY.md. NOT in scope: manual-loops/ SPECs and cowork/ (historical
   records — validating them would be rewriting history).
5. (2026-07-30) Code-first documentation: DESCRIPTIVE docs (READMEs,
   inventories, as-built contracts) are derived FROM the code — the code
   decides, always. PRESCRIPTIVE docs (envelope spec, security MUSTs,
   TAXONOMY — recorded design decisions the code must obey) are NOT
   rewritten from code: where code diverges from them, the CODE is the bug
   (recorded as a follow-up finding, fixed in its own loop). When doc ≠
   code, the loop's first question is: does this doc describe or prescribe?

## Prior art (validated 2026-07-30 — REUSE, do not duplicate)

The engine does not forward this section — repeat citations inside tasks.

- Guard style to extend: `scripts/checks/doc-code-guards.sh` (K6a service
  inventory :42-74, K6c ROW_FILES case-statement :96-149, K7 census +
  allowlist :250-370 — bash 3.2 compatible, fail() accumulator pattern).
- Phase 0 findings: `manual-loops/architecture/phase0-rules-inventory.md`
  (C7 lying READMEs, C9 coverage, C2 executed kill list).
- Verified-good README shapes: `services/connector-runtime/README.md`,
  `services/workflow-service/README.md`.
- `packages/shared/README.md` (293 lines, renamed 2026-07-29 from its old
  CLAUDE.md, tracked since commit 09712da1) — verify, do not rewrite.
- Doc-side envelope fixes belong here ONLY when the DOC is wrong (e.g.
  DRIFT.md item 2: headers live at `data.headers`, envelope.md §4.1 claims
  `transport.headers`). CODE-side envelope drift stays with the future
  envelope-drift loop.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Docs and `scripts/checks/` only: NO service source changes. Code bugs found
  during verification are recorded in Progress as follow-ups, never fixed here.
- Every claim written into a doc carries a file:line citation or a runnable
  command; unverified claims are dropped, not softened — automatic reviewer
  rejection.
- New guards follow the existing script's conventions (case statements, no
  bash-4 features, fail() accumulator, one clear message per failure).
- G0 must be green at every commit INCLUDING the new checks added so far
  (decision 3).
- English everywhere.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards, INCLUDING checks added by earlier tasks of this loop
./scripts/checks/doc-code-guards.sh
```

Gate rules (self-contained): docs-only loop; per-task Accepts carry the
specific greps. G0 grows as the loop advances — that is the point.

---

## Task queue

### T01 — Fix the three lying READMEs + first counting guard (K9)

- `services/auth-service/README.md`: replace the shared-table
  `tenant_users(tenant_id, ...)` depiction with the real per-tenant-DB model
  (`packages/shared/src/tenant-auth-schema.ts:34-44`: no `tenant_id` column,
  `role_id` FK, `UNIQUE(email)`); document `DB_ENGINE`.
- `services/cache-service/README.md`: drop the "no shared package dependency"
  claim (`cache.controller.ts:14` imports from `@yoizen/shared`).
- `services/tracking-ingester-service/README.md`: golden row count 72 → the
  real count.
- **K9 (numeric-claims guard)**: the golden row count STATED in the ingester
  README must equal the data-row count of `golden/labeled.tsv` (and the
  assertion in `test/classify.golden.spec.ts`). Class: numbers quoted in docs
  drift from generated reality.

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -c "tenant_id" services/auth-service/README.md | grep -x 0
grep -n "K9" scripts/checks/doc-code-guards.sh
```

### T02 — READMEs for the five service gaps (absorb AGENTS.md where present)

- `agent-admin-service`, `channel-service`, `usage-aggregator-service`:
  absorb their `AGENTS.md` (verify every claim first — decision 2), write the
  README to the bar, DELETE the AGENTS.md.
- `agent-memory-service`, `ai-agent-gateway`: write READMEs from code.

**Accept** (corrected 2026-07-30: 13 AGENTS.md existed at run time, not 14 —
deleting the three named lands on 10; and BSD `wc -l` pads with spaces, so
`grep -x N` can never match without `tr -d ' '`. Intent unchanged.)
```
ls services/agent-admin-service/README.md services/agent-memory-service/README.md services/ai-agent-gateway/README.md services/channel-service/README.md services/usage-aggregator-service/README.md
find services -maxdepth 2 -name "AGENTS.md" | wc -l | tr -d ' ' | grep -x 10
```

### T03 — Absorb + delete the remaining per-service AGENTS.md

- For each service with both README and AGENTS.md: merge verified-only
  content into the README, delete the AGENTS.md. Conflicts (e.g.
  audit-service AGENTS.md says Mongo, README says Postgres): the CODE
  decides; record each adjudication in Progress.
- **K6a extension**: after this task, extend K6a (or add K6f-style check)
  to FAIL on any `services/*/AGENTS.md` or `packages/*/AGENTS.md` existing at
  all — the class "per-component agent files resurrect" gets a guard.

**Accept** (corrected 2026-07-30: `packages/shared/AGENTS.md` is absorbed in
T04 by explicit instruction there, so T03's zero-count covers services only;
the resurrection guard covers `services/*` in T03 and extends to `packages/*`
in T04 — a guard must be green when it lands (decision 3). BSD `wc` padding
fixed with `tr -d ' '`.)
```
./scripts/checks/doc-code-guards.sh
find services -maxdepth 2 -name "AGENTS.md" | wc -l | tr -d ' ' | grep -x 0
```

### T04 — Package READMEs + storage-engine guard (K11)

- Write READMEs for `packages/angular-shared`, `packages/database`,
  `packages/observability`, `packages/testing` (for database: document
  `MultiTenantConsumerManager`/`ensureDurableConsumer` + `DEFAULT_ACK_WAIT_MS`
  semantics, citing the K7 census). Verify `packages/shared/README.md`
  claims; fix drift. Delete `packages/shared/AGENTS.md` after absorption.
- **K11 (storage-engine documentation guard)**: every service whose source
  calls `resolveStorageEngine()` must mention `DB_ENGINE` (or
  `STORAGE_ENGINE`) in its README. Class: undocumented dual-backend support
  (11 services used it, 2 documented it — phase0 C9).

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "K11" scripts/checks/doc-code-guards.sh
ls packages/angular-shared/README.md packages/database/README.md packages/observability/README.md packages/testing/README.md
```

### T05 — One ADR channel

- Move the three inline ADRs from `DOCS/guides/onboarding.md` (~571-611)
  into `DOCS/adr/` as dated records; onboarding keeps one-line pointers.
- `DOCS/architecture/decision-log.md`: state the D-number ↔ `DOCS/adr/`
  relationship; cross-link both ways.

**Accept**
```
grep -c "Architecture Decision Record" DOCS/guides/onboarding.md | grep -x 0
```

### T06 — Dead-link guard (K10) over the whole doc corpus

- **K10 (link-resolution guard)**: every RELATIVE `.md` link in root
  `README.md`, `DOCS/**/*.md`, and `services/*/README.md` resolves to an
  existing file. Class: docs linking deleted docs (the `code-review.md`
  dangling-row case, found 2026-07-29, repeats every time a doc dies).
- Fix every dead link the new check finds (fix or remove, with the choice
  noted in Progress).

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "K10" scripts/checks/doc-code-guards.sh
```

### T07 — Full-corpus verification sweep (report + doc-side fixes)

- Sweep `DOCS/messaging/*`, `DOCS/architecture/*`, `SCHEMAS.md`, `TAXONOMY.md`
  and the guides: verify load-bearing claims against code (sampling bar:
  every claim that names a file, field, constant, or count gets checked).
- Fix DOC-side errors in place (e.g. envelope.md §4.1 `transport.headers` →
  `data.headers`, cross-checked with DRIFT.md item 2 and
  `packages/shared/src/interfaces.ts`).
- CODE-side divergences (stage-1 type token, depth operator `>` vs `>=`,
  envelope-schema.json rewrite) are RECORDED as numbered findings for the
  future envelope-drift loop — not fixed here (constraint).
- Findings land in Progress as "**T07 findings (recorded <date>):**".

**Accept**
```
./scripts/checks/doc-code-guards.sh
grep -n "T07 findings" manual-loops/architecture/docs-consistency.md
grep -c "transport.headers" DOCS/messaging/envelope.md | grep -x 0
```

### T08 — Docs + index

- `DOCS/README.md`: state that per-component truth lives in READMEs, the
  constitution is `AGENTS.md`, and G0 now enforces K9/K10/K11 + the
  AGENTS.md-resurrection check.
- `cowork/INDEX.md` entry; Engram decisions + follow-up list (code bugs found
  in T07) under 'architecture/docs-consistency'.

**Accept**
```
grep -n "docs-consistency" cowork/INDEX.md
```

---

## Progress

- [x] T01 lying READMEs + K9 (landed as K9b — name taken)
- [x] T02 five service README gaps
- [x] T03 absorb remaining AGENTS.md + resurrection guard (K6g, services/*)
- [x] T04 package READMEs + K11 (K6g extended to packages/*)
- [x] T05 one ADR channel
- [x] T06 K10 dead-link guard + fixes
- [x] T07 full-corpus sweep + doc-side fixes (9 findings recorded)
- [x] T08 docs + index

**T01 follow-ups (recorded 2026-07-30, code bugs / doc drift found during
verification — NOT fixed in this loop):**

1. auth-service endpoint tables (README pre-rewrite and `AGENTS.md`) omit the
   whole `/auth/tenant-roles` controller
   (`services/auth-service/src/modules/tenant-roles/tenant-roles.controller.ts:18-61`).
   The AGENTS.md drift resolves when T03 absorbs and deletes that file.
2. CODE: `platform_users.role` defaults to `operator`
   (`src/providers/postgres.module.ts:16`) but `CreateUserDto` only accepts
   `admin` (`src/modules/user/user.dto.ts:9-11`) — the default is unreachable
   through the API. Follow-up for an auth-service loop.
3. `services/auth-service/AGENTS.md` still carries the old shared-table
   schema block (same lie class as the README fixed in T01) — T03 will
   adjudicate on absorption.
4. SPEC path correction: T01's task text cites
   `services/tracking-ingester-service/golden/labeled.tsv`; the dataset
   actually lives at repo-root `golden/labeled.tsv`
   (`test/classify.golden.spec.ts:7-14`). K9b guards the real path.
5. Guard numbering: the SPEC's "K9" name was already taken by
   `k9_di_type_imports` in the guard script; the numeric-claims guard landed
   as **K9b** (same family, documented in the script's numbering note).

**T02 adjudications (recorded 2026-07-30 — AGENTS.md vs code, code won):**

1. agent-admin-service AGENTS.md documented six `/admin/credentials` and five
   `/admin/channels` endpoints — neither module exists in `src/` (the
   `credentials` TABLE exists, `schema-initializer.ts:166`, with no HTTP
   surface; `channels` has neither controller nor DDL). Dropped.
2. agent-admin-service "NATS only publisher: No consumers" — false: durable
   consumers `ingestion-worker` and `skb-ingestion-worker` exist. Corrected.
3. agent-admin-service "Seed Data" section — fiction: no SeedService, nothing
   reads `data/agents/*.yaml` or `data/jobs.yaml` (only `data/templates.yaml`,
   `config.ts:56-58`). Dropped.
4. usage-aggregator-service AGENTS.md claimed per-tenant MongoDB + `MONGO_*`
   config — code defaults to Postgres/Timescale via `resolveStorageEngine()`
   (`config.ts:25-27`) and reads `TENANT_{POSTGRES,MONGO}_SHARED_USAGE_*`.
   Corrected.
5. channel-service AGENTS.md: thin but not wrong; expanded from code.

**T02 follow-ups (recorded 2026-07-30 — code bugs / dead artifacts, NOT
fixed in this loop):**

1. Orphaned files: `services/agent-admin-service/data/agents/*.yaml` and
   `data/jobs.yaml` — no code path reads them.
2. Dead config: usage-aggregator `config.ts:28-39` (`tenantServiceUrl`,
   `tenantDiscoveryIntervalMs`) has no reader.
3. `PLATFORM_SKILL_CHANGED` declared locally
   (`agent-admin-service/src/providers/nats.provider.ts:70`) instead of in
   `packages/shared/src/constants.ts` with its siblings.
   [2026-07-31: renamed `AGENT_ADMIN_SKILL_CHANGED`, now at `:79` — the
   relocation-to-shared half stays open as envelope-drift open question 2.]
4. agent-admin-service uses literal `process.env.SERVICE_MODE !== "worker"`
   (`ingestion-worker.service.ts:76`, `skb-ingestion-worker.service.ts:84`)
   where other services use `isWorkerMode()` from `@yoizen/observability`.
5. agent-admin SKB/KB tables carry a `tenant_id` column
   (`schema-initializer.ts:8`, `:382`) inside a per-tenant database —
   inconsistent with the "database is the boundary" rule.
6. ai-agent-gateway lifecycle publisher emits `state: "started"` which is not
   in the `YoizenClawExecutionState` union (pre-existing gap, code comment at
   `executions.service.ts:307-312`).

**T03 adjudications (recorded 2026-07-30 — AGENTS.md vs code, code won;
guard landed as K6g(no-service-agents-md), services/* only, packages/*
extension deferred to T04 by design):**

1. audit-service: both docs described a single `audit-writer` durable on an
   `EVENTS` stream with one `events` table — reality is FOUR consumers
   (`audit-events`, `channel-audit`, `execution-audit` on per-tenant
   `INGRESS-*` streams; `gateway-audit-writer` on `GATEWAY_AUDIT`) and four
   tables. Mongo-vs-Postgres conflict: `DB_ENGINE`-selected, Postgres default.
2. api-gateway: documented events module (`POST /api/events`,
   `GET /api/results/:id`, SSE) does not exist; `schedulers`/`adapters`
   modules gone; ten real modules were undocumented; `PLATFORM_PREFIXES`
   stale.
3. registry-service: Mongo-throughout claims → `DB_ENGINE`-selected,
   Postgres default; Knative max-scale 5 → 3.
4. proxy-service: `/health` actually probes tenant-service (degraded/
   unreachable states); hop-by-hop set has 4 entries; `PLATFORM_ENVIRONMENT`
   env row was fiction.
5. tenant-service: provisioning is ASYNC (202 + `tenant-provisioner` durable,
   ackWait 300s), not synchronous StatefulSet creation; `PATCH /tenants/:name`
   undocumented.
6. cache-service: Knative min-scale 0 → 1. connector-runtime: concurrency
   self-contradiction resolved to 400 (code). workflow-service: absorbed
   Activity Idempotency Contract + Mongo adapters + projector partitioning.
   auth-service: T01 README stayed baseline; absorbed tenant-roles routes,
   Argon2id params, seeders, Redis public-routes sync.

**T03 follow-ups (recorded 2026-07-30 — code bugs, NOT fixed here):**

1. CODE BUG: connector-admin OAuth2 dead path — DTO accepts `oauth2-client`
   (`adapters.dto.ts:39-45`) but both consumers switch on `oauth2`
   (`packages/shared/src/adapter-auth-headers.ts:38`,
   `packages/shared/src/adapter-client.ts:395`): such connectors send NO
   Authorization header. Documented in the README as a known mismatch.
2. proxy-service test scripts self-recurse (`package.json:9-10`).
3. api-gateway `bun run test` fails by construction (no `test/integration/`).
4. proxy-service, registry-service, tenant-service, auth-service declare
   `test:integration` with no matching directory.
5. Resurrection vector: eight gitignored `services/*/CLAUDE.md` files are
   stale copies of the deleted AGENTS.md (auto-loaded into agent context).
   Untracked → outside K6g's reach. Needs an explicit human decision.

**T04 adjudications (recorded 2026-07-30 — packages/shared README verified,
AGENTS.md absorbed+deleted; K6g extended to packages/*; K11 covers 10
services discovered from code, straggler agent-ai-service fixed):**

1. packages/shared README title was still `# CLAUDE.md — @yoizen/shared`
   (rename leftover). Fixed.
2. "All peer deps required" — false: `class-transformer`/`class-validator`
   are optional in `peerDependenciesMeta`, only `nats` required
   (`package.json:19-34`). `zod` was missing from the deps list.
3. "Barrel re-exports everything via wildcard" — false and harmful:
   `index.ts` is 79 explicit named exports, no `export *`. Recipes corrected.
4. Two dead doc links (`DOCS/03-NATS-JETSTREAM.md`,
   `DOCS/arquitectura/02-diseño-de-mensajes.md`) repointed to
   `DOCS/messaging/*`.
5. AGENTS.md fiction dropped: `WEBHOOK_MAX_RETRIES`/`WEBHOOK_RETRY_DELAYS`
   and the whole Event Interfaces table (pre-CloudEvents shapes, none exist).
6. AdapterClient cache TTLs were inverted in AGENTS.md (said TTL 300s/stale
   60s; code: soft 60s, hard 300s, negative 10s — `adapter-client.ts:20-27`).

**T04 follow-ups (recorded 2026-07-30 — code bugs, NOT fixed here):**

1. `packages/database/src/nats-durable-consumer.ts` JSDoc contradicts its
   constants: `@default 30_000` vs `DEFAULT_ACK_WAIT_MS = 60_000` (`:74` vs
   `:30`); `@default [1s,5s,30s,2m]` vs `[60s,120s,300s,600s]` (`:76` vs
   `:43-48`). History: stale 1s ack_wait caused duplicate Telegram sends.
2. `serviceMode()` swallows typos — `SERVICE_MODE=wokrer` silently resolves
   to `api` (`packages/observability/src/runtime-mode.ts:31-32`);
   `resolveStorageEngine` throws on invalid input, this does not.
3. `bootstrapSplitService` bypasses `resolveServiceName` for its logger name
   (`bootstrap-split-service.ts:46`) — `OTEL_SERVICE_NAME` override invisible
   in that log line.
4. `createMockMongoClient().db(name)` ignores its argument
   (`packages/testing/src/index.ts:112-114`) — cross-database isolation
   cannot be asserted in tests.
5. Resurrection vector (same class as T03 #5): gitignored
   `packages/shared/CURSOR.md` and `GEMINI.md` are stale AGENTS.md siblings,
   outside K6g's reach. Needs the same human decision.

**T05 follow-ups (recorded 2026-07-30 — ADR content vs code, recorded in the
ADRs' "Later observations", decision bodies kept verbatim per decision 5):**

1. `DOCS/adr/connector-runtime-separation.md`: rationale cites "200 parallel"
   activities; code is 400 (`services/connector-runtime/src/worker.ts:35`).
   Decision unaffected.
2. Same ADR: the cited KEDA scaling mechanism no longer exists (guard K6b
   fails on any live ScaledObject); independent scalability holds via replica
   count. `onboarding.md:565-566` still describes KEDA as the future
   production path — consistent with the ADR, equally aspirational.

**T06 record (recorded 2026-07-30):** K10 scans root README, DOCS/**,
services/*/README.md AND packages/*/README.md (deliberate same-class
addition, zero links there today). One in-scope dead link found and FIXED:
`services/workflow-service/README.md:925` (path one level short + stale
anchor). Fenced blocks and inline code spans skipped; anchors resolved to
the file part only.

**T07 findings (recorded 2026-07-30):**

1. Stage-2 `transport.headers` is an undeclared field. `createChannelEnvelope`
   writes the webhook header allowlist into `transport`
   (`services/channel-service/src/domain/envelope.factory.ts:102-107`) but
   `EventTransport` (`packages/shared/src/interfaces.ts:13-18`) declares only
   `method`/`protocol`/`agent_id?`/`depth?` — the conditional spread bypasses
   excess-property checking. Stage 1 correctly uses `data.headers`
   (`webhook.interfaces.ts:18`). Same data, two placements, neither
   type-checked at stage 2. Extends DRIFT.md item 2. Doc fixed; code open.
2. Stage-1 `type` token violates the prescriptive format:
   `webhook-ingress-publisher.service.ts:117` hardcodes
   `io.yoizen.messaging.webhook.received.v1` for every channel — no
   `<channel>` token, `received` vs `webhook_received`
   (`envelope.md:77` prescribes the format). Code is the bug (decision 5).
3. Depth enforcement `>=` vs `>`:
   `agent-ai-service/src/modules/depth-tracker/depth-tracker.service.ts:36`
   rejects at `>=` against a local `DEFAULT_MAX_DEPTH = 5`, ignoring
   `MAX_DEPTH_BY_CATEGORY`; shared lib uses strict `>`
   (`packages/shared/src/envelope.utils.ts:172,298`).
4. `skills/envelope-messages/assets/envelope-schema.json` needs a rewrite:
   (a) `channel` enum omits `http`; (b) `correlation_id` description wrong
   (`envelope.utils.ts:332` assigns fresh UUID); (c) no
   `WebhookIngressEnvelope`; (d) `required` lists `accountid`
   unconditionally, rejecting every real stage-1 envelope. DRIFT items
   3/4/6/7.
5. `transport-topology.ts:15,20,26` (admin-console) names durable
   `channel-events-audit`; the real durable is `channel-audit`
   (`channel-audit.service.ts:49`); stale name also in a comment at
   `tracking-ingester-service/src/lib/consumed-by.ts:29-30`. Docs corrected;
   the hand-maintained registry is the remaining bug.
6. agent-memory-service subject constants are service-local
   (`nats.provider.ts:62-68` instead of `packages/shared/src/constants.ts`)
   and its envelope `domain: "automation"` disagrees with the subject's
   `agent-memory` domain token. DRIFT item 9.
7. `ensureDurableConsumer` JSDoc contradicts its constants
   (`nats-durable-consumer.ts:74,76` vs `:30,:43-48`) — carried from T04
   follow-up 1; high-risk given the file's duplicate-sends history.
8. `TENANT_TIER_LIMITS` only partially wired: consumed via
   `buildTenantStreamConfig` by two services; the primary
   `ensureTenantIngressStream` path (`packages/database/src/nats-provider.ts:238-239`)
   applies flat limits and ignores tier. Tier has no effect on the streams
   carrying traffic.
9. Two INGRESS stream-name builders disagree on casing.
   `getTenantStreamName` upper-cases the tenant id —
   `INGRESS-${tenantId.toUpperCase()}`
   (`packages/shared/src/tenant-stream.constants.ts:58-59`) — while
   `buildIngressStreamName` interpolates it verbatim — `INGRESS-${tenant}`
   (`packages/shared/src/channel.utils.ts:29-30`). Both are exported from
   `@yoizen/shared`, so a caller's choice of helper silently decides whether
   it binds `INGRESS-ACME` or `INGRESS-acme`; for any non-lowercase-invariant
   tenant id the two produce different streams. Same class as the DLQ/PAYLOAD
   asymmetry documented in `DOCS/architecture/multi-tenancy.md` §1, but
   worse: there the two names are genuinely different resources, whereas here
   two helpers claim to build the SAME name. Adjacent to finding 8. Docs
   record the divergence; the code-side reconciliation is open.

**T07 findings — code-fix log (appended 2026-07-31, envelope-drift loop):**
The findings above are left verbatim; this log records which were closed in
code and where. Loop SPEC: `manual-loops/messaging/envelope-drift.md`.

1. FIXED — envelope-drift T06 (`ab36a970`). The allowlist moved to
   `data.headers`, typed via the new `IChannelEventData`
   (`packages/shared/src/channel.interfaces.ts`); `transport` is a plain
   literal again, so the excess-property check is active (verified: a probe
   key now fails `tsc` with TS2353). Wire impact nil — the `webhookHeaders`
   option had no caller, so `transport.headers` never reached the wire.
2. FIXED — envelope-drift T05 (`519594b8`). Stage 1 now builds
   `io.yoizen.messaging.<channel>.webhook.webhook_received.v1` via
   `services/api-gateway/src/modules/channels/webhook-ingress-type.ts`.
   Historical envelopes keep the old token and stay classifiable.
3. FIXED — envelope-drift T02 (`e0c2e42f`). `DepthTrackerService` enforces a
   strict `>` against the shared `MAX_DEPTH_BY_CATEGORY`, category
   defaulting to `internal_service`; the local `DEFAULT_MAX_DEPTH` is gone.
4. FIXED — envelope-drift T04 (`910f55fc`). All four defects corrected and
   the schema is now pinned against typed fixtures by
   `packages/shared/test/unit/envelope-schema.spec.ts`.
5. FIXED — envelope-drift T03 (`5db90ac5`). The registry names `channel-audit`
   in all three rows; the `consumed-by.ts` comment and the trace README
   followed. The other two registry durables were swept and were correct.
6. FIXED — envelope-drift T08 (`1f6fc4cd`) + producer half fixed 2026-07-31
   (envelope-drift follow-up). T08 moved the constants to
   `packages/shared/src/constants.ts:145-153` and aligned the envelope
   `domain`; the follow-up aligned `producer`, which reported
   `agent-admin-service` against a subject whose producer token is
   `agent-memory-service`. A human-authorised investigation established the
   root cause for both: `git log --follow` shows the publisher was renamed out
   of the admin service at 61% similarity (`R061` in `e9e3a94b`), where those
   constants were correct, and the extraction rewrote the subject and
   `transport.agent_id` but not the envelope identity fields. The consumer
   sweep was clean — nothing branches on `envelope.producer` (the classifier
   matches subject tokens, `classify.ts:258`; the `producer` column is
   projected and displayed, never filtered).
7. FIXED — envelope-drift T01 (`971ad0c3`). The `@default` tags match the
   constants, and both are pinned by a constant test.
8. ADJUDICATED 2026-07-31 (envelope-drift post-loop item 6, human-decided) —
   NOT a drift defect. The finding described the code accurately, and
   `service-bus.md` already labelled tiers "partially wired / objective design
   (pending)", so no doc lied. Investigation established WHY it cannot simply
   be wired: no tenant record carries a `TenantTier` (the tenant `tier` field is
   the unrelated `shared|dedicated` DATABASE tier), the 10
   `ensureTenantIngressStream` call sites have no tier in scope, and the dev
   JetStream account (2 GiB) cannot satisfy `pro` (5 GiB) or `enterprise`
   (20 GiB + 3 replicas on single-node NATS). The direction is now formalized as
   `DOCS/v_next/tenant-messaging-tiers.md` with 5 numbered prerequisites, under
   a new FUTURE document class (`DOCS/v_next/README.md`).

   The investigation DID surface a real latent bug, now fixed:
   `INGRESS-<TENANT>` had TWO creators with different configs — the shared
   `ensureTenantIngressStream` (flat: 256 MiB) and agent-admin/agent-memory via
   `buildTenantStreamConfig(tenantId, "free")` (1 GiB + a 1 MiB message cap) —
   so a new tenant's stream limits depended on which service published first.
   Both services now delegate to the shared helper, which is the single creator;
   their capacity pre-flight is preserved through its opt-in `checkCapacity`.
9. FIXED — envelope-drift T07 (`9b6dd4e3`). `buildIngressStreamName` deleted;
   `getTenantStreamName` is the only ingress-name builder. It had no callers,
   so nothing was binding `INGRESS-acme`.

**T06 follow-ups (recorded 2026-07-30):** seven dead NON-`.md` targets in
`DOCS/runbooks/archive/{temporal-ha-migration,temporal-visibility-split}.md`
(infrastructure paths that died with the dev-mode collapse `be62ae89`).
Left as-is — historical records. OPEN QUESTION for a future guard: exempt
archived runbooks from any non-`.md` link guard, or annotate dead paths in
place as "removed in <commit>".

> CORRECTION (2026-07-31): the T06 diagnosis above was wrong. All seven
> targets EXIST (`infrastructure/base/temporal/`, the postgres base files,
> `bootstrap-orbstack-osx.sh` — none died with `be62ae89`). The links were
> dead only because their relative depth was short by one level (`../../`
> from `DOCS/runbooks/archive/` reaches `DOCS/`, not the repo root). Fixed
> 2026-07-31 by correcting the 7 links to `../../../`; no annotation
> needed, no history rewritten. The open question dissolves: a future
> non-`.md` link guard needs NO archive exemption — these files now pass.

## Out of scope (explicit)

- Service source changes of any kind (follow-ups only).
- CODE-side envelope drift (future envelope-drift loop owns it).
- manual-loops/ SPECs and cowork/ session records (decision 4 — history).
- The tenancy-model decision (C6) — separate human decision.
- Guarding prose quality/style — guards check FACTS only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Claim adjudications where code contradicts BOTH docs are reported before
  the task commits.
- Any NEW guard class beyond K9/K10/K11/resurrection needs human sign-off
  (a guard is forever — it should be born deliberately).
