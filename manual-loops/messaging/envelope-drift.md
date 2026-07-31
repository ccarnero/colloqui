# SPEC — Envelope drift: the code obeys the envelope spec again

> Task queue for the `/manual-loop` command. One task at a time, gated by
> tests and dual review. Queues for this loop live in `manual-loops/messaging/`.
> Depends on: `manual-loops/architecture/docs-consistency.md` (shipped 8/8,
> 2026-07-30) — its T07 findings 1-9 are this loop's queue, each carrying
> file:line evidence recorded in that SPEC's Progress section.
> Origin: docs-consistency T07 (2026-07-30); authored 2026-07-31.
> Engram topic: 'messaging/envelope-drift'.
> HUMAN APPROVAL REQUIRED BEFORE THIS SPEC EVER RUNS.

## Goal

`DOCS/messaging/envelope.md` is PRESCRIPTIVE (docs-consistency decision 5):
where the code diverges from it, the code is the bug. This loop fixes the
nine recorded divergences so every envelope on the bus matches the spec —
type token, header placement, depth semantics, schema asset, naming
registries — and leaves regression tests behind for each (house rule:
every bug fixed gets a test that pins the fix).

## User decisions (human boundary — approve with the SPEC; re-open only by
## a new decision round)

1. (PROPOSED) Stage-2 headers move to `data.headers` (the spec's placement)
   in a CLEAN CUTOVER — no dual-emission window. Evidence the blast radius
   is nil: zero code reads `transport.headers` today (`rg 'transport\.headers'
   services packages sdk` → empty, 2026-07-31); the only writer is
   `envelope.factory.ts:102-107`. Historical stored envelopes keep the old
   shape (30-day scrub applies); the payload viewer renders raw JSON either
   way.
2. (PROPOSED) Stage-1 `type` adopts the prescriptive format
   `io.yoizen.<domain>.<channel>.<provider>.<kind>.v1` (envelope.md:77).
   The tracking-ingester classification that matches the OLD literal type
   is updated in the SAME task, goldens extended — never weakened.
3. (PROPOSED) INGRESS stream naming: `getTenantStreamName` (upper-cased,
   matches every live stream — `INGRESS-ACME` verified in cluster) is the
   ONE canonical builder. `buildIngressStreamName` (verbatim interpolation,
   ZERO callers outside packages/shared itself) is removed, not deprecated.
4. (PROPOSED) `TENANT_TIER_LIMITS` wiring (finding 8) is OUT of this loop —
   it is a capacity-policy feature, not spec drift. Recorded as a standing
   follow-up; this loop only fixes the docs' description if it drifts.
5. Depth semantics: the shared library (`envelope.utils.ts` strict `>`,
   per-category `MAX_DEPTH_BY_CATEGORY`) is canonical; agent-ai-service's
   local tracker conforms to it (envelope.md §6.3 documents the shared
   behavior as the spec).

## Prior art (validated 2026-07-31 — REUSE, do not duplicate)

The engine does not forward this section — repeat citations inside tasks.

- The nine findings with evidence: `manual-loops/architecture/docs-consistency.md`
  Progress → "T07 findings (recorded 2026-07-30)".
- Envelope spec: `DOCS/messaging/envelope.md` (§2.1 type format :77, §4.1
  placement, §6.3 depth). Fixed doc-side 2026-07-30; this loop is code-side.
- Emission sites: stage 1 `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:117`;
  stage 2 `services/channel-service/src/domain/envelope.factory.ts:102-107`.
- Shared envelope machinery: `packages/shared/src/envelope.utils.ts` (depth
  :168-172, :294-298), `interfaces.ts:13-18` (`EventTransport`),
  `webhook.interfaces.ts:18` (`data.headers`).
- Ingester classification + goldens: `services/tracking-ingester-service/src/lib/classify.ts`,
  `golden/labeled.tsv` (92 rows, pinned by guard K9b), TAXONOMY.md.
- Naming: `packages/shared/src/tenant-stream.constants.ts:44-45`
  (`getTenantStreamName`), `packages/shared/src/channel.utils.ts:29-30`
  (`buildIngressStreamName`, no external callers).
- Consumer runner: `packages/database/src/nats-durable-consumer.ts`
  (constants :30, :43-48; stale JSDoc :74, :76).
- Console durable registry: `services/admin-console/src/app/features/processes/trace/domain/transport-topology.ts:15,20,26`;
  comment drift at `services/tracking-ingester-service/src/lib/consumed-by.ts:29-30`.
- Schema asset: `skills/envelope-messages/assets/envelope-schema.json`
  (4 defects: `http` missing from channel enum, wrong `correlation_id`
  description vs `envelope.utils.ts:332`, no `WebhookIngressEnvelope`,
  unconditional `accountid` in `required`).
- E2E to lean on: `scripts/e2e/http-workflow.sh` (webhook → workflow →
  tracking chain, exercises stage 1+2 end to end).

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer
  rejection. Goldens extended, never weakened (K9b pins the row count —
  update README + spec assertion + tsv together).
- EVERY fix lands with a regression test that fails on the old behavior.
- Wire-shape or type-string changes update, in the SAME task: the ingester
  classification (if it matches on the changed value), TAXONOMY.md,
  SCHEMAS.md, and any doc the docs-consistency loop corrected — G0's K9b/
  K10/K11 must stay green.
- Fire-and-forget and causal-chain contracts untouched (AGENTS.md).
- Verbose logging on new code paths; nothing fails silently.
- Touched services only: api-gateway, channel-service, agent-ai-service,
  tracking-ingester-service, admin-console, packages/shared,
  packages/database, skills/envelope-messages. Anything else → STOP.
- Repo style wins per service; English everywhere.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (every attempt; includes K9b/K10/K11)
./scripts/checks/doc-code-guards.sh
# G1 — packages/shared tests + typecheck (every attempt)
cd packages/shared && bun test && bunx tsc -p tsconfig.json --noEmit
# G2 — packages/database tests (from T01 onward)
cd packages/database && bun test
# G3 — tracking-ingester tests + typecheck (from T05 onward)
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
# G4 — per-task touched-service suites (the task's Accept names them)
# G6b — COMMIT GATE (once per task, built images for the services the task
#       touched, then the cluster e2e)
./rebuild-redeploy.sh <touched-svc> dev && ./scripts/e2e/http-workflow.sh
```

Gate rules (self-contained): G6b runs for every task that changes service
code (doc/skill-only tasks skip it, stated per task); a diff touching
packages/shared or packages/database redeploys every dependent service the
e2e exercises (api-gateway, channel-service, workflow-service,
tracking-ingester-service at minimum). Commits only on built image.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` green once before
T01 (last green 2026-07-31, 7/7); if it fails, record the skip in Progress
and rely on G6b.

---

## Task queue

### T01 — Consumer JSDoc tells the truth (finding 7; trivial, zero behavior)

- `packages/database/src/nats-durable-consumer.ts`: fix `@default 30_000`
  (:74) → the real `DEFAULT_ACK_WAIT_MS = 60_000` (:30) and
  `@default [1s, 5s, 30s, 2m]` (:76) → the real
  `DEFAULT_BACKOFF_MS = [60s, 120s, 300s, 600s]` (:43-48). Comment-only.
- Regression pin: a test asserting the constants' values (so the next drift
  is a red test, not a stale comment).

