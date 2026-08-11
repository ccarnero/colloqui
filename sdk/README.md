# @yoizen/platform-sdk

TypeScript (strict, ESM) SDK for the **full Yoizen platform API**. One `createClient()` gives
you the original message-ingest primitives (`send` / `sendText`) plus **21 namespaced resource
clients** (`client.workflows.*`, `client.agents.*`, `client.channels.*`, ...) covering every
REST resource the api-gateway exposes. The SDK keeps the original hexagonal architecture
(`domain` / `application` / `infrastructure`, plus a shared `core`), has zero runtime
dependencies, and **talks exclusively to the api-gateway** — never to internal services.

> Requires **Node ≥ 18** (native `fetch`). ESM only. Package is currently `private: true`
> (v0.1.0) — see [CHANGELOG.md](./CHANGELOG.md) for the release/publishing status.

## Quickstart

The package is private (not on any registry yet), so consume it via a local `file:` link:

```jsonc
// your-app/package.json
{
  "dependencies": {
    "@yoizen/platform-sdk": "file:../path/to/platform-cluster/sdk"
  }
}
```

```ts
import { createClient, NotFoundError } from "@yoizen/platform-sdk";

const client = createClient({
  tenant: "acme",
  email: "ops@acme.com",
  password: "•••",
  // baseUrl defaults to the dev-cluster gateway; override for anything else
});

// Resource client: list workflows (async iterator — see Pagination below)
for await (const wf of client.workflows.list()) {
  console.log(wf.id, wf.name);
}

// Typed errors
try {
  await client.agents.get("nope");
} catch (err) {
  if (err instanceof NotFoundError) {
    /* 404 */
  }
}

// Original ingest primitive, unchanged since v0.1.0
await client.sendText("hello world");
await client.send({ from: "customer@example.com", text: "order shipped" });
```

Or configure entirely from the environment and call `createClient()` with no arguments:

```bash
export YOIZEN_TENANT=acme
export YOIZEN_EMAIL=ops@acme.com
export YOIZEN_PASSWORD=•••
```

Every resource is also importable as a sub-path, so consumers that only need one namespace
don't pull in the rest:

```ts
import { createWorkflowsClient } from "@yoizen/platform-sdk/workflows";
import { paginate } from "@yoizen/platform-sdk/core";
```

## Common recipes

### 1. Create a client

```ts
import { createClient } from "@yoizen/platform-sdk";

const client = createClient({
  tenant: "acme",
  email: "ops@acme.com",
  password: "•••",
  // baseUrl defaults to the dev-cluster gateway; override for anything else
});
```

### 2. Push a message into a channel (trigger a workflow)

```ts
import { ChannelResolutionError, IngestError } from "@yoizen/platform-sdk";

try {
  const result = await client.webhooks.ingest({
    tenant: "acme",
    channel: "http", // or "telegram", ...
    instance: "my-http-instance", // optional: pins to one channel account
    headers: { "x-http-channel-token": appSecret }, // provider-specific auth, if any
    body: { from: "customer@example.com", text: "hello" },
  });
  // result.status === "accepted" — the message was published; any workflow
  // trigger listening on this channel fires asynchronously from here.
} catch (err) {
  if (err instanceof ChannelResolutionError) {
    // no active account for this channel/instance — provision one first
  } else if (err instanceof IngestError) {
    // platform accepted the request but rejected the payload — see err.ingestStatus
  } else {
    throw err;
  }
}
```

### 3. Run an agent directly and wait for the reply

```ts
const { executionId } = await client.runtime.createExecution({
  agentId: "agent-123",
  message: "What's my order status?",
  conversationId: "conv-1",
  channel: "sample",
});

let status;
do {
  await new Promise((r) => setTimeout(r, 2000));
  status = await client.runtime.getExecution(executionId);
} while (status.state !== "completed" && status.state !== "failed");

console.log(status.result.reply);
```

### 4. Monitor an execution live (streaming, no polling)

```ts
for await (const event of client.runtime.stream({
  agentId: "agent-123",
  message: "hello",
})) {
  if (event.type === "token") process.stdout.write(event.data.delta);
  if (event.type === "completed" || event.type === "failed") break;
}
```

### 5. Execute a workflow directly and monitor it

```ts
// idempotencyKey matters here: workflows.execute is a POST, and POSTs are NOT
// retried by default (see "Retry & backoff" below). Without it, a retried or
// duplicated call risks starting the same workflow twice. With it, a repeat
// call is a safe no-op — check `alreadyStarted` to tell the two apart.
const { executionId, alreadyStarted } = await client.workflows.execute(
  workflowId,
  { request: { text: "hello" } }, // becomes ctx.request in the workflow's actions
  { idempotencyKey: "my-own-unique-id-for-this-request" }
);

let status;
do {
  await new Promise((r) => setTimeout(r, 2000));
  status = await client.workflows.getExecution(workflowId, executionId);
} while (status.status !== "completed" && status.status !== "failed");

console.log(status.result ?? status.failure);
```

These three "run" paths are independent of each other:

- **Channel message** (`webhooks.ingest`) — fire-and-forget; fires whatever workflow trigger
  listens on that channel.
- **Workflow, direct** (`workflows.execute` + `workflows.getExecution`) — skip the channel,
  run one workflow definition by id, poll its own execution status.
- **Agent, direct** (`runtime.createExecution`/`stream`) — skip workflows, run one agent turn.

