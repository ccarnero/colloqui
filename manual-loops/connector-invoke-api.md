# SPEC — Connector invoke API: sync + async invocation from code (hosted services)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests and
> dual review. Queues live in `manual-loops/`.
> Origin: user decisions 2026-07-13 (Cowork session, CTO). Engram topic:
> `platform/connector-invoke-api` (related: `demo/crm-telegram-showcase`).
> Depends on: nothing in-flight. `manual-loops/connector-trace-linking.md` touches
> the same event publisher — coordinate if both queues run concurrently.

## Goal

Code (hosted services via the SDK) can invoke connectors through the same governed
pipe workflows use — breaker, cache, audit events — in two flavors, without
touching Temporal:

1. **Shared core** — the endpoint-call execution today trapped inside the Temporal
   activity (`services/connector-runtime/src/activities/endpoint-call.activity.ts`)
   becomes a pure lib both the activity and the new API consume. Today the only
   caller is workflow-service via `proxyActivities` on `CONNECTOR_RUNTIME_TASK_QUEUE`;
   the SDK connectors client is CRUD + usage only (`sdk/src/resources/connectors/client.ts`).
2. **Sync flavor** — `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke`
   executes the core inline and returns the response. Caller owns retries.
3. **Async flavor** — same route with `mode: "async"` returns `202 + invocationId`,
   the request travels through NATS JetStream (same semantics `serviceBusCall`
   already proved: streamed subject, server-side dedup via `Nats-Msg-Id`), a new
   consumer in connector-runtime executes the same core, and the result is
   delivered by webhook with polling as fallback.
4. **SDK** — `connectors.invoke(...)` exposes both flavors with Result types.

## User decisions (human boundary — do not reinterpret)

- Both flavors ship in this queue; sync first (it unblocks the most cases and has
  no new infra).
- Async transport is **NATS JetStream, not Temporal**. The point of the API is
  request/response semantics for code; durability-by-workflow stays a workflow
  feature.
- Result delivery for async: **webhook primary** (hosted services already receive
  HTTP from `serviceCall` actions), **polling by `invocationId` as fallback**
  (result parked in Redis with TTL).
- At-least-once is accepted for async: JetStream redelivery can repeat the outbound
  HTTP call if the consumer dies between call and ack. Document caller-side
  idempotency keys for non-idempotent verbs; do NOT try to build exactly-once.
- The core refactor keeps Temporal types OUT of the core: `ApplicationFailure`
  stays in the activity wrapper; the core returns Result values (`ok/err`).
- Breaker, cache (L1 + Redis L2) and the audit event stay INSIDE the core so both
  paths are governed identically — this is the audit/IT-compliance argument.
- The `crm-support-telegram` demo does NOT depend on this queue. Its workflow
  fan-out design stands.
- E2E runs POST-change only (2026-07-13): the previous green run is the baseline;
  no precondition/pre-change e2e. Every e2e cleans up everything it creates,
  on success and on failure (see Gates).

## Prior art (validated 2026-07-13 — REUSE, do not duplicate)

- Execution core to extract: `executeEndpointCall`, `executeWithAdapterEndpoint`,
  `executeWithAdapterBase`, `executeRaw` —
  `services/connector-runtime/src/activities/endpoint-call.activity.ts`.
- Breaker: `getHttpBreaker` / `computeBreakerKey` (same file). Cache: L1 +
  Redis L2 via `services/connector-runtime/src/activities/_shared/adapter-client.provider.ts`
  and `_shared/redis-client.ts`.
- Audit event: `emit()` in
  `services/connector-runtime/src/activities/_shared/event-publisher.ts` publishes
  `connector.endpoint_call.completed.v1` to JetStream, causally threaded, with the
  `DepthExceededError` → root-event fallback. Reuse as-is for both flavors.
- JetStream publish semantics (headers, `X-Correlation-Id`/`X-Causation-Id`,
  `Nats-Msg-Id` dedup, core-NATS fallback when subject has no stream):
  `services/workflow-service/src/temporal/activities/service-bus.activity.ts`.
  The invocation subject MUST be stream-bound so the fallback never fires.
- SDK surface to extend: `sdk/src/resources/connectors/client.ts` (CRUD + usage
  today) and `sdk/src/resources/webhooks/client.ts` (callback delivery).
