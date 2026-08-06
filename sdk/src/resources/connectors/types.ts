/**
 * Request/response types for the `connectors` resource, hand-typed against
 * the REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 5):
 *
 * - `services/api-gateway/src/modules/connectors/connectors.controller.ts` +
 *   `connectors.dto.ts` define the gateway-side routes and validation
 *   (`ConnectorsProxyService` forwards verbatim JSON to `connector-admin`).
 * - `services/connector-admin/src/modules/adapters/adapters.controller.ts` +
 *   `adapters.service.ts` + `adapters.dto.ts` + `adapters.repository.interface.ts`
 *   (`mapAdapter`/`mapEndpoint`) define the actual persisted shape. Despite
 *   the gateway's public `/connectors` path, the downstream module/service/
 *   repository are all named "adapters" — connectors ARE adapters.
 *
 * Known gaps (SDK talks only to the gateway, GROWTH-PLAN.md invariant 5):
 * - Downstream `ListAdaptersQueryDto` supports a `name` exact-match filter
 *   (used internally by `AdapterClient.findInternalByServiceId()`), but the
 *   gateway's `ConnectorsController.list()` only forwards `context` and
 *   `tag` query params — no `name` filter reaches the client. Not exposed
 *   here; filter client-side if needed.
 * - Downstream `list()` accepts `limit`/`offset` (`clampListLimit`/
 *   `clampListOffset`) and could paginate, but the gateway controller never
 *   forwards them (no query params declared besides `context`/`tag`) — the
 *   client always gets the full set as a bare array. `listAdapters()` is
 *   degraded to a single page via `toSinglePage()` (see
 *   `src/core/pagination.ts`, which documents this same gap).
 *
 * Behavioral notes (not gaps, but load-bearing for callers):
 * - Endpoint uniqueness is `(method, path)` per adapter, not a nested id
 *   alone — `POST :id/endpoints` 409s (`ConflictError`) on a duplicate pair.
 * - Adapters with a non-null `managedBy` (synced from the registry-service
 *   internal-adapter mirror) reject edits to `name`/`baseUrl`/
 *   `healthCheckPath`/`status` with a structured 409 body
 *   (`reason: "MANAGED_ADAPTER"`) and reject `remove()` entirely — both
 *   surface as `ConflictError`, `error.details.body` carries the structured
 *   payload (`lockedFields`/`editableFields`).
 * - `getUsage()` 503s (`ServiceUnavailableException` -> generic `SdkError`,
 *   `code: "HTTP"`) when the usage-metrics repository isn't configured for
 *   the environment (e.g. dev without the shared TimescaleDB usage cluster).
 */

export type ConnectorContext = "internal" | "external";
export type ConnectorAuthType = "none" | "api-key" | "bearer" | "basic";
export type ConnectorStatus = "enabled" | "disabled";
export type ConnectorCacheMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE";

export interface ConnectorHeaderEntry {
  key: string;
  value: string;
}

/** Mirrors `CacheStrategyDto` (gateway) / `AdapterCacheStrategy` (downstream). */
export interface ConnectorCacheStrategy {
  enabled: boolean;
  ttlSeconds: number;
  methods?: ConnectorCacheMethod[];
  keyHeaders?: string[];
  /** `"all"` or an explicit allowlist of query param names. */
  keyQueryParams?: string[] | "all";
  keyBody?: boolean;
}

/** `POST /connectors/:id/endpoints` body (mirrors `CreateEndpointDto`). */
export interface CreateConnectorEndpointInput {
  label: string;
  method: string;
  path: string;
  cache?: ConnectorCacheStrategy;
}

/** `PATCH /connectors/:id/endpoints/:epId` body (mirrors `UpdateEndpointDto`). */
export interface UpdateConnectorEndpointInput {
  label?: string;
  method?: string;
  path?: string;
  cache?: ConnectorCacheStrategy | null;
}