**Accept**
```
cd packages/database && bun test
rg -n "@default 30_000|@default \[1s" packages/database/src/nats-durable-consumer.ts | wc -l | tr -d ' ' | grep -x 0
```
(No service behavior change — G6b skipped, stated here.)

### T02 — Depth enforcement conforms to the shared spec (finding 3)

- `services/agent-ai-service/src/modules/depth-tracker/depth-tracker.service.ts:36`
  drops its local `DEFAULT_MAX_DEPTH = 5` + `>=` and enforces via the shared
  semantics: strict `>` against `MAX_DEPTH_BY_CATEGORY`
  (`packages/shared/src/envelope.utils.ts:172,298` is the pattern; reuse the
  shared constants/helpers — do NOT copy values).
- Unit tests: platform_agent rejects at depth 4 (limit 3, strict >),
  thirdparty_agent at 3 (limit 2), boundary cases both sides, and the old
  `>=`-at-5 behavior is provably gone.

**Accept**
```
cd services/agent-ai-service && bun test && bunx tsc -p tsconfig.json --noEmit
rg -n "DEFAULT_MAX_DEPTH" services/agent-ai-service/src | wc -l | tr -d ' ' | grep -x 0
```
G6b: rebuild agent-ai-service.

### T03 — One durable-name registry, no stale names (finding 5)

- `services/admin-console/src/app/features/processes/trace/domain/transport-topology.ts`:
  `channel-events-audit` → the real `channel-audit`
  (`services/audit-service/src/modules/channel-audit/channel-audit.service.ts:49`).
  Sweep the file's other durable names against their declaring services.
- Fix the stale comment at
  `services/tracking-ingester-service/src/lib/consumed-by.ts:29-30`.
