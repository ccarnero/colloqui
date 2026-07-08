/**
 * Request/response types for the `mcpServers` resource (`admin/mcp-servers`),
 * hand-typed against the REAL gateway + downstream shapes (verified
 * 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2; auth/managed/tools fields
 * added 2026-07-06 per DOCS/architecture/mcp-connections.md Phase 1):
 *
 * - `services/api-gateway/src/modules/admin/admin-mcp-servers.controller.ts`
 *   (`AdminMcpServersController`, raw passthrough proxy via
 *   `AdminProxyService`) + `admin.dto.ts` for the gateway's own validation
 *   DTOs (`CreateMcpServerDto`, `UpdateMcpServerDto`, `McpServerIdParamDto`).
 * - `services/agent-admin-service/src/modules/mcp-servers/mcp-servers.controller.ts`
 *   + `mcp-servers.service.ts` + `mcp-servers.repository.interface.ts`
 *   (`IMcpServer`) for the real validated/persisted shape — implemented in
 *   `agent-admin-service`, NOT a separate service (verified by grep: no
 *   other service under `services/` defines an `admin/mcp-servers` route).
 *
 * Unlike `knowledgeBases`/`skills`/`systemVariables`, this resource has
 * normal REST semantics end-to-end: `McpServersService.findById`/`update`/
 * `delete` all explicitly throw `NotFoundException` (mapped to a real HTTP
 * 404) when the id doesn't exist — no `null`-instead-of-404 gap here.
 *
 * `update()` now uses `PATCH /admin/mcp-servers/:id`, not `PUT` — the verb
 * mismatch flagged in mcp-connections.md §2.1 was fixed on both
 * `AdminMcpServersController.updateMcpServer` and the downstream
 * `McpServersController.update` in the same change, so this SDK is no
 * longer an outlier vs every other resource's `PATCH :id`. `update()` still
 * accepts a partial input (all fields optional, same as
 * `UpdateMcpServerDto`) — the downstream repository does a partial `SET`
 * (see `mcp-servers.postgres.repository.ts`).
 *
 * `GET /admin/mcp-servers` forwards NO query params at all (no `limit`/
 * `offset`, unlike `knowledgeBases`/`skills`/`systemVariables`) and the
 * downstream `findAll` returns a bare array with no `total` — degraded via
 * `toSinglePage()`, matching `channels.listAccounts()`.
 *
 * `authConfig`'s shape depends on `authType` and is NOT validated per-shape
 * downstream (same as `adapters`' `authConfig`): `{ headerName?, key }` for
 * `api-key`, `{ token }` for `bearer`, `{ username, password }` for `basic`.
 * `managedBy`/`managedLockedFields` are read-only from this client's
 * perspective — settable only via an internal repository/service path, never
 * through `CreateMcpServerInput`/`UpdateMcpServerInput`.
 */

export interface McpServer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  authType: "none" | "api-key" | "bearer" | "basic";
  authConfig: Record<string, unknown> | null;
  enabled: boolean;
  is_active: boolean;
  managedBy: string | null;
  managedLockedFields: string[] | null;
  /** ISO-8601 timestamp (serialized `Date`). */
  created_at: string;
  /** ISO-8601 timestamp (serialized `Date`). */
  updated_at: string;
}

/** `POST /admin/mcp-servers` body (mirrors `CreateMcpServerDto`). */
export interface CreateMcpServerInput {
  name: string;
  description?: string;
  transport_type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  authType?: "none" | "api-key" | "bearer" | "basic";
  authConfig?: Record<string, unknown>;
  enabled?: boolean;
}

/** `PATCH /admin/mcp-servers/:id` body (mirrors `UpdateMcpServerDto`). */
export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  transport_type?: "http" | "sse";
  url?: string;
  headers?: Record<string, string> | null;
  authType?: "none" | "api-key" | "bearer" | "basic";
  authConfig?: Record<string, unknown> | null;
  enabled?: boolean;
}

/** `GET /admin/mcp-servers/:id/tools` entry — one MCP tool as returned by the server's own `tools/list`. */
export interface McpServerTool {
  name: string;
  description: string | null;
  inputSchema: unknown;
}

/**
 * `POST /admin/mcp-servers/:id/test` response — live connectivity probe, no
 * request body, no persistence side-effect (`is_active` is never derived
 * from this). `toolCount` is only populated for `transport_type: "http"`
 * (the probe also does a single `tools/list` call there); for `"sse"` the
 * probe stops at "handshake opened", so `toolCount` stays `undefined`.
 * `error` is only present when `success` is `false`.
 */
export interface McpServerTestConnectionResult {
  success: boolean;
  latencyMs: number;
  toolCount?: number;
  error?: string;
}

/** One row of the "Recent calls" list in `McpServerUsage.recentCalls` (mcp-connections.md §6.3). */
export interface McpServerUsageRecentCall {
  toolName: string;
  success: boolean;
  durationMs: number;
  error: string | null;
  /** ISO-8601 timestamp (serialized `Date`). */
  createdAt: string;
}

/** Aggregate summary over the requested window, mirroring `ConnectorUsageRow`'s shape. */
export interface McpServerUsageSummary {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  avgDurationMs: number;
}

/**
 * `GET /admin/mcp-servers/:id/usage` response (`IMcpUsage`) — usage summary +
 * recent calls for the MCP detail page (mcp-connections.md §3, §6.3),
 * mirroring `GET /connectors/usage`'s response shape.
 */
export interface McpServerUsage {
  windowDays: number;
  summary: McpServerUsageSummary;
  recentCalls: McpServerUsageRecentCall[];
}

/** `GET /admin/mcp-servers/:id/usage` query params. */
export interface McpServerUsageParams {
  /** Day count; invalid/missing falls back to the service's default (7). */
  window?: number;
}
