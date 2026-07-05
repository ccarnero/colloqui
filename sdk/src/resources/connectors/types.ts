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
export type ConnectorAuthType =
  | "none"
  | "api-key"
  | "bearer"
  | "basic"
  | "oauth2-client";
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