- Component/unit tests updated; TAXONOMY.md §5's annotation gets a
  "code fixed <date>" note (doc corrected 2026-07-30 already points here).

**Accept**
```
cd services/admin-console && pnpm test
rg -n "channel-events-audit" services | wc -l | tr -d ' ' | grep -x 0
```
G6b: rebuild admin-console (and tracking-ingester if its comment edit is
accompanied by any code change — otherwise state comment-only).

### T04 — envelope-schema.json rewritten against the real types (finding 4)

- `skills/envelope-messages/assets/envelope-schema.json`: (a) `channel`
  enum gains `http` (`packages/shared/src/channel.interfaces.ts:3`); (b)
  `correlation_id` description matches `envelope.utils.ts:332` (fresh
  `randomUUID()` when omitted); (c) model `WebhookIngressEnvelope` (stage-1
  shape, `webhook.interfaces.ts`); (d) `required` no longer lists
  `accountid` unconditionally. Keep the "not a validation authority"
  `$comment` unless the human later promotes it.
- Validate the schema against REAL captured envelopes (the e2e produces
  them; a small script or test fixture proves stage-1 and stage-2 samples
  pass).
- Skill SKILL.md updated if it describes the old schema.

**Accept**
```
python3 -c "import json;json.load(open('skills/envelope-messages/assets/envelope-schema.json'))"
rg -n '"http"' skills/envelope-messages/assets/envelope-schema.json
```
(Docs/skill-only — G6b skipped, stated here.)

### T05 — Stage-1 type token obeys the format (finding 2; decision 2)

- `services/api-gateway/src/modules/channels/webhook-ingress-publisher.service.ts:117`:
  emit `io.yoizen.messaging.<channel>.<provider>.webhook_received.v1` per
  envelope.md:77 (§10.1 example) instead of the hardcoded
  `io.yoizen.messaging.webhook.received.v1`. Channel/provider come from the
  request context the publisher already has — verify and cite.
- SAME task: tracking-ingester classification that matches the old literal
  (find it in `classify.ts`) updated to the new pattern; goldens EXTENDED
  with rows for the new type (old rows stay — historical envelopes exist);
  TAXONOMY.md + SCHEMAS.md updated; K9b row count updated everywhere it is
  pinned (README prose, spec test name, assertion, tsv).
- Regression tests: publisher emits per-channel types; ingester classifies
  both old (historical) and new tokens.

**Accept**
```
cd services/api-gateway && bun test
cd services/tracking-ingester-service && bun test
rg -n "webhook.received.v1" services/api-gateway/src | wc -l | tr -d ' ' | grep -x 0
```
G6b: rebuild api-gateway + tracking-ingester-service.

### T06 — Stage-2 headers land at data.headers (finding 1; decision 1)

- `services/channel-service/src/domain/envelope.factory.ts:102-107`: the
  webhook header allowlist moves from the untyped `transport` spread to
  `data.headers` (typed: extend the stage-2 data interface the factory
  builds — mirror `webhook.interfaces.ts:18`). The conditional-spread hole
  in `EventTransport` is closed (no undeclared fields remain — add a
  compile-level regression: a test that fails if `transport` gains unknown
  keys again).
- CLEAN cutover per decision 1 (zero readers verified 2026-07-31).
- envelope.md §10.2's "current stage-2 divergence" annotation (added
  2026-07-30) is REMOVED in the same task — the divergence no longer
  exists; §4.1 stands as written. DRIFT.md item 2 gets a dated
  "code fixed" note IF that file is a living registry (verify its
  contract; if historical, leave it).
- Regression tests: factory output carries `data.headers`, `transport` has
  exactly the four declared fields, redaction/allowlist behavior unchanged.

**Accept**
```
cd services/channel-service && bun test && bunx tsc -p tsconfig.json --noEmit
rg -n "headers" services/channel-service/src/domain/envelope.factory.ts
```
G6b: rebuild channel-service.

### T07 — One INGRESS builder (finding 9; decision 3)

- Remove `buildIngressStreamName` from `packages/shared/src/channel.utils.ts:29-30`
  and its export (`index.ts`); every stream-name construction goes through
  `getTenantStreamName` (`tenant-stream.constants.ts:44-45`). Verified
  2026-07-31: zero callers outside packages/shared — confirm again at
  implementation time; if a caller appeared since, migrate it in the same
  task.
- Regression test: the shared package exposes exactly ONE ingress-name
  builder and it upper-cases (pin with a doc-locks-style test, precedent
  `packages/shared/src/__tests__/doc-locks.constants.test.ts`).