All three can throw a typed `SdkError` subclass — see "Error taxonomy" below before assuming a
`catch` block only needs to handle the specific errors shown above.

## Configuration

All options for `createClient(config)`, verified against `src/infrastructure/config.ts` and
`src/core/*`. Explicit args take precedence over environment variables.

| Option | Type | Env var | Default | Description |
| --- | --- | --- | --- | --- |
| `tenant` | `string` (required) | `YOIZEN_TENANT` | — | Tenant id; sent as `x-yoizen-tenant` on every request |
| `email` | `string` (required) | `YOIZEN_EMAIL` | — | Login email (`POST /api/auth/login`) |
| `password` | `string` (required) | `YOIZEN_PASSWORD` | — | Login password |
| `baseUrl` | `string` | `YOIZEN_BASE_URL` | `http://api-gateway.platform-services-dev.dev.local` | api-gateway origin; trailing slashes stripped |
| `apiVersion` | `"v1" \| null` | — | `"v1"` | Path-prefix selector: `"v1"` → `/api/v1/...` (live on every route family, verified 2026-07-05), `null` → `/api/...` (deprecated unversioned alias, see [Semver & compatibility](#semver--compatibility)) |
| `timeoutMs` | `number` | — | `10000` | Per-request timeout (overridable per call) |
| `retry` | `RetryConfig \| false` | — | method-based default | Client-level retry policy; `false` disables retries entirely (see [Retry & backoff](#retry--backoff)) |
| `tokenExpiryBufferMs` | `number` | — | `60000` | Refresh the access token this many ms before its real expiry |
| `onWarn` | `(msg: string) => void` | — | — | Called when the token's scoped tenant differs from the configured `tenant` |
| `defaultFrom` | `string` | `YOIZEN_DEFAULT_FROM` | the login `email` | Fallback `from` for `send`/`sendText` |
| `appSecret` | `string \| null` | `YOIZEN_HTTP_CHANNEL_TOKEN` | auto-resolved | http-channel ingest secret; when set, skips the channel-directory lookup |
| `channelSelector` | `{ name?; externalId? }` | — | first active http account | Pins a specific http channel account for `send`/`sendText` |
| `instance` | `string \| null` | `YOIZEN_HTTP_CHANNEL_INSTANCE` | resolved `externalId` | Targets a per-instance ingest URL (`/api/webhooks/http/{tenant}/{instance}`) |
| `fetch` | `typeof fetch` | — | `globalThis.fetch` | Injectable for tests |
| `clock` | `{ now(): number }` | — | system clock | Injectable for tests |

Session behavior (`src/core/session.ts`): login is lazy (first authenticated call), the token
is cached and refreshed with the expiry buffer, a rejected refresh falls back to a full
relogin, and concurrent callers share a single in-flight token request.

## Resource clients

`createClient()` returns `{ send, sendText }` plus one namespace per resource. All resource
clients share a single authenticated transport (`Authorization: Bearer`, `x-yoizen-tenant`,
`x-request-id` injected automatically). Method one-liners below; **full request/response types
live in each resource's `types.ts`** — the linked file is the source of truth for the TYPES.

> **Do not trust those files' deploy-status prose.** Five resources —
> `registry`, `agents`, `structured-kb`, `config-files`, `channels` — still carry
> "404s on the dev cluster" / "PENDING DEPLOY" / "not confirmed live" header comments for
> fixes that `test/e2e/` now hard-asserts as live (see "Known platform gaps" below). The
> e2e suite is the current record; those comments are a month stale and are tracked as a
> known inconsistency (`DOCS/archive/audits/DOCS-TRUTH-LEDGER.md`, escalation E16). `skills/types.ts` and
> `jobs/types.ts` show what a reconciled header looks like.

### workflows — [`src/resources/workflows/types.ts`](./src/resources/workflows/types.ts)

- `create` — create a workflow definition
- `update` — full-replace update (PUT)
- `list` — list workflows (bare array today, single page)
- `get` — fetch one workflow by id
- `remove` — soft-delete a workflow
- `execute` — start a Temporal-backed execution (202 Accepted)
- `listExecutions` — list executions (real `page`/`pageSize` pagination)
- `getExecution` — fetch one execution
- `executionCounts` — tenant-wide execution counts grouped by definition
- `executionsByCorrelation` — tenant-wide trace lookup by correlation id
- `summary` — tenant-wide aggregate stats (active/failing definitions, 7d/24h execution counts, top definitions)

### agents — [`src/resources/agents/types.ts`](./src/resources/agents/types.ts)

- `create` / `update` / `list` / `get` / `remove` — agent CRUD (`list` uses `limit`/`offset`)
- `publish` / `unpublish` — snapshot / revert published state
- `listVersions` / `rollbackToVersion` / `deleteVersion` — version history management
- `updateEnabledTools` / `updateEnabledMcpServers` / `updateEnabledMcpTools` / `updateToolDescriptionOverrides` — config patches
- `revert` — discard the draft and restore the last published snapshot
- `listMemoryProposals` / `approveMemoryProposal` / `rejectMemoryProposal` — memory-proposals sub-resource

### runtime — [`src/resources/runtime/types.ts`](./src/resources/runtime/types.ts)

- `createExecution` — start an agent runtime execution (202 Accepted)
- `getExecution` — fetch execution status/result
- `health` — public health check
- `stream` — combined submit+stream: `POST runtime/executions/stream`, yields
  `started` → (`token` | `tool_call` | `tool_result`)* → (`completed` | `failed`)
  as an async iterable (see "Runtime streaming" below)

#### Runtime streaming

```ts
for await (const event of client.runtime.stream({ agentId, message: "hi" })) {
  if (event.type === "token") process.stdout.write(event.data.delta);
  if (event.type === "completed" || event.type === "failed") break; // also the natural end
}
```

`failed` is a normal terminal event, not a thrown error — the iterator just ends after
yielding it. Pass `{ signal }` (an `AbortSignal`) to cancel a stream at any point; the
iterator ends cleanly (no throw) on abort.

There is no server-side `capabilities.streaming` flag to probe in advance, so `stream()`
degrades via 404/405 detection on the stream route itself: if the platform (or an older
gateway) doesn't support streaming, `stream()` throws `SdkError` with
`code: "streaming_unsupported"`. Callers that want automatic degradation should catch it and
fall back to `createExecution()` + poll `getExecution()`:

```ts
try {
  for await (const event of client.runtime.stream(input)) { /* ... */ }
} catch (err) {
  if (err instanceof SdkError && err.code === "streaming_unsupported") {
    const { executionId } = await client.runtime.createExecution(input);
    // poll client.runtime.getExecution(executionId) until a terminal state
  } else {
    throw err;
  }
}
```

### channels — [`src/resources/channels/types.ts`](./src/resources/channels/types.ts)

- `createAccount` / `listAccounts` / `getAccount` / `updateAccount` / `removeAccount` — account CRUD
- `sendMessage` — send an outbound (egress) message on an account
- `createAutoReplyRule` / `listAutoReplyRules` / `removeAutoReplyRule` — auto-reply rules
- `listStreams` / `streamMessages` — NATS stream inspection
- `listUsage` / `listUsageTotals` — usage event buckets / totals over a time range
- `usageSummary` — 24h rolling total + per-channel breakdown

### webhooks — [`src/resources/webhooks/types.ts`](./src/resources/webhooks/types.ts)

- `ingest` — publish a webhook ingress payload for any channel (`/api/webhooks/:channel/:tenant[/:instance]`; public route, caller supplies tenant + auth headers)

### knowledgeBases — [`src/resources/knowledge-bases/types.ts`](./src/resources/knowledge-bases/types.ts)

- `create` / `list` / `get` / `update` / `remove` — KB CRUD
- `documents.list` / `documents.get` / `documents.remove` — document management
- `documents.listChunks` / `documents.updateChunk` — chunk inspection/editing (real `page`/`limit` pagination)
- `documents.upload` / `documents.uploadFile` — ingest content (`uploadFile` is base64-in-JSON, not multipart)
- `documents.reingest` — reprocess a document

Quirks: `list()` pagination params are ignored downstream; `get`/`update` return `null`
instead of 404 for missing ids.

### skills — [`src/resources/skills/types.ts`](./src/resources/skills/types.ts)

- `create` / `list` / `get` / `update` / `remove` — skill CRUD

`update()` used to 500 on every payload (a `postgres.js` fragment-join bug in
`agent-admin-service`'s `SkillsService.update`). Fixed and confirmed live 2026-07-05 — the
e2e suite now hard-asserts the persisted update (`test/e2e/admin-resources.e2e.ts`), with no
tolerant branch left.

### systemVariables — [`src/resources/system-variables/types.ts`](./src/resources/system-variables/types.ts)

- `create` / `list` / `get` / `update` / `remove` — system-variable CRUD

`create()` used to double-JSON-encode a scalar `value` (a `::jsonb` cast in
`agent-admin-service`'s `SystemVariablesService.create`) while `update()` — a different
code path — was already correct. Fixed and confirmed live 2026-07-05; the e2e suite
hard-asserts `created.value === "hello"` (`test/e2e/admin-resources.e2e.ts`).

### mcpServers — [`src/resources/mcp-servers/types.ts`](./src/resources/mcp-servers/types.ts)

- `create` / `list` / `get` / `update` / `remove` — MCP server CRUD (normal REST 404 semantics; `update` is PUT, not PATCH)
- `listTools` — the server's advertised tool list (`GET :id/tools`)
- `testConnection` — probe the server without saving anything (`POST :id/test`)
- `getUsage` — per-server call statistics from the shared `mcp_call_events` table (`GET :id/usage`)

### connectors — [`src/resources/connectors/types.ts`](./src/resources/connectors/types.ts)

- `create` / `list` / `get` / `update` / `remove` — connector CRUD (registry-managed field locks surface as `ConflictError`)
- `usage` — per-connector call statistics
- `addEndpoint` / `updateEndpoint` / `removeEndpoint` — endpoint sub-resource
- `invoke` / `invocations.get` — invoke a connector endpoint from code (sync or async), see below

#### `connectors.invoke()` — call a connector endpoint from code

`connectors.invoke(connectorId, endpointId, args, opts?)` runs the SAME governed pipe
(circuit breaker, response cache, `connector.endpoint_call.completed.v1` audit event) that
workflow `endpointCall` actions use — from hosted-service code, without touching Temporal.
It has two flavors, selected by `opts.mode` (default `"sync"`):

```ts
// Sync (default) — runs inline, returns the HTTP result directly.
const result = await sdk.connectors.invoke("crm-connector", "get-customer", {
  method: "GET",
  params: { id: "123" },
});
// result: { invocationId, status, data, headers, cacheResult }

// Async — 202-accepts and returns only { invocationId }; the connector-runtime
// invoke consumer runs the call, parks the result in Redis, and (if a webhook
// is supplied) POSTs it back. Poll as a fallback.
const { invocationId } = await sdk.connectors.invoke(
  "crm-connector",
  "create-ticket",
  { method: "POST", data: { subject: "..." } },
  {
    mode: "async",
    idempotencyKey: "ticket-create-order-42", // see caveat below
    webhook: { url: "https://hosted-service.example.com/webhooks/invoke", headers: { "x-secret": "..." } },
  }
);

const status = await sdk.connectors.invocations.get(invocationId);
// status.status === "pending" | "completed"; when completed, status.outcome is "ok" | "error"
```

**At-least-once caveat (async only):** delivery of the async invoke request rides NATS
JetStream. If the connector-runtime invoke consumer crashes AFTER making the outbound HTTP
call but BEFORE acking the message, JetStream redelivers and the SAME outbound HTTP call
runs again — this is at-least-once, not exactly-once, by design (see
`manual-loops/connector-invoke-api.md` "User decisions"). Always pass `idempotencyKey` when
the underlying HTTP verb is not naturally idempotent (e.g. `POST` that creates a resource);
the platform does not build exactly-once delivery on your behalf.

**Polling window:** `connectors.invocations.get()` reads the result parked in Redis by the
invoke consumer, TTL default 900s (`INVOCATION_RESULT_TTL_SECONDS`, see
`services/connector-runtime/README.md`). After the TTL, the invocation is indistinguishable
from one that never existed and `invocations.get()` rejects with `NotFoundError` (404) —
poll (or rely on the webhook) well inside that window.

### registry — [`src/resources/registry/types.ts`](./src/resources/registry/types.ts)

- `services.create` / `list` / `get` / `update` / `remove` / `listRevisions` — Knative service registry
- `canary.start` / `update` / `promote` / `rollback` / `getStatus` — canary traffic management
- `routes.create` / `list` / `remove` — per-service route management
- `discoverRoutes` — read-only feed of all registered routes (the gateway's own routing source)

**Caution**: routes and canary operations mutate live, cluster-wide gateway routing/traffic.
`services.update()` right after `create()` used to lose a K8s optimistic-concurrency 409 and
surface as a 500; the server-side retry in `registry-service` was confirmed live 2026-07-05
(three back-to-back create-then-update probes, zero delay, all 200), and the SDK e2e suite's
client-side `withKnativeConflictRetry` workaround was removed.

### authAdmin — [`src/resources/auth-admin/types.ts`](./src/resources/auth-admin/types.ts)

- `users.create` / `users.list` — platform users
- `clients.create` / `clients.list` / `clients.remove` — API clients (`create` returns a one-time `client_secret`)
- `tenantUsers.create` / `list` / `get` / `update` / `remove` — tenant user membership
- `tenantRoles.create` / `list` / `get` / `update` / `remove` — tenant roles + permissions
- `publicRoutes.create` / `list` / `remove` — unauthenticated route bypass registry

### tenants — [`src/resources/tenants/types.ts`](./src/resources/tenants/types.ts)

- `create` — provision a tenant (202 Accepted, async — creates namespaces and DB hosts)
- `list` / `get` — read tenants (`get` accepts name or id)
- `update` / `remove` — resolve by **name only**; `update` takes a full configuration object

### audit — [`src/resources/audit/types.ts`](./src/resources/audit/types.ts)

- `events.list` / `events.get` — audit event query/read
- `channelEvents.list` / `channelEvents.get` — channel event query/read

Gap: the chain endpoints (`/audit/events/chain/:correlationId`) exist downstream but are not
proxied. List envelopes carry no `total`, so `hasMore` is a heuristic.

### jobs — [`src/resources/jobs/types.ts`](./src/resources/jobs/types.ts)

- `create` / `list` / `get` / `update` / `remove` — scheduled job CRUD
- `enable` / `disable` — toggle scheduling
- `run` — manual run without payload
- `trigger` — manual run with payload (the gateway maps `payload` to the downstream `event_payload` field; confirmed live 2026-07-05 with the enable-first flow, see `types.ts`)
- `executions.list` — execution history

### memories — [`src/resources/memories/types.ts`](./src/resources/memories/types.ts)

- `create` — propose a memory
- `list` / `listProposals` / `get` — read memories / pending proposals
- `update` — patch a memory (`topicKey` is silently dropped downstream)
- `approve` / `reject` — resolve a proposal (404 if not in PROPOSED state)
- `remove` — delete a memory

### structuredKb — [`src/resources/structured-kb/types.ts`](./src/resources/structured-kb/types.ts)

- `containers.create` / `list` / `get` / `update` / `remove` — structured-KB container CRUD
- `containers.uploadFile` — ingest a tabular file into a container
- `containers.query` — translate a natural-language query to SQL and run it (rate-limited: 30 req/min/tenant)

`containers.query` used to 404 at the gateway; the route was confirmed live 2026-07-05. A
container with no ingested schema still fails downstream with a business-state error (not a
`NotFoundError`) — that is what the e2e asserts.

### configFiles — [`src/resources/config-files/types.ts`](./src/resources/config-files/types.ts)

- `list` / `getByPath` — read config files
- `upsert` — create-or-update a single config file keyed by `path` (`{name,path,content,format}`)
- `deploy` — deploy config files (`deletePaths` removes files from the runtime config set)
- `runtimeStatus` — connected runtime status
- `templates` — list agent templates

The gateway's DTOs for `upsert`/`deploy` were fixed to match the downstream contract and
confirmed live 2026-07-05; the e2e suite hard-asserts the `{name,path,content,format}`
shape (`test/e2e/admin-final.e2e.ts`).

### dashboard — [`src/resources/dashboard/types.ts`](./src/resources/dashboard/types.ts)

- `getStats` — gateway-computed, Redis-cached dashboard stats aggregate (quota "limits" are hardcoded constants, not a real quota system)

### manifests — [`src/resources/manifests/types.ts`](./src/resources/manifests/types.ts)

Declarative provisioning (`manual-loops/declarative-provisioning.md`, full operational
contract: `services/provisioning-service/README.md`): describe a full integration —
channels, connectors, agents, knowledge bases, hosted-service refs, workflows — in ONE
manifest object, then `plan` the diff and `apply` to converge. v1 is create-or-update
only; there is no delete/prune semantics yet.

- `validate(manifest)` — schema + structural-rule validation, never mutates anything. Never
  throws for an invalid manifest — check `result.valid`/`result.errors`.
- `put(name, manifest)` — validates then stores a new revision (revisions are never
  overwritten).
- `get(name)` — fetch the latest stored revision. `NotFoundError` (404) if `name` is unknown.
- `plan(name)` — read-only diff against live platform state: per-resource `create` / `update`
  / `noop`, plus unmet preconditions (missing secrets, unresolvable external refs, KB
  re-embed estimates). `ConflictError` (409) on a dependency cycle.
- `apply(name, opts?)` — executes the latest plan in dependency order. Pass
  `opts.bundle` (raw tar bytes, `Uint8Array`) when the manifest has `file:` knowledge-base
  sources whose content must travel with this call — the client base64-encodes it into the
  JSON body (`{ bundle: { contentBase64 } }`); there is no `multipart/form-data` support yet.
  `NotFoundError` (404, unknown manifest) or `ConflictError` (409, cycle OR a partial-failure
  apply result — `error.details.body.error` carries `applied`/`pending` resources so you can
  re-apply to resume).

**No YAML parsing in this SDK.** `sdk/package.json` has no runtime dependencies (no `yaml`/
`js-yaml`), so every method above takes an ALREADY-PARSED manifest object
(`Record<string, unknown>`), never a YAML string. Parse your `.yaml` file yourself (e.g. with
`js-yaml` in your own project) before calling `validate`/`put`/`apply`.

```ts
import { readFileSync } from "node:fs";
import { load } from "js-yaml"; // your own dependency, not the SDK's

const manifest = load(readFileSync("./support-bot.yaml", "utf8")) as Record<string, unknown>;

const { valid, errors } = await sdk.manifests.validate(manifest);
if (!valid) throw new Error(`invalid manifest: ${JSON.stringify(errors)}`);

await sdk.manifests.put("support-bot", manifest);

// plan BEFORE apply — shows creates/updates/noops and any missing secrets, without touching anything.
const plan = await sdk.manifests.plan("support-bot");
console.log(`will create/update ${plan.resources.filter((r) => r.verdict !== "noop").length} resource(s)`);

const result = await sdk.manifests.apply("support-bot");
console.log(`applied ${result.appliedCount}, noop ${result.noopCount}`);

// Re-running plan/apply on an unchanged manifest is a no-op — idempotent by name/externalId.
const secondPlan = await sdk.manifests.plan("support-bot");
console.log(secondPlan.resources.every((r) => r.verdict === "noop")); // true
```

### secrets — [`src/resources/secrets/types.ts`](./src/resources/secrets/types.ts)

Write-only Secret API backing `manifests`' `secretRef`s (`manual-loops/declarative-provisioning.md`
decision 4, full contract in `services/provisioning-service/README.md` "Secrets model"):
ONE k8s Secret per resource, never a per-tenant bag. No route ever returns a
secret VALUE — `set()` echoes back only `{name, scope}`, `list()` returns names + bindings
only.

- `set(name, value, scope)` — creates/updates a secret bound to `{kind, owner}` (`kind`:
  `channel` | `connector` | `agent` | `service` | `workflow`). Requires the tenant ADMIN scope
  at the gateway — `PermissionError` (403) otherwise.
- `list()` — names + bindings only, tenant-operator level.

```ts
await sdk.secrets.set("telegram-token", process.env.TELEGRAM_BOT_TOKEN!, {
  kind: "channel",
  owner: "telegram-in",
});

const bindings = await sdk.secrets.list();
// [{ name: "telegram-token", scope: { kind: "channel", owner: "telegram-in" } }, ...]
// — never a `value` field, by contract.
```

### send / sendText (message ingest, unchanged since v0.1.0)

- `send(message)` — ingest a message via the http channel (`from`, `text?`, `media?`, `raw?`, ...); resolves only when the platform returns `"accepted"`
- `sendText(text, opts?)` — text-only shorthand

A `signature_mismatch` is retried once with a freshly resolved secret (handles secret
rotation). `IngestError.ingestStatus` carries the platform status string.

## Error taxonomy

Every error extends `SdkError` (`.code`, `.details?`, `.cause?`) — defined in
[`src/domain/errors.ts`](./src/domain/errors.ts). HTTP status mapping happens centrally in the
transport (`src/core/transport.ts`).

| Class | `code` | Triggered by | Notable fields |
| --- | --- | --- | --- |
| `SdkError` | `SDK` / `HTTP` / `NETWORK` | base class; unmapped HTTP statuses and network failures | `details.httpStatus`, `details.body` |
| `ConfigError` | `CONFIG` | missing `tenant`/`email`/`password`, bad `baseUrl`, no `fetch` | `details.missing` |
| `ValidationError` | `VALIDATION` | invalid message input (empty `from`, empty text) | — |
| `AuthError` | `AUTH` | HTTP 401; login/refresh rejected | `details.httpStatus` |
| `PermissionError` | `PERMISSION` | HTTP 403 — authenticated but not authorized | — |
| `NotFoundError` | `NOT_FOUND` | HTTP 404 | — |
| `ConflictError` | `CONFLICT` | HTTP 409 — state conflict (e.g. locked connector fields) | — |
| `RateLimitError` | `RATE_LIMIT` | HTTP 429 | `retryAfterMs` (parsed from `Retry-After`) |
| `ChannelResolutionError` | `CHANNEL_RESOLUTION` | no active http account / no `appSecret` (ingest flow) | — |
| `IngestError` | `INGEST` | ingest failed or platform status ≠ `accepted` | `ingestStatus` |

## Retry & backoff

Implemented in [`src/core/retry.ts`](./src/core/retry.ts):

- **Idempotent-by-default**: retries are ON for `GET`/`PUT`/`DELETE`, OFF for `POST` — unless
  the call passes an `idempotencyKey` (also sent as the `Idempotency-Key` header), which makes
  the POST retryable.
- **What is retried**: network errors (`code: "NETWORK"`) and 5xx responses only. 4xx errors
  (including 429) are never retried automatically.
- **Backoff**: full-jitter exponential (AWS-style) — uniform random delay in
  `[0, min(maxDelayMs, baseDelayMs * 2^attempt)]`.
- **Defaults**: `maxAttempts: 3` (including the first try), `baseDelayMs: 200`,
  `maxDelayMs: 5000`.
- **Configurable at two levels**: `createClient({ retry })` sets the client default;
  per-call `retry` options override it; `false` at either level disables retries.

## Pagination

Implemented in [`src/core/pagination.ts`](./src/core/pagination.ts). Every `list`-style method
returns a `Paginated<T>`:

```ts
// Walk every item across all pages
for await (const wf of client.workflows.list()) { ... }

// Escape hatch: one page at a time, with total/hasMore
const page = await client.agents.list().page({ limit: 20, offset: 40 });
// -> { items, total?, hasMore, nextOffset? }
```

There is no single pagination convention across the gateway today, so each resource adapts:
endpoints with real `limit`/`offset` (agents, jobs) or `page`/`limit` (workflow executions, KB
chunks) paginate for real; endpoints that return bare arrays today (workflows, channel
accounts, connectors, registry services, ...) degrade to a single complete page — the calling
shape is identical either way, so nothing breaks when the gateway adds real pagination later.

## E2E testing

Unit tests (`npm test` → `bun test src/ test/`, 407 tests across 52 files) are fully offline
— mocked transport, no network. The 52 files are the 38 under `test/` plus the **14
co-located `src/cli/**/*.test.ts` specs** (64 tests); the runner is Bun, not tsx — see "Why
Bun runs the unit suite" below. The e2e suite (`test/e2e/`, 9 files, 62 `test()` cases — 9
top-level plus 53 subtests) still runs on tsx, against a **live dev cluster**:

```bash
# From the repo root: expose the gateway on localhost:8080
./port-forward.sh dev

cd sdk
SDK_E2E=1 npm run test:e2e
```

- **`SDK_E2E=1` gates the suite** — without it every e2e test self-skips, so `npm test` and
  CI stay offline-safe.
- **`--test-concurrency=1` is required** (already baked into the `test:e2e` script): the
  gateway enforces a per-tenant rate limit, and concurrent e2e files trip 429s.
- Credentials default to the dev seed tenant (`acme` / `yclawd@demo.io`); base URL resolution
  probes `localhost:8080` then the ingress hostname. Full variable table in
  [`test/e2e/README.md`](./test/e2e/README.md).
- Tests create uniquely-named resources and clean up in `finally` blocks.

### Why Bun runs the unit suite

**Bun is a prerequisite for `npm test`.** The unit suite used to be
`tsx --test 'test/**/*.test.ts'`, a glob that never reached the 14 co-located
`src/cli/**/*.test.ts` specs — the entire `yoizen` CLI, `--secrets-from-env` included, went
untested by its own documented command (escalation E15). Bun discovers both trees with no
glob to keep in sync, and it is the only runner that can execute the CLI specs at all: the
CLI parses manifests with `Bun.YAML.parse` (no YAML dependency — see "CLI" below), so the 10
tests that exercise the real `Bun.YAML` parse — 2 in `src/cli/read-manifest-file.test.ts`
(temp-file manifests under `os.tmpdir()`), all 8 in
`src/cli/manifest-gaps-cli-compat.test.ts` (driving
`test/cli/fixtures/comprehensive-manifest.yaml`) — fail under tsx/Node with the CLI's own
documented error, "requires the Bun runtime to parse YAML manifests". The third test in
`read-manifest-file.test.ts` is runtime-agnostic: it asserts the missing-file path, where
`readFileSync` fails and returns before the Bun guard is reached. Under Bun the whole suite
is 407/407.

**The `src/ test/` scope is deliberate, not decoration.** Bare `bun test` also matches
`dist/**/*.test.js` whenever `npm run build` has run (`tsconfig.json` has `"include": ["src"]`,
so `tsc` emits the CLI specs to `dist/` too). That re-runs all 14 CLI files from stale
compiled output and inflates the tally to 471 tests across 66 files on a built checkout while
reporting 407/52 on a fresh clone. The positional filters `src/` and `test/` match only the
source trees (`dist/cli/run-cli.test.js` contains `test.` but not `test/`), so the count is
deterministic.

**`test:e2e` stays on tsx.** Bun only discovers `.test.`/`_test_`/`.spec.`/`_spec_`
filenames, so it finds none of the `test/e2e/*.e2e.ts` files, and it has no equivalent of the
`--test-concurrency=1` serialization the rate limit requires. Moving it would mean renaming
9 files and changing behavior.

## Known platform gaps

These are **gateway/downstream issues, not SDK bugs** — the SDK deliberately omits or
documents the affected surface rather than encoding broken behavior. Each resource's
`types.ts` carries the verified CONTRACT evidence (exact controllers/files read side by
side) — but see the warning under "Resource clients": five of those files' deploy-status
notes contradict the e2e suite and are stale (escalation E16). See also GROWTH-PLAN.md
Phase 2 acceptance notes.

1. **audit** — chain endpoints (`/audit/events/chain/:correlationId`) not proxied; list
   envelopes carry no `total`. Still open: `services/api-gateway`'s audit module declares only
   `@Get()` and `@Get(":id")` on each of `audit.controller.ts` / `channel-audit.controller.ts`
   — no chain route anywhere. (The `chains/:correlationId` route that does exist belongs to
   the unrelated `tracking` module.) `hasMore` therefore stays a heuristic.

**Closed since this list was written** (kept here because the entries were load-bearing):

- **runtime.stream()** — the "done in the working tree, not committed" half of this gap is
  closed: the platform side is **committed** (commit `4d77d0a`, `git ls-files` confirms all
  three files are tracked) — `RUNTIME_STREAM_SUBJECT_PREFIX`/`buildRuntimeStreamSubject` in
  `@yoizen/shared`, `@Post("stream")` on both `api-gateway`'s and `ai-agent-gateway`'s runtime
  controllers, `pipe-upstream-sse-to-reply.util.ts`, and the mock provider gated by
  `RUNTIME_ALLOW_MOCK_PROVIDER_ENV`. `DOCS/architecture/runtime-streaming.md` reports
  `Status: Implemented`. **What is NOT established here is liveness**: nothing in this repo
  can prove which build the dev cluster's pods are running, and no live probe was performed.
  So `test/e2e/runtime-stream.e2e.ts`'s `streaming_unsupported` probe stays meaningful — run
  it (`SDK_E2E=1 npm run test:e2e`) to find out whether the route answers today. Note that
  suite's own file header still says the platform side is "NOT deployed/committed", which is
  now wrong on the committed half and unverified on the deployed half.
- **channels.usageSummary()** — the downstream SQL was fixed (see CHANGELOG.md, 2026-07-05
  hardening pass). Both `getSummary` and `getSharedSummary` in
  `services/channel-service`'s `usage.postgres.repository.ts` now `SELECT channel, direction,
  count(*)::BIGINT AS events FROM channel_events` — `events` is an ALIAS on `count(*)`, not a
  column read, so the old "references a nonexistent `events` column" diagnosis no longer
  describes the code.

All other previously-listed gaps (`workflows.summary()`, `agents.revert()` /
`listMemoryProposals()` / `approveMemoryProposal()` / `rejectMemoryProposal()`,
`structuredKb.containers.query()`, `configFiles.upsert()`/`deploy()`'s fixed contract,
`jobs.trigger()`'s `payload` mapping, `skills.update()`, `systemVariables.create()`'s
double-encoding, and `registry.services.update()`'s 409-vs-Knative-reconciler race) are
**confirmed fixed and live** on the dev cluster as of the 2026-07-05 hardening pass — see
CHANGELOG.md "Unreleased" and GROWTH-PLAN.md Phase 5 for the live-probe evidence. The
corresponding e2e tests now assert the fixed behavior directly (hard assertions, no more
tolerant try/catch), and the registry e2e suite's client-side `withKnativeConflictRetry`
workaround was removed.

## Semver & compatibility

**The SDK's semver is independent of the platform API version.** SDK versions track the SDK's
own public surface (methods, types, config); the API version the SDK targets is declared here
and selected at runtime via the `apiVersion` config option.

| SDK version | `/api` (unversioned) | `/api/v1` |
| --- | --- | --- |
| `0.1.x` (ingest-only) | ✅ supported | — |
| Unreleased / next (full platform surface) | ✅ opt-in (`apiVersion: null`), deprecated alias | ✅ supported, **default** (`apiVersion: "v1"`) — see note below |

**Current reality of `/api/v1`** (verified against `services/api-gateway/src/main.ts` and a
live probe against the dev cluster on 2026-07-05): the gateway implements URI versioning
(`enableVersioning` with `defaultVersion: ["1", VERSION_NEUTRAL]`), so every route is served
both as `/api/...` (marked deprecated via `Deprecation: true` + `Link: ...;
rel="successor-version"` response headers) and as `/api/v1/...`. OpenAPI is likewise
implemented (Swagger UI at `/api/docs`, JSON at `/api/docs-json` — `src/openapi.config.ts`).
**As of 2026-07-05 this build is confirmed deployed and live on the dev cluster** — every
route family the SDK calls (`auth`, `webhooks`, `workflows`, `admin/agents`, `admin/skills`,
`admin/system-variables`, `admin/config-files`, `admin/structured-kb`, `admin/jobs`,
`channels`, `admin/memories`, `admin/knowledge-bases`, `admin/mcp-servers`, `audit`,
`dashboard`, `tenants`, `registry`, `connectors`) was live-probed under `/api/v1` and
returned success (or a legitimate non-versioning error, e.g. a platform-scope 403). No route
family needed to stay on the unversioned alias, so the SDK's `apiVersion` default is now
`"v1"` (see `src/core/transport.ts` and GROWTH-PLAN.md Phase 5).

Breaking-change policy while `0.x`: minor bumps (`0.1` → `0.2`) may include breaking changes
per semver spec item 4, but the project's own invariant (GROWTH-PLAN.md §2.1) keeps
`createClient` → `{ send, sendText }` and the error classes stable until a major bump is
explicitly decided.

## Samples & examples

Runnable examples live in three tiers, each with one reason to exist:

- [`sdk/examples/`](./examples/README.md) — examples of the SDK itself (this
  package's API surface: auth/config, per-resource CRUD, `connectors.invoke()`,
  pagination, error handling). Imports only `@yoizen/platform-sdk`.
- [`integrations/`](../integrations/README.md) — end-to-end references for a single
  platform feature (channels, AI, HTTP/connectors, MCP), grouped by category and
  provisioned through this SDK.
- [`demos/`](../demos/README.md) — commercial showcases that tell a business story,
  composing several integrations into one narrative.

## CLI: `yoizen` bin

A thin CLI (`bin/yoizen.ts`) wraps `client.manifests`/`client.secrets` for
scripting and README-driven provisioning — no new SDK API surface, just a
command layer over the resource clients above (`manual-loops/samples-reorg.md`
decision 9).

```bash
cd sdk && bun link   # one-time; exposes `yoizen` on PATH
# or, without linking:
cd sdk && bun run bin/yoizen.ts <command>
```

> Requires the **Bun** runtime — the CLI parses YAML with Bun's built-in
> `Bun.YAML.parse` rather than adding a `js-yaml` dependency, so plain `node`
> cannot run it.

### Subcommands

```bash
yoizen manifests validate -f <file>                 # schema + structural checks only, never mutates
yoizen manifests plan     -f <file>                 # read-only diff; prints a KIND/NAME/VERDICT table
yoizen manifests apply    -f <file> [--secrets-from-env]
yoizen secrets put <name> --scope <kind>:<owner> --value-env <VAR>
```

### Config resolution

Identical to `createClient()` above — same env vars, same precedence
(`YOIZEN_TENANT`, `YOIZEN_EMAIL`, `YOIZEN_PASSWORD`, `YOIZEN_BASE_URL`, ...).
The CLI does not duplicate that logic; it just calls `createClient()` with no
arguments.

### `--secrets-from-env`

Reads the manifest's `secrets` bindings, takes each VALUE from the
environment, `client.secrets.set()`s it, then applies — secret values never
touch disk or argv. Each binding resolves from the env var named exactly
like the binding (`telegram-bot-token`) or, as a fallback, its UPPER_SNAKE
form (`TELEGRAM_BOT_TOKEN`) — so a plain shell export works:

```bash
export TELEGRAM_BOT_TOKEN='123456:ABC-your-bot-token'
yoizen manifests apply -f manifest.yaml --secrets-from-env
```

Missing env vars fail fast, listing both accepted spellings of every
missing binding.

`yoizen secrets put` is the equivalent one-off command outside a manifest
apply: it reads the value from the env var named by `--value-env` and is
never logged.

## Development

```bash
cd sdk
npm install        # dev deps only (typescript, tsx, @types/node)
npm run build      # tsc — strict typecheck + emit dist/ (ESM + .d.ts)
npm test           # unit tests via bun (offline, 407 tests across 52 files) — needs Bun
npm run test:e2e   # live-cluster e2e via tsx (requires SDK_E2E=1, see above)
```

Layout: `src/domain` (pure value objects + errors), `src/application` (ingest use case +
ports), `src/infrastructure` (fetch wrapper, adapters, config, composition root),
`src/core` (session, transport, retry, pagination — shared by all resource clients),
`src/resources/<name>/` (`types.ts` + `client.ts` + `index.ts` per resource),
`src/cli/` + `bin/yoizen.ts` (the CLI layer). Tests mirror `src/` 1:1 under `test/`, with
one exception: the CLI's own 14 specs are co-located as `src/cli/**/*.test.ts`.

> **Caveat**: `npm test`'s glob is `test/**/*.test.ts`, so those 14 co-located CLI specs are
> **not** run by it. `bun test` (which discovers every `*.test.ts`) does run them — mind the
> difference before trusting a green `npm test` on a CLI change.