- connector-runtime is a pure Temporal worker today — only HTTP is the health
  server (`src/temporal-worker-health.ts`); bootstrap in
  `src/temporal-worker-bootstrap.ts`. The HTTP facade is a SECOND entrypoint of
  the same deployable, not a new service.
- Gateway proxy conventions: existing `/api/v1/connectors` resource routes.

## Constraints (apply to every task)

- Core lib is pure: no Temporal imports, no NATS imports, no Express. I/O stays in
  the entrypoints (activity wrapper, HTTP facade, consumer). Result types in the
  core; `ApplicationFailure` mapping only in the activity wrapper.
- The activity's observable behavior does not change: existing unit tests of
  `endpoint-call.activity.spec.ts` must pass untouched — never weaken them.
- Every invocation (sync, async, hit or miss) emits the SAME
  `connector.endpoint_call.completed.v1` event. No new event kinds for audit.
  Standalone invocations start a root correlation (no workflow `executionId`);
  the `invocationId` goes in the envelope resource.
- New async subjects (invoke request/result) are a taxonomy addition →
  TAXONOMY.md entry + golden, human-approved before T04 lands.
- New HTTP surface: tenant-scoped authz + rate limiting from day one (the task
  queue no longer protects connector-runtime), no `@Public()`.
- Invocation subject bound to a JetStream stream at provisioning time — the
  dedup contract is real only for streamed subjects (see `service-bus.activity.ts`
  comment). Provisioning script is idempotent.
- Verbose logging; nothing fails silently. Webhook delivery failure → warn +
  result still available by polling until TTL.
- Schema/config changes (if any): idempotent, additive, never repurposed.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/connector-runtime && bun test
G2  cd services/connector-runtime && bunx tsc -p tsconfig.json --noEmit
G3  cd services/api-gateway && bun test                  # from T03 onward
G4  cd sdk && bun test && bunx tsc -p tsconfig.json --noEmit   # from T05 onward
G5a ITERATION — dev-mode as in manual-loops/trace-console.md (deps sha-check +
    dev-mode on at task start), but e2e runs AFTER the attempt's change only:
      <apply the change> → ./scripts/e2e-http-workflow.sh   # exit 0 required
    NO baseline/precondition e2e before the change: the previous attempt's (or
    previous task's) green run IS the baseline. If the post-change e2e fails,
    the change is the suspect — do not spend an attempt re-proving the baseline.
G5b COMMIT GATE — as in manual-loops/trace-console.md (dev-mode off +
    rebuild-redeploy of touched services + e2e green on built image).