- `DOCS/architecture/multi-tenancy.md`'s builder table (4 rows, corrected
  2026-07-30) updated to 3 rows + a dated note.

**Accept**
```
cd packages/shared && bun test && bunx tsc -p tsconfig.json --noEmit
rg -n "buildIngressStreamName" services packages sdk | wc -l | tr -d ' ' | grep -x 0
```
G6b: packages/shared changed → rebuild api-gateway, channel-service,
workflow-service, tracking-ingester-service; e2e must stay green.

### T08 — agent-memory constants go shared + domain adjudication (finding 6)

- Move `AGENT_MEMORY_SUBJECT_PREFIX` + its four subject constants from
  `services/agent-memory-service/src/providers/nats.provider.ts:62-68` to
  `packages/shared/src/constants.ts` beside their siblings (:93-107
  precedent); service imports them.
- The `domain: "automation"` vs subject-token `agent-memory` mismatch: fix
  the ENVELOPE to match its subject (the subject grammar is the spec,
  AGENTS.md:64-65) — set the envelope domain from the same constant the
  subject uses. If implementation reveals consumers filtering on the OLD
  domain value, STOP and report (human boundary) instead of breaking them.
- Regression tests: constants exported from shared; envelope domain ==
  subject domain token.

**Accept**
```
cd packages/shared && bun test
cd services/agent-memory-service && bun test
rg -n "AGENT_MEMORY_SUBJECT_PREFIX" packages/shared/src/constants.ts
```
G6b: rebuild agent-memory-service (+ dependents if shared changed).

### T09 — Docs + index

- envelope.md: verify every §-annotation this loop resolved is updated
  (T05/T06 already edit theirs — this task is the sweep that proves no
  stale "current divergence" note survives).
- `manual-loops/architecture/docs-consistency.md` T07 findings: append a
  dated "code fixed in envelope-drift Txx" note per resolved finding
  (findings 4-7, 9 resolved here; finding 8 stands as the deferred
  tier-wiring follow-up per decision 4).
- `cowork/INDEX.md` entry; Engram topic `messaging/envelope-drift`.

**Accept**
```
grep -n "envelope-drift" cowork/INDEX.md
./scripts/checks/doc-code-guards.sh
```

---

## Progress

- [x] T01 consumer JSDoc + constant pin
- [x] T02 depth conforms to shared spec
- [x] T03 durable-name registry fixed
- [x] T04 envelope-schema.json rewrite (pin test lives in packages/shared
  test/unit; follow-up flagged: full envelope-messages SKILL.md translation
  to English incl. frontmatter description)
- [x] T05 stage-1 type token (premise correction: ingester classify is
  SUBJECT-only — no rule/golden change needed; type-agnosticism pinned by
  stage1-type-migration.spec.ts. Follow-ups: hoist WEBHOOK_INGRESS_PROVIDER
  to channel.constants.ts; move buildWebhookIngressType to shared)
- [x] T06 stage-2 headers → data.headers (finding: `webhookHeaders` had NO
  caller — transport.headers never reached the wire; change is wire-neutral,
  closes the type hole. T09 note: add the "ingress caller does not yet
  forward the stage-1 allowlist" clause to envelope.md §10.2 to prevent the
  next implicature drift)
- [x] T07 one INGRESS builder (zero callers confirmed; 20/20 services
  typechecked post-removal; pin scans 4 construction forms. Follow-up
  flagged: lowercase INGRESS-acme examples in packages/database doc
  comments)
- [ ] T08 agent-memory constants + domain
- [ ] T09 docs + index

## Out of scope (explicit)

- `TENANT_TIER_LIMITS` wiring into `ensureTenantIngressStream` (finding 8)
  — capacity policy, deferred by decision 4; standing follow-up.
- Promoting envelope-schema.json to a validation authority — separate
  decision.
- Any change to ackWait/backoff VALUES (T01 fixes the comment, not the
  budgets — those belong to the consumer-budget loops).
- Per-tenant stream migrations/renames — decision 3 keeps the live names
  exactly as they are; only the dead builder is removed.
- The `skills` manifest fifth-resource-kind (deferred, provisioning-manifest-gaps-2).

## Human boundaries for this change

- Human approves this SPEC before the first run — INCLUDING proposed
  decisions 1-5 (clean cutover, type-token adoption, builder removal,
  tier-wiring deferral, shared depth semantics).
- T08 STOPS if any consumer filters on the old `domain` value.
- Any new envelope field or kind beyond the fixes enumerated here.
- If T05's golden extension reveals a taxonomy conflict, naming is approved
  by the human BEFORE code lands (same rule as the call-inspector loop).
