# Session handoff — Message trace, HTTP connector, Channels cleanup, HTTP connectors sample

Snapshot for the next session. Everything below is on disk; nothing is pending in-memory.

## What shipped this session

### 1. Message trace — debug view (Processes › Diagnostics, `/processes/trace`)
Follow a message across services by `correlation_id`, forward (origin → reply) and reverse
(event id → origin). Spec: `.sdd/changes/processes-message-trace/`. Feature doc:
`services/admin-console/src/app/features/processes/trace/README.md`.

- **Frontend** (`admin-console`): `features/processes/trace/` — `domain/` (model, `assemble-trace.ts`,
  `transport-topology.ts` + unit specs), `message-trace.component.ts`, route in `app.routes.ts`,
  config in `environments/`; service `core/services/message-trace.service.ts`.
- **Backend — Option A** (run keyed by correlation, gives the workflow node + Temporal link):
  `packages/shared/src/workflow-schema.ts` (`correlation_id` column + idempotent ALTER + index);
  workflow-service `executions.{postgres,mongo}.repository.ts`, `executions.repository.interface.ts`,
  `workflows.service.ts`, `workflows.controller.ts` (`GET /workflows/executions?correlation_id`);
  api-gateway `modules/workflows/workflows.controller.ts` (proxy route).
- **UX**: forward/reverse toggle; recent-traces combo (last 10, business + tech ids); per-node
  service chip, full IDs, topic + real `INGRESS-<TENANT>` stream, persisted-in (table + service);
  `send`/`sent` relabeled "reply queued"/"reply delivered"; topology split (`sent` is terminal →
  audit sink only); Open in Temporal on the workflow-run node; Open in Tempo in the keys row.

### 2. HTTP connector (Channels)
HTTP as a first-class channel like WhatsApp/Telegram. `account-dialog.component.ts` (HTTP option,
`provider:"http"`, auto-gen `appSecret`), `layout/nav/nav.config.ts` (HTTP under Channels),
`core/services/metrics/channels-metrics.service.ts` (http account count), `channels.component.ts`
(http ingest "how to send" panel — the `http-bridge` curl). Reverted stray edits in the unused
`layout/sidebar/sidebar.component.ts`.

### 3. Channels landing dedup
`channels-landing.component.ts` — replaced the redundant clickable channel list (it duplicated the
left rail) with **Traffic by channel** + **Needs attention**; dropped fake "Web widget" and the
"Auto-Reply" channel entry. Nav lives only in the left rail now.

### (earlier in session) Telegram sample + workflow builder
`sdk/samples/telegram-transform-reply/` (`setup.sh`, `README.md`); the workflow builder reply
node's "Same as incoming message" account option (account-agnostic `{{request.envelope.accountId}}`).

### 4. (added 2026-06-26, Cowork session) HTTP connectors sample — outbound adapters
New sample `sdk/samples/http-connectors/` provisioning **outbound** HTTP connectors (platform
*adapters*, the `endpointCall` counterpart to the inbound http channel). NOT the same thing as the
"HTTP connector (Channels)" item above — that one is an inbound channel; this is outbound calls.

- **Configs** (`connectors/*.json`, one per API, each a complete `CreateAdapterDto`): `jsonplaceholder`
  (9 eps, GET/POST/PUT/PATCH/DELETE), `httpbin` (11 eps, all verbs + utilities), `pokeapi` (6 GET),
  `catfacts` (3 GET), `httpbin-basic-auth` (2 GET, `authType:"basic"`). 31 endpoints total; every
  endpoint has a descriptive `label`. context = `external`.
- **`setup.sh`** — idempotent **upsert**: login → for each config, create the connector by name
  (with empty endpoints) or reuse it, then **reconcile endpoints** (add any missing `(method,path)`
  via `POST /api/connectors/:id/endpoints`; 409 = already present). Verbose logging; `YOIZEN_*` env
  overrides; `HTTPBIN_BASIC_USER/PASS` rewrite both `authConfig` AND the `/basic-auth/<u>/<p>` paths
  in sync. `README.md` documents the endpoint table + the three `endpointCall` arg shapes.
- **Contract** (verified in code): gateway `POST|GET /api/connectors` + `/:id` + `/:id/endpoints`
  (`services/api-gateway/src/modules/connectors/`), proxied to `connector-admin`
  (`services/connector-admin/src/modules/adapters/`); create/get return `{id,…,endpoints[]}`, list
  returns an array; endpoint unique key is `(method,path)` per adapter; basic auth via
  `packages/shared/src/adapter-auth-headers.ts` (`authConfig.basicUsername/basicPassword`).
- **Note on methods**: pokeapi & catfacts are read-only public APIs → GET-only is correct (a
  registered write verb would 405 upstream). Write verbs live in `httpbin` + `jsonplaceholder`.

## Verification status

- **Typecheck (tsc --noEmit): clean** — admin-console `tsconfig.app.json` + `tsconfig.spec.json`;
  workflow-service and api-gateway (0 errors).
- **NOT run here** (need the toolchain): admin-console `ng build` (full Angular template check) and
  `ng test` (karma — the `assemble-trace` / `transport-topology` / validator specs). Run both before
  shipping.
- Bash artifacts validated with `bash -n` + `jq` payload checks.
- **http-connectors sample**: `bash -n` clean; all 5 configs valid JSON with required
  `CreateAdapterDto` fields; `(method,path)` unique within each connector; reconcile add/skip diff
  and basic-auth path↔creds sync dry-run verified. **NOT run against a live gateway** — `./setup.sh`
  still needs one real run on the cluster.

## Rebuilds

- Message trace **Option A** touched 3 services:
  `./rebuild-redeploy.sh workflow-service && ./rebuild-redeploy.sh api-gateway && ./rebuild-redeploy.sh admin-console`
- Everything else is admin-console-only: `./rebuild-redeploy.sh admin-console`.

## Pending / deferred (with where tracked)

- **Channels landing**: wire real per-channel traffic + live failures (still demo data).
- **Message trace** (`.sdd/changes/processes-message-trace/tasks.md`): Slice 1.5 (correlation-scoped
  gateway read for arbitrary-age lookup — today it's a 60-min client-side window), Slice 2 (live
  consumer health + breaker status endpoints → conclusive failure verdict), Slice 3 (per-message
  delivery metadata). Also: reverse-by-provider-message-id (only internal event id supported now).
- **Permissions**: `diagnostics:read` isn't provisioned for non-admins (tenant admins bypass);
  Message trace is intentionally URL-only (not in `nav.config.ts`).
- **http-connectors sample**: open decision on upsert semantics — current script is **add-only**
  for endpoints (adds missing `(method,path)`, never rewrites existing). Label/cache edits to
  endpoints that already exist (e.g. renamed `catfacts` labels) won't apply until we add a PATCH
  step (PATCH `/api/connectors/:id/endpoints/:epId`) or a full-sync mode. Not yet decided.

## Known caveats (honest)

- `getTrace` resolves correlations from a **~60-min client-side window** (the gateway audit proxy
  doesn't whitelist `correlation_id`).
- `workflow_executions.correlation_id` has **no backfill** — the workflow node + Temporal link only
  appear for runs created **after** the Option-A rebuild.
- `temporalUiBaseUrl` defaults to `http://localhost:8233` (needs `kubectl port-forward svc/temporal-ui 8233:8233`);
  `tempoBaseUrl` is empty so the Tempo link hides until configured.
- Per-node **stream** and **persisted-in** are derived from architecture conventions (accurate for
  today's topology, inferred not stored); the storage **engine** (Postgres/Mongo) is labeled
  generically since the frontend doesn't know the deployment config.