```

Gate rules: as `manual-loops/trace-console.md` EXCEPT the e2e ordering above
(no `validate-dev-mode.sh --with-e2e` precondition, no pre-change e2e run —
supersedes the inherited rule for THIS queue). Full suites in touched services;
commits only on built image.

E2E CLEANUP (applies to G5a and G5b, every run): everything the e2e creates to
test — connectors, endpoints, test invocations, webhook registrations, JetStream
test consumers, Redis `invocation:*` keys, seeded fixtures — is account-scoped
(dedicated e2e account/tenant) and torn down at end of run via a `trap`-guarded
cleanup stage that runs on success AND failure. Cleanup is idempotent: a rerun
after a crashed run never finds leftovers it can't handle, and never deletes
anything outside the e2e account scope.

---

## Task queue

### T01 — Extract the endpoint-call core (pure lib, Result types)

- Move `executeWithAdapterEndpoint` / `executeWithAdapterBase` / `executeRaw` +
  breaker + cache + `emit()` wiring into `services/connector-runtime/src/lib/endpoint-call-core/`
  (one function per file, repo convention).
- Core returns `Result<IEndpointCallResult, EndpointCallError>`; error variants
  cover breaker-open, HTTP failure, timeout. No throws across the lib boundary.
- The Temporal activity becomes a thin wrapper: unwrap Result →
  `ApplicationFailure` with today's exact `type`/`nonRetryable`/`nextRetryDelay`
  fields (breaker-open keeps `CIRCUIT_OPEN` + cooldown).
- Unit tests for the core (hit, miss, breaker-open, HTTP error) + wrapper mapping
  tests. Existing activity spec passes UNCHANGED.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T02 — HTTP facade entrypoint in connector-runtime (sync invoke)

- Second entrypoint (`src/http-main.ts`) serving
  `POST /invoke/:connectorId/:endpointId` internally; reuses core + config.
  Health endpoint pattern follows `temporal-worker-health.ts`.
- Tenant guard middleware (header contract as in gateway-proxied services),
  rate limit (config-driven, verbose log on reject).
- Sync mode only in this task: body `{ args, mode?: "sync" }` → core inline →
  200 with `IEndpointCallResult` | mapped error status. Audit event emitted
  (root correlation + `invocationId` generated here even in sync).
- Deployment: same image, second container/profile — document scaling note
  (worker scales on queue depth, facade on RPS) in the service README.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T03 — Gateway proxy route

- `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke` → facade.
  Explicit proxy module, global guards, no `@Public()` (repo convention).
- Contract tests: authz (cross-tenant 403), payload passthrough, error mapping.

**Accept**
```
cd services/api-gateway && bun test
```

### T04 — Async publish path (202 + invocationId)

- TAXONOMY.md: invoke request/result subjects + goldens (human approves naming
  BEFORE code).
- Facade `mode: "async"`: validate → publish request envelope to the invoke
  subject (JetStream, `Nats-Msg-Id = invocationId`, tenant + correlation headers
  as in `service-bus.activity.ts`) → `202 { invocationId }`.
- Provisioning: idempotent script binding the invoke subjects to a stream
  (Claude writes it, the human runs the first `--apply`).
- Tests: dedup (double POST with same idempotency key → one message), 202
  contract, subject-not-bound fails loud at startup check (never silent core-NATS
  fallback for this subject).

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
cd services/api-gateway && bun test
```

### T05 — Async consumer + result parking + webhook delivery

- Durable JetStream consumer in connector-runtime (new consumer bootstrap next to
  the worker): consume invoke request → run core → publish result event → park
  result in Redis (`invocation:{id}`, TTL config, default 15m).
- Webhook delivery via the platform webhooks machinery to the caller's registered
  callback; failure → warn + polling still works. Explicit ack AFTER parking the
  result (at-least-once; document the duplicate-HTTP window).
- `GET /api/v1/connectors/invocations/:invocationId` (facade + gateway):
  `pending | completed + result | expired`.
- Tests: happy path, redelivery after simulated crash-before-ack (dedup on
  result parking by invocationId), TTL expiry, webhook-down → polling.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
