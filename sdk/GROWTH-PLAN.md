# Platform SDK Growth Plan

Status: approved — **all phases DONE (0 through 5); this document is now a
dated RECORD of that effort, not a live plan.**
Audience: LLM agents and developers executing SDK expansion work
Scope: evolve `sdk/` (`@yoizen/http-sdk` v0.1.0) into a full platform SDK covering every REST API exposed by the api-gateway, following versioning best practices, without breaking the current stable state.

> **Read this before trusting any number below (re-verified 2026-08-03).**
> Every "Status: DONE" block and every §1 audit finding is dated and is kept
> verbatim as history. Current reality differs on four checkable points:
>
> - **Package name**: the Scope line above and §1.1 say `@yoizen/http-sdk`.
>   P0.3 renamed it — `sdk/package.json` says `@yoizen/platform-sdk`, still
>   `v0.1.0`, still `private: true`.
> - **Namespace count**: Phase 2 records "All 19 namespaces shipped". There
>   are **21** today (`ls sdk/src/resources` and the 21 `create*Client(...)`
>   calls in `src/infrastructure/create-client.ts`) — `manifests` and
>   `secrets` were added afterwards by the declarative-provisioning /
>   samples-reorg efforts, not by this plan.
> - **Test tallies**: Phase 5's closing "unit `283/283`, e2e `57/57`" is a
>   2026-07-05 snapshot. Today `npm test` (now `bun test src/ test/`, not
>   tsx — see sdk/README.md "Why Bun runs the unit suite") reports **407
>   tests across 52 files**: the 38 under `test/` plus the 14 co-located
>   `src/cli/**/*.test.ts` specs the old tsx glob never reached (E15).
>   `test/e2e/` still runs on tsx and holds **9 files / 62 `test()` cases**.
> - **§1.2's "No API versioning" / "No OpenAPI"** are the 2026-07-04 audit's
>   findings; Phase 0 closed both. `/api/v1` + `/api/docs` are live.
>
> **On the resource types' `verified YYYY-MM-DD` headers** (the claim this
> document is the anchor for): 16 of the 21 resources carry one, all reading
> `verified 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2` — plus
> `src/core/pagination.ts`. Only `tenants/types.ts` has been re-dated since
> (`messagingTier surface re-verified 2026-08-01`). Five resources carry **no
> verified-date header at all**: `manifests`, `secrets`, `mcp-servers`,
> `runtime`, `skills`. The dates are historical claims and are left as
> written; treat any 2026-07-04 header as "last checked a month ago", not as
> a standing guarantee.

---

## 1. Context and audit findings (verified 2026-07-04)

### 1.1 Current SDK

- Location: `sdk/` — package `@yoizen/http-sdk`, v0.1.0, `private: true`, plain-Node ESM, JS + JSDoc (no TypeScript).
- Architecture: hexagonal. `src/domain/` (pure value objects: token, sender, message, errors), `src/application/` (`ports.js` JSDoc contracts, `ingest-client.js` single use case), `src/infrastructure/` (fetch wrapper `http.js`, adapters for auth / channel directory / ingest, `config.js`, composition root `create-client.js`).
- Public surface: `createClient(config)` → `{ send, sendText }` plus error classes. Nothing else.
- Endpoints covered today (the ONLY ones):
  - `POST /api/auth/login`, `POST /api/auth/refresh`
  - `GET /api/channels/accounts?channel=http`
  - `POST /api/webhooks/http/{tenant}[/{instance}]` (header `x-http-channel-token`)
- Tests: `sdk/test/` mirrors `src/` 1:1 using `node:test`, fully mocked ports/fetch. No integration/e2e tests exercise the SDK against a live cluster.

### 1.2 Platform API surface (from full inventory of `services/`)

