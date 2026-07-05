# Changelog

All notable changes to `@yoizen/platform-sdk` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The SDK's
semver is independent of the platform API version — see the "Semver & compatibility" section
of [README.md](./README.md) for the compatibility table.

## [Unreleased]

Will ship as `0.2.0`. Everything below is **additive and non-breaking** per GROWTH-PLAN.md
invariant #1: `createClient()` → `{ send, sendText }` and all pre-existing error classes are
byte-compatible with `0.1.0` (verified by the unchanged original unit tests and the Phase 0.5
e2e contract).

### Changed

- **Package renamed** `@yoizen/http-sdk` → `@yoizen/platform-sdk` (GROWTH-PLAN P0.3). The
  package is `private: true`, so no published consumers were affected.
- **Migrated to TypeScript** (strict, ESM, emitting `.d.ts`) from plain JS + JSDoc
  (GROWTH-PLAN P0.4). The hexagonal layout (`domain` / `application` / `infrastructure`) is
  preserved. Tests moved from `node --test` to `tsx --test`.

### Added

- **Shared core** (`src/core/`, exported as `@yoizen/platform-sdk/core`):
  - `Session` — reusable token lifecycle (lazy login, refresh with expiry buffer, relogin
    fallback, tenant-scope warning, single in-flight request).
  - Unified authenticated `Transport` — injects `Authorization: Bearer`, `x-yoizen-tenant`,
    `x-request-id`; applies the `apiVersion` path prefix; maps HTTP status to typed errors.
  - Retry policy — idempotent-by-default (GET/PUT/DELETE, or POST with an `idempotencyKey`),
    full-jitter exponential backoff, retries network errors and 5xx only, configurable per
    client and per call.
  - Pagination — `paginate()` async iterator with a `.page()` escape hatch; adapts both real
    `limit`/`offset` (and `page`/`limit`) endpoints and today's bare-array endpoints behind
    one calling shape.
- **19 resource namespaces** on the client root, each with hand-verified types, a client over
  the shared transport, unit tests against a fake transport, and a sub-path export
  (`@yoizen/platform-sdk/<resource>`): `workflows`, `agents`, `runtime`, `channels`,
  `webhooks`, `knowledgeBases`, `skills`, `systemVariables`, `mcpServers`, `connectors`,
  `registry`, `authAdmin`, `tenants`, `audit`, `jobs`, `memories`, `structuredKb`,
  `configFiles`, `dashboard`.
- **New error classes**: `NotFoundError` (404), `ConflictError` (409), `PermissionError`
  (403), `RateLimitError` (429, carries `retryAfterMs` from `Retry-After`).
- **Config options**: `apiVersion` (`null` → `/api`, `"v1"` → `/api/v1`, **default `"v1"`
  as of the 2026-07-05 hardening pass below**) and `retry` (client-level retry default).
- **E2E test suite** (`test/e2e/`, 57 tests across 8 files as of the 2026-07-05 platform
  gap closure below) against a live dev cluster, gated behind `SDK_E2E=1` and run with
  `--test-concurrency=1` (gateway per-tenant rate limit). Unit suite grew to 283 tests, all
  offline.
- `README.md` rewritten for the full surface; this `CHANGELOG.md`; documented semver /
  API-compatibility policy.

### Added (2026-07-05 — platform gap closure, GROWTH-PLAN.md Phase 4)

Three parallel sub-agents fixed the platform-side bugs/gaps below directly in the working
trees of `services/api-gateway`, `services/agent-admin-service`, and
`services/registry-service` (uncommitted, not yet confirmed deployed to the dev cluster —
see the live-probe evidence per item). This SDK change adds the matching methods/types and
closes the corresponding gap notes.

- `workflows.summary()` — `GET /workflows/summary`. **Confirmed LIVE** on the dev cluster
  2026-07-05: `curl` returned `200` with real aggregate data
  (`{"activeDefinitions":8,...,"topByExecutionCountLast7d":[...]}`). This is the only fix in
  this batch verified deployed; the e2e test asserts it directly (no skip-guard).