cd services/api-gateway && bun test
```

### T06 — SDK: `connectors.invoke()` both flavors

- `invoke(connectorId, endpointId, args, opts)` → sync by default;
  `{ mode: "async", webhook?, idempotencyKey? }` → `{ invocationId }` +
  `invocations.get(id)` for polling. Result types, no throws (SDK convention).
- Types shared with the facade contract; JSDoc states the at-least-once caveat
  and when to pass `idempotencyKey`.
- Unit tests against a mocked transport; contract fixtures from T02/T04 responses.

**Accept**
```
cd sdk && bun test && bunx tsc -p tsconfig.json --noEmit
```

### T07 — Cluster e2e: sync + async round trip

- e2e: seed connector + endpoint → SDK sync invoke (miss then hit, assert
  `cacheResult` in the audit event) → async invoke → webhook received (or poll)
  → audit events causally sane (root correlation, invocationId present).
- Runs post-change only (G5a rule of this queue): no baseline pass beforehand.
- Account-scoped fixtures + `trap`-guarded end-of-run cleanup stage (success AND
  failure): connector, endpoints, invocations, webhook registration, JetStream
  test consumer, Redis `invocation:*` keys. Idempotent — a rerun after a crash
  cleans leftovers instead of tripping on them.

**Accept**
```
G5a green on the e2e; G5b for commit.
```

### T08 — Docs + index

- Service README (facade entrypoint, scaling note, at-least-once contract),
  SDK docs for `invoke`, DOCS/ index entry, this queue linked from
  `manual-loops/` index if one exists.

**Accept**
```
Docs build/lint green; reviewed prose.
```

---

## Progress

- [x] T01 endpoint-call core extraction (pure lib, Result types) — core in `src/lib/endpoint-call-core/` with injected `EndpointCallEventSink` + injectable HTTP response cache; activity is a thin wrapper mapping Result → ApplicationFailure (exact pre-extraction fields)
- [x] T02 http facade entrypoint (sync invoke) — `src/http-main.ts` (Bun.serve, port 3100) + pure `src/lib/http-facade/*`; tenant header guard, per-tenant in-memory rate limit (platform `RATE_LIMIT_DEFAULT_*` defaults + env overrides — human to confirm), error map breaker_open→503/invalid_args→400/http_error→502/timeout→504; envelope resource `invocation/<id>`; `FetchLike` narrowing in packages/shared for @types/bun
- [x] T03 gateway proxy route — `modules/connector-invoke` (TenantJsonProxyBase), `CONNECTOR_RUNTIME_HTTP_URL` (default :3100); health-map registration deferred until the deployment-shape human call (reviewer note)
- [x] T04 async publish path (202 + invocationId) — subjects approved 2026-07-13: `evt.<t>.connector-runtime.platform.endpoint.system.invoke_{requested,completed}.v1` (TAXONOMY rule 21, goldens 80→82); stream `CONNECTOR-INVOKE` via `services/connector-runtime/scripts/provision-invoke-stream.ts` (HUMAN must run first `--apply`); facade startup fails loud if subject unbound. KNOWN GAP for T06: gateway proxy collapses facade 202→200 (`@HttpCode(OK)` + downstreamJsonProxy)
- [x] T05 async consumer + result parking + webhook — DESIGN CHANGE (human-approved 2026-07-14): no dedicated CONNECTOR-INVOKE stream (INGRESS-<tenant> already binds evt.<tenant>.>); provisioning script → verify-only `scripts/verify-invoke-stream-binding.ts`; durable `connector-runtime-invoke` filters invoke_requested on INGRESS streams. Third entrypoint `src/invoke-consumer-main.ts`; Redis `invocation:<tenant>:<id>` TTL 900s (human boundary: default kept at SPEC's 15m); webhook = caller-supplied url+headers with SSRF guard (`validate-outbound-url.ts`, request-time 400 + delivery-time) and hop-by-hop header denylist; ack after park; GET invocations route (facade+gateway). Also fixed unit tests dialing real NATS (shared fake-nats-jetstream helper)
- [x] T06 sdk connectors.invoke() both flavors — `connectors.invoke()` (sync default, async 202+invocationId) + `connectors.invocations.get()`; typed SdkError throws per the SDK's real convention (SPEC's "Result types" line reflected an assumed convention that doesn't exist in sdk/src). Also fixed the gateway 202 collapse (`downstreamJsonProxyWithStatus` + `proxyWithStatus` + passthrough @Res)
- [x] T07 cluster e2e sync + async (post-change only, cleanup) — `scripts/e2e-connector-invoke.sh` (sync miss→hit with cacheResult from audit events, async 202→completed, in-cluster webhook receiver as FATAL assertion, causal sanity, trap-guarded idempotent cleanup); deployment shape approved 2026-07-14: 3 Deployments (worker / connector-runtime-http:3100+Service / connector-runtime-invoke), rebuild-redeploy rolls all three. FOLLOW-UPS (reviewer-flagged, non-blocking): (1) `validateOutboundUrl` never resolves DNS — `*.svc.cluster.local` names bypass the RFC1918 guard; (2) e2e header comment says async cache_status is informational but the assertion is strict
- [ ] T08 docs + index

## Out of scope (explicit)

- Migrating workflow `endpointCall` actions to the HTTP facade — workflows stay
  on Temporal activities (durability is the feature there).
- Exposing invoke to third parties outside the platform (hosted services /
  SDK-authenticated callers only; public API productization is its own queue).
- Exactly-once delivery for async (documented caller idempotency instead).
- Admin-console screens for invocations (the audit event already lands in the
  existing trace tooling; UI is a future queue).
- Any change to the `crm-support-telegram` demo design.

## Human boundaries for this change

- Approving this SPEC before the first run.
- T04 subject naming / TAXONOMY.md addition — approve before code.
- First `--apply` of the stream-provisioning script.
- T02 deployment-shape verdict: if the second entrypoint complicates the
  connector-runtime deployment, choosing between second container profile vs.
  thin separate service is a human call.
- Rate-limit defaults and the Redis result TTL default.