- Single external entry point: `services/api-gateway`, global prefix `/api` (`main.ts` `setGlobalPrefix("api")`), `/health` and `/readyz` excluded.
- Edge auth: global `TenantGuard` (hostname / `x-yoizen-tenant` header / `?tenant=`) then `AuthGuard` (JWT HS256 via `jose`, `@Public()` bypass, scopes/permissions). Internal services only re-validate tenant header format; JWT is enforced at the gateway only. **The SDK must talk exclusively to the gateway.**
- Resource groups exposed via the gateway (all proxied to internal services):
  - `auth` (token, login, refresh, clients, public-routes, users, tenant-users, tenant-roles)
  - `admin/agents` (CRUD, publish/unpublish/revert, versions + rollback, tools/mcp-servers/tool-descriptions patches, memory-proposals)
  - `admin/jobs` (CRUD, enable/disable/run/trigger, executions)
  - `admin/knowledge-bases` (+ `:kbId/documents`: upload, upload-file, reingest, chunks)
  - `admin/mcp-servers`, `admin/skills`, `admin/system-variables`, `admin/structured-kb` (+ containers, query), `admin/memories`, `admin/config-files`, `admin/templates`, `admin/tools`, `admin/adapters`, `admin/runtime/status`
  - `channels` (accounts CRUD, `:accountId/messages`, auto-reply, streams, usage)
  - `webhooks` (`:channel/:tenantId[/:instance]` ingestion)
  - `connectors` (CRUD, usage, `:id/endpoints` CRUD)
  - `registry` (services CRUD, revisions, canary + promote/rollback, routes)
  - `runtime/executions` (POST, GET `:id`; agent-ai-service also exposes an SSE streaming execution)
  - `tenants` (CRUD)
  - `workflows` (CRUD, summary, execute, executions, executions/counts)
  - `audit` (events, channel-events, chains, gateway stats)
  - `dashboard/stats`
- **No API versioning exists anywhere** (no `enableVersioning`, no `/v1` routes).
- **No OpenAPI/Swagger exists anywhere** (zero `@nestjs/swagger` usage repo-wide).

### 1.3 Known documentation drift (fix in Phase 0.5)

The old `sdk/samples` tier's top-level `README.md` claimed every sample depends on the SDK via a local `file:` link. This was false: no `package.json` existed under that tier, all samples were `curl`+`jq` bash scripts, and the `http-bridge` sample's `README.md` (now `sdk/examples/reference-pattern/README.md`) stated it migrated away from the SDK. No sample exercised the SDK at the time.

### 1.4 Existing safety net (verified)

- `scripts/e2e/http-workflow.sh` — live-cluster end-to-end covering the SDK's exact happy path: login → channel account cleanup/create → workflow create → webhook ingest → execution verification.
- `scripts/smoke-test.sh` — preflight readiness of 17 Knative services + 8 worker deployments.
- Per-service `test/unit`, and e2e/integration suites in several services (agent-admin-service has agents/multi-tenancy/NATS e2e).

---

## 2. Invariants — do not break these

1. The current public API (`createClient` → `{ send, sendText }`, error classes) keeps working unchanged until a major-version bump is explicitly decided.
2. `scripts/smoke-test.sh` and `scripts/e2e/http-workflow.sh` must pass before AND after every phase. Run them and record the baseline before touching any code.
3. Existing `sdk/test/` unit tests keep passing at every step.
4. Growth is additive: new code wraps or sits beside existing adapters; existing files are refactored only after the SDK e2e (Phase 0.5) is green and can prove parity.
5. The SDK talks only to the api-gateway. Never call internal services directly.
6. All SDK code, comments, docs, and identifiers are in English.

---

## 3. Phases

Execute in order. Each phase has acceptance criteria; do not start the next phase until they are met.

### Phase 0 — Foundational decisions and platform prerequisites

Status: DONE — Gateway URI versioning (`/api/v1` + deprecated unversioned aliases with `Deprecation`/`Link` headers) and OpenAPI (`/api/docs`, `/api/docs-json`) implemented in `services/api-gateway` source; package renamed to `@yoizen/platform-sdk`; SDK fully migrated to strict TypeScript. **Update 2026-07-05**: the versioned gateway build is now confirmed deployed and live on the dev cluster — every route family live-probed under `/api/v1` (auth, webhooks, and every admin/resource route). The SDK's `apiVersion` default was flipped to `"v1"` (see Phase 4 closure below); no route family needed to stay unversioned.

These are platform-side changes that unblock SDK best practices.

- **P0.1 API versioning at the gateway.** Enable NestJS URI versioning in `services/api-gateway` so routes are exposed as `/api/v1/...`. Keep the current unversioned `/api/...` routes working as deprecated aliases (mark deprecation in response headers, e.g. `Deprecation: true`). Downstream internal services are NOT versioned; only the edge contract is.
- **P0.2 OpenAPI at the gateway.** Add `@nestjs/swagger` to api-gateway, decorate existing DTOs/controllers, serve the spec (e.g. `/api/docs`, JSON at `/api/docs-json`). The generated spec becomes the source of truth for SDK types.
- **P0.3 Package re-scope.** Rename `@yoizen/http-sdk` → `@yoizen/platform-sdk`. The package is `private: true` at v0.1.0, so the rename cost is minimal now. Update `sdk/package.json` (name, description), `sdk/README.md`, and any `file:` references.
- **P0.4 TypeScript.** Migrate `sdk/src` to TypeScript (strict), emitting ESM + `.d.ts`. Keep the hexagonal layout. Alternative accepted if migration is deferred: generate `.d.ts` from OpenAPI and keep JS — but full TS is the target.

