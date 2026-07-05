/**
 * Request/response types for the `mcpServers` resource (`admin/mcp-servers`),
 * hand-typed against the REAL gateway + downstream shapes (verified
 * 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2):
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
 * Known gap: `PUT /admin/mcp-servers/:id`, not `PATCH` — verified directly
 * against `AdminMcpServersController.updateMcpServer` (`@Put(":id")`) and
 * the downstream `McpServersController.update` (`@Put(":id")`), both
 * consistently `PUT`, unlike every other resource's `PATCH :id`. `update()`
 * still accepts a partial input (all fields optional, same as
 * `UpdateMcpServerDto`) even though the HTTP verb is `PUT` — the downstream
 * repository does a partial `SET` (see `mcp-servers.postgres.repository.ts`),
 * so a full-replace body isn't actually required despite the verb.
 *
 * `GET /admin/mcp-servers` forwards NO query params at all (no `limit`/
 * `offset`, unlike `knowledgeBases`/`skills`/`systemVariables`) and the
 * downstream `findAll` returns a bare array with no `total` — degraded via
 * `toSinglePage()`, matching `channels.listAccounts()`.
 */

export interface McpServer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  enabled: boolean;
  is_active: boolean;
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
  enabled?: boolean;
}

/** `PUT /admin/mcp-servers/:id` body (mirrors `UpdateMcpServerDto`). */
export interface UpdateMcpServerInput {
  name?: string;
  description?: string | null;
  transport_type?: "http" | "sse";
  url?: string;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}