/** Response shape for a connector endpoint (`mapEndpoint` in `adapters.repository.interface.ts`). */
export interface ConnectorEndpoint {
  id: string;
  adapterId: string;
  label: string;
  method: string;
  path: string;
  cache: ConnectorCacheStrategy | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * `POST /connectors` body (mirrors `CreateAdapterDto`). Note: the gateway's
 * own DTO marks `baseUrl` `@IsOptional()`, but the downstream
 * `connector-admin` `CreateAdapterDto` requires it (`@IsUrl @IsNotEmpty`) —
 * omitting it passes gateway validation and then 400s downstream. Typed as
 * required here to match the real (downstream) contract.
 */
export interface CreateConnectorInput {
  name: string;
  context: ConnectorContext;
  baseUrl: string;
  authType?: ConnectorAuthType;
  authConfig?: Record<string, unknown>;
  headers?: ConnectorHeaderEntry[];
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  tags?: string[];
  endpoints?: CreateConnectorEndpointInput[];
  defaultCache?: ConnectorCacheStrategy;
}

/** `PATCH /connectors/:id` body (mirrors `UpdateAdapterDto`). */
export interface UpdateConnectorInput {
  name?: string;
  baseUrl?: string;
  authType?: ConnectorAuthType;
  authConfig?: Record<string, unknown>;
  headers?: ConnectorHeaderEntry[];
  timeoutMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  healthCheckPath?: string;
  status?: ConnectorStatus;
  tags?: string[];
  defaultCache?: ConnectorCacheStrategy | null;
}

/** Response shape for connector create/get/list/update (`mapAdapter` + nested `endpoints`). */
export interface Connector {
  id: string;
  tenantId: string;
  name: string;
  context: ConnectorContext;
  baseUrl: string;
  authType: string;
  authConfig: Record<string, unknown>;
  headers: ConnectorHeaderEntry[];
  defaultCache: ConnectorCacheStrategy | null;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  healthCheckPath: string;
  status: string;
  isEncrypted: boolean;
  tags: string[];
  /** Non-null when synced from a registered service (registry-service internal mirror). */
  managedBy: string | null;
  endpoints: ConnectorEndpoint[];
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

export interface ListConnectorsParams {
  context?: ConnectorContext;
  tag?: string;
}

/** Query for `GET /connectors/usage` (mirrors gateway `window` query param, days). */
export interface ConnectorUsageParams {
  /** Rolling window in days; downstream defaults to 7 when omitted. */
  window?: number;
}

/** One row of `GET /connectors/usage` (`IAdapterUsageRow`). */
export interface ConnectorUsageRow {
  adapterId: string;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  avgDurationMs: number;
  cacheHits: number;
}

/** `GET /connectors/usage` response envelope. */
export interface ConnectorUsageResult {
  windowDays: number;
  topByCallCount: ConnectorUsageRow[];
}

/**
 * Types for `connectors.invoke()` / `connectors.invocations.get()`
 * (`manual-loops/connector-invoke-api.md` T06), hand-typed against the REAL
 * gateway + downstream shapes:
 *
 * - Gateway routes: `POST /connectors/:connectorId/endpoints/:endpointId/invoke`
 *   and `GET /connectors/invocations/:invocationId`
 *   (`services/api-gateway/src/modules/connector-invoke/`), verbatim JSON +
 *   status passthrough to connector-runtime's HTTP facade.
 * - Facade: `services/connector-runtime/src/lib/http-facade/handle-invoke-request.ts`
 *   (sync/async) and `handle-get-invocation-request.ts` (polling), body
 *   shapes mirrored 1:1 below.
 * - `IHttpCallResult` (`services/connector-runtime/src/activities/_shared/http-call-with-retry.ts`)
 *   is the sync/completed-async result shape (`status`/`data`/`headers`/`cacheResult`).
 *
 * Load-bearing behavioral notes:
 * - **At-least-once for async.** The `mode: "async"` request travels over
 *   NATS JetStream to a durable consumer; if the consumer dies between
 *   running the call and acking the message, JetStream redelivers and the
 *   OUTBOUND HTTP call to the connector's endpoint can be repeated. This is
 *   an accepted platform tradeoff (SPEC.md "User decisions" — no
 *   exactly-once). Pass `idempotencyKey` whenever the underlying endpoint
 *   verb is NOT naturally idempotent (`POST`, non-idempotent `PATCH`, etc.)
 *   so a redelivery-driven retry is safe on the callee's side; the facade
 *   also reuses the SAME `idempotencyKey` as the JetStream dedup key
 *   (`Nats-Msg-Id`), so a caller-side retry of the SDK call itself (e.g.
 *   after a network timeout) collapses onto the same invocation instead of
 *   double-publishing.
 * - **Webhook is caller-supplied, SSRF-restricted.** `webhook.url` is
 *   validated by the facade at request time (`validate-outbound-url.ts`) —
 *   private/loopback/link-local/cloud-metadata targets are rejected with a
 *   400 before the invocation is even accepted. `webhook.headers` travel
 *   verbatim to the delivery POST (hop-by-hop headers are stripped by the
 *   facade). Webhook delivery failure never blocks result availability —
 *   `invocations.get()` still returns the result until the polling TTL
 *   expires (see below).
 * - **Polling TTL default 15m.** The async result (or `pending` marker) is
 *   parked in Redis with a TTL — 900s (15 minutes) unless the platform
 *   operator configured a different `resultTtlSeconds` on the facade. After
 *   the TTL, `invocations.get()` returns `status: "expired"` (404) even for
 *   a real invocationId that already completed — poll before the window
 *   closes, or rely on the webhook for delivery instead.
 */

/** `invoke()`'s `args` param — the endpoint call itself (mirrors `EndpointCallArgs` minus `adapterId`/`endpointId`, which come from the method's own `connectorId`/`endpointId` params). */
export interface ConnectorInvokeArgs {
  method: string;
  /** Optional; only meaningful when the connector has no matching endpoint route (adapter-base call). Usually omitted — the endpoint's configured path is used. */
  url?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

/** Caller-supplied webhook target for async invoke result delivery. SSRF-validated server-side — see `types.ts` doc comment above. */
export interface ConnectorInvokeWebhookTarget {
  url: string;
  headers?: Record<string, string>;
}

/** `invoke()` options. Defaults to `mode: "sync"` when omitted. */
export interface ConnectorInvokeOptions {
  mode?: "sync" | "async";
  /**
   * Caller-supplied dedup key. Reused for BOTH JetStream dedup (`mode:
   * "async"`) and as the audit `invocationId` (both modes) — see the
   * at-least-once doc comment above. Required in practice for any
   * non-idempotent underlying HTTP verb.
   */
  idempotencyKey?: string;
  /** `mode: "async"` only; ignored (and never sent) for `mode: "sync"`. */
  webhook?: ConnectorInvokeWebhookTarget;
}

/** The underlying HTTP call's result — mirrors `IHttpCallResult` (downstream). */
export interface ConnectorInvokeHttpResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  cacheResult?: "hit" | "miss" | "bypass" | null;
}

/** `POST .../invoke` response for `mode: "sync"` (200) — the facade's `{ invocationId, ...IEndpointCallResult }`. */
export interface ConnectorSyncInvokeResult extends ConnectorInvokeHttpResult {
  invocationId: string;
}

/** `POST .../invoke` response for `mode: "async"` (202) — `{ invocationId }` only; poll `invocations.get(invocationId)` or wait for the webhook. */
export interface ConnectorAsyncInvokeAccepted {
  invocationId: string;
}

/** `GET .../invocations/:invocationId` response (200) — still queued. */
export interface ConnectorInvocationPending {
  invocationId: string;
  status: "pending";
}

/** `GET .../invocations/:invocationId` response (200) — the consumer finished; `outcome: "error"` still 200s here (the HTTP-level failure is data, not a transport error). */
export interface ConnectorInvocationCompleted {
  invocationId: string;
  status: "completed";
  outcome: "ok" | "error";
  result?: ConnectorInvokeHttpResult;
  error?: { kind: string; message: string };
}

/** Union of every `invocations.get()` success shape. A 404 (unknown/expired — see polling TTL doc comment above) is thrown as `NotFoundError`, not part of this union. */
export type ConnectorInvocationStatus =
  | ConnectorInvocationPending
  | ConnectorInvocationCompleted;