Acceptance: gateway serves `/api/v1/*` and OpenAPI JSON; old routes still work; smoke + e2e scripts green; SDK builds and unit tests pass under the new name.

### Phase 0.5 — SDK regression contract (MANDATORY before any refactor)

Status: DONE — `sdk/test/e2e/http-ingest.e2e.ts` reproduces the full ingest flow through `createClient()` (gated behind `SDK_E2E=1`, `npm run test:e2e` added); the old `sdk/samples` tier's top-level `README.md` was corrected (since superseded by `integrations/README.md` + `sdk/examples/README.md`); green baseline recorded against the dev cluster and kept green through Phases 1-2.

- Fix the old `sdk/samples` tier's top-level `README.md` (remove the false `file:`-link claim or make it true).
- Create `sdk/test/e2e/` with a live-cluster test that reproduces `scripts/e2e/http-workflow.sh` THROUGH the SDK: `createClient()` → resolve channel account → `send()` → assert `status === "accepted"`. Gate it behind an env flag (e.g. `SDK_E2E=1`) so `npm test` stays offline-safe; add `npm run test:e2e`.
- Run it against the dev cluster and record the green baseline.

Acceptance: `npm run test:e2e` passes against the dev cluster. This test must stay green through all later phases.

### Phase 1 — Shared core

Status: DONE — `src/core/` ships session, unified transport (auth headers, request-id, apiVersion prefix, typed error mapping), retry (idempotent-by-default, full-jitter backoff), pagination (`paginate()` async iterator + `.page()`), the extended error taxonomy (`NotFoundError`, `ConflictError`, `RateLimitError`, `PermissionError`), and per-resource sub-path exports. Ingest flow re-wired through the core with `send`/`sendText` byte-compatible.

Extract the cross-cutting machinery every resource client will need. Existing adapters are not modified until parity is proven.

- **P1.1 `Session` / auth manager.** Extract token lifecycle (login, refresh, expiry buffer, relogin fallback, tenant-scope check with `onWarn`) out of `ingest-client.js` into a reusable `src/core/session` component. `ingest-client` becomes a consumer of it.
- **P1.2 Unified transport.** Evolve `http.js` into an authenticated transport: injects `Authorization: Bearer`, `x-yoizen-tenant`, timeout, API version prefix (`/api/v1`), request-id header propagation, and centralized error mapping (HTTP status → typed `SdkError` subclass). All resource clients use it; no adapter hand-rolls headers.
- **P1.3 Retry/backoff.** Exponential backoff with jitter for network errors and 5xx. Default ON for idempotent methods (GET/PUT/DELETE), OFF for non-idempotent POST unless an idempotency key is provided. Configurable per client and per call.
- **P1.4 Pagination.** Async-iterator list helper: `for await (const item of client.workflows.list())`, plus a `.page()` escape hatch. Adapt to whatever pagination convention the gateway exposes (verify actual query params in controllers before implementing; standardize gateway-side if inconsistent).
- **P1.5 Errors.** Keep the `SdkError` taxonomy; add `NotFoundError`, `ConflictError`, `RateLimitError` (respect `Retry-After`), `PermissionError`.
- **P1.6 Sub-path exports.** Restructure `package.json` `exports` for `"."` plus per-resource subpaths (`@yoizen/platform-sdk/workflows`, etc.).

Acceptance: unit tests for session, transport, retry, pagination; existing ingest flow re-wired through the new core; SDK e2e (Phase 0.5) still green; `send`/`sendText` behavior byte-compatible.

### Phase 2 — Resource clients (priority order)

Status: DONE — All 19 namespaces shipped (workflows, agents, runtime, channels, webhooks, knowledgeBases, skills, systemVariables, mcpServers, connectors, registry, authAdmin, tenants, audit, jobs, memories, structuredKb, configFiles, dashboard). Final counts: 276/276 unit tests, 53/53 e2e tests green (SDK_E2E=1, `--test-concurrency=1` required — gateway per-tenant rate limit). Types hand-verified against gateway controllers + downstream DTOs; known platform gaps documented in each resource's `types.ts` and in `sdk/README.md` "Known platform gaps" (platform backlog, not SDK work).