- `channels.usageSummary()` — `GET /channels/usage/summary`. Verified **NOT live**: `curl`
  returned `404 {"message":"Cannot GET /api/channels/usage/summary"}`.
- `agents.revert(id)`, `agents.listMemoryProposals()`, `agents.approveMemoryProposal(id)`,
  `agents.rejectMemoryProposal(id)` — `POST :id/revert` + the memory-proposals sub-resource.
  Verified **NOT live**: `revert` 404s (`Cannot POST .../revert`); `memory-proposals` is
  mis-routed as an agent id by the gateway's old build (`400 {"message":"Validation failed
  (uuid is expected)"}`).
- `structuredKb.containers.query(id, body)` — `POST containers/:id/query`, typed against
  `agent-admin-service`'s real `QuerySKBDto` / `QueryResult`. Verified **NOT live**: `404
  {"message":"Cannot POST .../query"}`.
- `configFiles.upsert()` — updated to the FIXED `{name,path,content,format}` contract (was
  the broken `{files:[...]}` array shape); `configFiles.deploy()` gains `deletePaths`.
  Verified **NOT live**: the fixed shape still 400s (`"property name/path/content/format
  should not exist"` — the dev cluster's gateway pod still runs the old whitelist).
- `jobs.trigger(id, payload)` — signature unchanged; documented that the gateway now maps
  `payload` to the downstream `event_payload` field instead of silently dropping it.
  Verified **NOT live**: sending `{payload:{...}}` still 400s
  (`"property payload should not exist"` — an even older gateway build than the one that
  introduced the silent-drop bug, meaning `payload` isn't in the DTO whitelist at all yet).

All above ship with unit tests against a fake transport (green regardless of cluster
deploy state) and e2e tests that probe the live endpoint once and tolerate either outcome
(diagnostic-logged, never a red failure) — see each e2e file's `t.diagnostic()` calls for
the exact live/not-live evidence captured per run.

**Still pending deploy** (probed 2026-07-05, unfixed on the dev cluster):
`skills.update()` still 500s on every payload (downstream SQL-building bug);
`systemVariables.create()` still double-JSON-encodes scalar `value`
(`agent-admin-service` unifying fix not live — `update()` was already correct);
`registry.services.update()`'s 409-vs-Knative-reconciler race — not independently
live-probed (destructive to test safely), so the SDK's client-side backoff workaround
(`withKnativeConflictRetry` in `test/e2e/connectors-registry.e2e.ts`) is kept in place
rather than removed.

### Added (2026-07-05 — runtime token streaming, DOCS/architecture/runtime-streaming.md)

SDK-side implementation of `client.runtime.stream()` (design doc §4). The platform side
(api-gateway `proxyStream()`, ai-agent-gateway `submitAndStream()`, agent-ai-service mock
provider gated by `RUNTIME_ALLOW_MOCK_PROVIDER=true`) is done in the working tree but **not
yet deployed** — see the "Pending deploy" note below.

- `Transport.requestStream()` (`src/core/transport.ts`) — sibling to `request()` for
  `text/event-stream` responses. No retry (streams aren't safely retryable mid-flight),
  returns the raw `ReadableStream<Uint8Array>` body, and reuses the same header-building /
  `mapStatusToError` machinery as `request()`. `timeoutMs` applies ONLY to opening the
  connection (time to first response) — the internal open-timer is cleared the instant
  headers arrive, so it can never abort an in-progress token stream; a separately-forwarded
  `signal` stays live for the full stream lifetime for caller-initiated cancellation.
- `parseSseStream()` (new `src/core/sse.ts`) — incremental, protocol-only SSE parser:
  `event:`/`data:` fields, multi-line `data:` joined with `\n`, `:`-prefixed comment/heartbeat
  lines dropped silently (the platform sends `:hb` every 15s), both CRLF and LF terminators,
  and correct handling of lines (including the terminating blank line) split across
  `ReadableStream` chunk boundaries.
- `RuntimeStreamEvent` discriminated union (`src/resources/runtime/types.ts`) —
  `started | token | tool_call | tool_result | completed | failed`, typed from the verified
  wire shapes in `packages/shared/src/runtime-stream.interfaces.ts` and
  `ai-agent-gateway`'s `executions.service.ts`. `failed`'s payload is `{ executionId, reason }`
  only — the design doc's `§4.1` sketch additionally showed an `error` field the real code
  never sets.
- `client.runtime.stream(input, { signal })` — async iterable over `RuntimeStreamEvent`.
  `failed` is a normal, non-throwing terminal event (design §2.3/§4.3); only connection-level
  failures throw. Aborting `signal` ends the iterator cleanly (no throw) at any point.
- **`streaming_unsupported` degradation** (deliberate deviation from design doc `§4.4`): the
  platform has no `capabilities.streaming` flag to probe in advance (verified —
  `runtime-health.controller.ts` just proxies raw `/health`), so `stream()` degrades via
  404/405 detection on the stream route itself, throwing `SdkError` with
  `code: "streaming_unsupported"` instead of silently falling back to polling. Callers that
  want automatic degradation catch this code and fall back to `createExecution()` + poll
  `getExecution()` themselves — see the doc comment on `RuntimeClient.stream()` and the
  "Runtime streaming" section of README.md for the 3-line pattern.
- Unit tests: `test/core/sse.test.ts` (9 tests — framing, heartbeats, CRLF/LF, chunk-boundary
  splits including the terminating blank line, dangling partial events), 5 new
  `requestStream()` tests in `test/core/transport.test.ts`, and 6 new tests in
  `test/resources/runtime/stream.test.ts` (event ordering, `failed` ends iteration without
  throwing, heartbeat filtering, abort-mid-stream, `streaming_unsupported` on 404). Unit suite
  grew from 283 to 303, all green, all offline.
- E2E: `test/e2e/runtime-stream.e2e.ts` (`SDK_E2E=1`) — provisions an agent with
  `model_config.llm.provider: "mock"`, streams a prompt, and asserts `started → token* →
  completed` ordering and that concatenated token deltas echo the prompt; a second run aborts
  mid-stream and asserts clean client-side termination. **Probes the route first** and skips
  its assertions gracefully (diagnostic-logged, not a failure) when the stream route isn't
  live yet. Confirmed 2026-07-05: the dev cluster's `ai-agent-gateway`/`api-gateway` pods
  don't yet run this code, so the probe correctly hit `streaming_unsupported` and skipped —
  e2e suite total went from 57/57 to 58/58 (the new file's single top-level test passing via
  its graceful early-return, not a hard skip).

**Pending deploy**: this SDK code cannot be exercised against real token streams until the
already-implemented platform side (api-gateway, ai-agent-gateway, agent-ai-service changes
described in engram decision #591 / `platform/runtime-streaming-design`) is committed and
deployed to the dev cluster.

**Still open, unaddressed by this batch**: `runtime.stream()` (two downstream SSE
endpoints, neither proxied — blocked on the ai-agent-gateway architecture, an explicit
prior decision, not implemented here) and the `audit` chain-endpoint / missing-`total`
gaps.

### Changed (2026-07-05 — hardening pass: platform fixes confirmed live)

All platform-side fixes from the Phase 4 batch above are now confirmed **live** on the dev
cluster, verified by a fresh round of live probes (curl + e2e) on 2026-07-05:

- **`apiVersion` default flipped from `null` to `"v1"`.** Live-probed every route family
  through `http://localhost:8080/api/v1/...` with a real bearer token: `auth/login`,
  `webhooks/:channel/:tenant`, `workflows`, `admin/agents`, `admin/skills`,
  `admin/system-variables`, `admin/config-files`, `admin/structured-kb/containers`,
  `admin/jobs`, `channels/accounts`, `admin/memories`, `admin/knowledge-bases`,
  `admin/mcp-servers`, `audit/events`, `dashboard/stats`, `tenants`, `registry/services`,
  `connectors` all returned `200` (or a legitimate non-versioning error, e.g. `403` for a
  platform-scope-only route) under `/api/v1`. No route family needed to stay on the
  unversioned `/api` alias, so no per-call `apiVersion` override was added anywhere in the
  resource clients — the client-level default covers every existing call.
- `skills.update()` — **confirmed live**: `PATCH admin/skills/:id` now returns `200` with the
  persisted update (was `500` on every payload). The e2e assertion is now a hard
  `assert.equal`, no more tolerant try/catch.
- `systemVariables.create()` — **confirmed live**: `value` round-trips as the bare string
  (was double-JSON-encoded). Hardened to `assert.equal(created.value, "hello")`.
- `configFiles.upsert()` / `deploy()` — **confirmed live** on the fixed
  `{name,path,content,format}` contract. Hardened, try/catch removed.
- `agents.revert()` / `agents.listMemoryProposals()` — **confirmed live**. Hardened, tolerant
  branch removed.
- `structuredKb.containers.query()` — **confirmed live** (route resolves, no more `404`). A
  fresh container still fails downstream (no schema ingested to translate against), which is
  a genuine business-state error, not a routing gap — hardened to assert the error is not a
  `NotFoundError` instead of tolerating any outcome.
- `jobs.trigger()` with the enable-first flow — already hard-asserted in the prior batch;
  reconfirmed green under the `v1` default.
- `registry.services.update()`'s 409-vs-Knative-reconciler race — **confirmed live**: three
  back-to-back create-then-immediate-update probes (`PATCH` right after `POST`, zero delay)
  all returned `200` with no `409`. The client-side `withKnativeConflictRetry` workaround in
  `test/e2e/connectors-registry.e2e.ts` is removed; `registry.services.update()` is called
  directly.

- `channels.usageSummary()` — **confirmed live** (2026-07-05, after the channel-service
  redeploy): the summary SQL was fixed downstream (`SUM(events)` on the raw
  `channel_events` hypertable — the `events` column only exists on the hourly/daily
  continuous aggregates — replaced with `count(*)`, mirroring the working totals query).
  Live probe returned `200` with real aggregates; the e2e tolerant branch is now a hard
  assertion.

**Still open / genuinely unfixed**:

- `runtime.stream()` — intentionally not a gateway passthrough; out of scope, open by design.

Final test tallies after this pass: unit `283/283` (unchanged — no default-`apiVersion`
assertion existed to update), e2e `57/57` (same 57 tests, now exercising the `v1` default and
the hardened assertions above).

### Known platform gaps (documented, not SDK regressions)

`runtime.stream()` (blocked on ai-agent-gateway architecture) and the `audit`
chain-endpoint / no-`total` gaps remain open. See README.md "Known platform gaps" and each
resource's `types.ts` for the verified evidence, including live-deploy status for the
2026-07-05 batch above.

## [0.1.0]

Initial scope: **http-channel message ingest only**, as `@yoizen/http-sdk` (plain-Node ESM,
JS + JSDoc, zero dependencies).

### Added

- `createClient(config)` → `{ send, sendText }`.
- Auth: `POST /api/auth/login` + `POST /api/auth/refresh` with cached token and expiry
  buffer.
- Channel account lookup: `GET /api/channels/accounts?channel=http` to resolve the
  `appSecret` (and optional per-instance ingress).
- Ingest: `POST /api/webhooks/http/{tenant}[/{instance}]` with `x-http-channel-token`;
  one automatic retry with a re-resolved secret on `signature_mismatch`.
- Error taxonomy: `SdkError`, `ConfigError`, `ValidationError`, `AuthError`,
  `ChannelResolutionError`, `IngestError`.
- Unit tests mirroring `src/` 1:1 with `node:test`, fully mocked ports/fetch.

## Future: publishing

The package remains `private: true` for now; nothing is published to any registry, and CI has
no publish job. The intended path once the SDK is ready to leave private mode:

1. Bump the version (drop `[Unreleased]` to a dated `0.2.0` header here).
2. Point `publishConfig.registry` at the org's internal npm registry and remove
   `private: true`.
3. Wire a publish job into CI (see `ci-notes.md` — the typecheck/unit/e2e jobs are specified
   there; publishing is explicitly deferred until this decision is made).
4. Consumers then switch from `file:` links to a normal registry dependency.