Namespaced clients on the root: `client.workflows.*`, `client.agents.*`, etc. Each client ships with: TS types (generated from OpenAPI where possible), unit tests against mocked transport, README section, and — where a live flow exists — an e2e addition.

Implement in this order (driven by real sample usage):

1. **workflows** — CRUD, `summary`, `execute`, `executions`, `executions/counts`, per-execution get.
2. **agents** (`admin/agents`) — CRUD, publish/unpublish/revert, versions + rollback, tools/mcp-servers patches. **runtime** — `executions` create/get + SSE streaming as an async iterator of events (needs its own design; not request/response).
3. **channels** — accounts CRUD, send message, auto-reply, streams, usage. **webhooks** — generalize the existing ingest adapter to any channel (`:channel/:tenantId[/:instance]`).
4. **knowledgeBases** (+ documents: upload, upload-file, reingest, chunks), **skills**, **systemVariables**, **mcpServers**.
5. **connectors** (+ endpoints), **registry** (services, revisions, canary + promote/rollback, routes).
6. **auth admin** (users, clients, tenant-users, tenant-roles, public-routes), **tenants**, **audit**, **jobs**, **memories**, **structuredKb**, **configFiles**, **dashboard**.

Type strategy: hybrid — request/response types generated from the gateway OpenAPI spec (P0.2); client methods handwritten over the shared core for ergonomics. Do not fully codegen clients.

Acceptance per resource: unit tests green; types compile; README updated; Phase 0.5 e2e green.

### Phase 3 — Real-world validation, docs, release hygiene

Status: P3.2 DONE — `sdk/README.md` rewritten for the full surface (config table, per-resource method index, error/retry/pagination semantics, e2e guide, known gaps, semver/compatibility policy); `sdk/CHANGELOG.md` added (Keep a Changelog, with a documented future-publishing path). P3.1 DONE — the `http-bridge` sample (now `sdk/examples/reference-pattern`) migrated to a `file:../..` SDK dependency (Node/TS app under `src/`, SDK-powered `run.sh`), verified live end-to-end against the dev cluster (`{"status":"accepted"}`); remaining samples migrate as follow-ups. P3.3 DONE — no wired CI exists anywhere in the repo (only `skills/devops` template assets), so per the fallback rule below the proposed jobs (typecheck + unit on PR, env-gated manual e2e, no publishing yet) are documented in `sdk/ci-notes.md` instead of inventing pipeline infra.

- **P3.1 Migrate samples to the SDK.** Each sample under `integrations/` (formerly the `sdk/samples` tier) gets a `package.json` with a `file:../..` dependency and replaces its `curl`+`jq` logic with SDK calls where the SDK now has coverage. Samples become living integration tests. Keep `run.sh` entry points working.
- **P3.2 Docs.** Rewrite `sdk/README.md` for the full surface (per-resource sections, config table, error table, pagination/retry/streaming semantics). Add `CHANGELOG.md` (Keep a Changelog format) and a documented semver policy: SDK semver is independent of API version; the supported API version(s) are declared in a compatibility table.
- **P3.3 CI.** Add SDK jobs to the pipeline: typecheck, unit tests on every PR; e2e job (env-gated) against the dev cluster; publish flow to the internal registry when ready to drop `private: true`.

Acceptance: at least the `http-bridge`-equivalent sample runs on the SDK end-to-end; README/CHANGELOG complete; CI green.

### Phase 4 — Platform gap closure (2026-07-05)

Status: DONE (SDK-side) — three parallel sub-agents fixed the platform-side bugs/gaps
tracked in Phase 2's "known platform gaps" list, directly in the working trees of
`services/api-gateway`, `services/agent-admin-service`, and `services/registry-service`
(uncommitted). This phase adds the matching SDK methods/types and closes the gap notes.

Closed (SDK methods added, matching the fixed/newly-proxied gateway routes):

- `workflows.summary()` — `GET /workflows/summary`. **Confirmed LIVE** on the dev cluster
  2026-07-05 (200, real aggregate data) — the only fix verified deployed.
- `channels.usageSummary()` — `GET /channels/usage/summary`.
- `agents.revert()`, `agents.listMemoryProposals()`, `agents.approveMemoryProposal()`,
  `agents.rejectMemoryProposal()` — `POST :id/revert` + the memory-proposals sub-resource.
- `structuredKb.containers.query()` — `POST containers/:id/query`.
- `configFiles.upsert()` — fixed to the `{name,path,content,format}` contract;
  `configFiles.deploy()` gains `deletePaths`.
- `jobs.trigger()` — unchanged signature; the gateway now correctly maps `payload` to the
  downstream `event_payload` field instead of dropping it.

**Pending deploy (as of 2026-07-05, closed below)**: every gap above except
`workflows.summary()` was initially verified NOT live on the dev cluster (see
`sdk/CHANGELOG.md` "Unreleased" for the exact probe evidence — HTTP status + body per
endpoint). `skills.update()` (500) and `systemVariables.create()` (double-JSON-encoding)
fixes in `agent-admin-service` were also not live at that time. The `registry.services.update()`
409-retry fix in `registry-service` was not independently live-probed and was treated as
pending, with the SDK's e2e client-side backoff workaround (`withKnativeConflictRetry` in
`test/e2e/connectors-registry.e2e.ts`) kept in place.

Still open, unaddressed by this phase: `runtime.stream()` (blocked on the ai-agent-gateway
architecture — explicit prior decision, do not implement) and the `audit` chain-endpoint /
`total`-count gaps.

Acceptance: unit tests cover every new method against a fake transport (green regardless of
cluster state); e2e tests probe each dependent endpoint live and skip/tolerate gracefully
when the gateway fix isn't deployed yet, so `SDK_E2E=1 npm run test:e2e` stays green in both
the pre- and post-deploy world.

### Phase 5 — Hardening pass: platform fixes confirmed live (2026-07-05, FINAL)

Status: DONE — this is the closing pass of the platform-sdk-growth effort. A fresh round of
live probes (curl + e2e, gateway port-forwarded to `localhost:8080`) confirmed every
Phase 4 platform-side fix is now deployed and live on the dev cluster:

- `apiVersion` default flipped `null` → `"v1"` (`src/infrastructure/config.ts`). Every route
  family the SDK calls — `auth`, `webhooks`, `workflows`, `admin/agents`, `admin/skills`,
  `admin/system-variables`, `admin/config-files`, `admin/structured-kb`, `admin/jobs`,
  `channels`, `admin/memories`, `admin/knowledge-bases`, `admin/mcp-servers`, `audit`,
  `dashboard`, `tenants`, `registry`, `connectors` — was live-probed under `/api/v1` and
  returned success (or a legitimate non-versioning error). No per-call override was needed
  anywhere; the client-level default alone covers the full surface.
- `skills.update()`, `systemVariables.create()`, `configFiles.upsert()`/`deploy()`,
  `agents.revert()`/`listMemoryProposals()`, `structuredKb.containers.query()` — all
  confirmed live; the corresponding e2e tolerant probe+diagnostic branches were converted to
  hard assertions (`test/e2e/admin-resources.e2e.ts`, `test/e2e/agents.e2e.ts`,
  `test/e2e/admin-final.e2e.ts`).
- `registry.services.update()` 409-retry — confirmed live via 3 back-to-back
  create-then-immediate-update probes (0 delay, 0 client-side retries, all `200`). The
  `withKnativeConflictRetry` workaround in `test/e2e/connectors-registry.e2e.ts` was removed.

**Kept intentionally unfixed / tolerant**: `channels.usageSummary()` still 500s — a separate,
genuinely open `channel-service` SQL bug (nonexistent `events` column, task #17) unrelated to
the routing fixes above; its e2e test keeps the tolerant diagnostic branch. `runtime.stream()`
remains out of scope by design (not a gateway passthrough).

Final tallies: unit `283/283`, e2e `57/57`, both green with the `v1` default active.

Acceptance: `npm run build` clean; `npm test` and `SDK_E2E=1 npm run test:e2e` both green;
README/CHANGELOG updated; known-gaps list trimmed to the two items above.

---

## 4. Working agreements for executing agents

- Verify endpoint shapes by reading the actual gateway controllers (`services/api-gateway/src/**/*.controller.ts`) and downstream DTOs before writing a client. Do not infer from this document alone — it is a map, not the territory.
- Follow the existing hexagonal layout and test style (`node:test`-style 1:1 mirroring, or the TS-equivalent after P0.4).
- Conventional commits; never commit/push without explicit user instruction (repo policy).
- Run `sdk` unit tests + Phase 0.5 e2e before declaring any task done. If the cluster is unavailable, say so explicitly instead of skipping silently.
- If a gateway endpoint turns out to be inconsistent (pagination params, error shapes), fix or standardize gateway-side first and note it — do not encode inconsistency into the SDK.
