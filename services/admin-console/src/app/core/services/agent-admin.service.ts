import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { environment } from "../../../environments/environment";
import {
  buildCreateAgentPayload,
  type IAgent,
  type IAgentDraft,
  type IAgentListQuery,
  type IAgentListResponse,
  type IAgentMemory,
  type IAgentMemoryCreatePayload,
  type IAgentMemoryListResponse,
  type IAgentMemoryQuery,
  type IAgentMemoryUpdatePayload,
  type IAgentVersion,
  type IBuiltinTool,
  type IMcpServer,
  type IMcpServerTool,
  type IMcpTestConnectionResult,
  type IMcpUsage,
  type ITemplate,
  type McpServerAuthType,
  type McpServerScope,
} from "../models/agent.model";
import { ResourceMutationsService } from "./metrics/resource-mutations.service";

type QueryValue = string | number | boolean;

const BASE_URL = `${environment.apiUrl}/admin`;

function buildQueryParams(query?: IAgentListQuery): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (!query) {
    return params;
  }

  if (query.limit !== undefined) {
    params["limit"] = query.limit;
  }

  if (query.offset !== undefined) {
    params["offset"] = query.offset;
  }

  if (query.status !== undefined) {
    params["status"] = query.status;
  }

  if (query.is_active !== undefined) {
    params["is_active"] = query.is_active;
  }

  return params;
}

function buildMemoryQueryParams(
  query?: IAgentMemoryQuery
): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (!query) {
    return params;
  }

  if (query.scope !== undefined) {
    params["scope"] = query.scope;
  }
  if (query.kind !== undefined) {
    params["kind"] = query.kind;
  }
  if (query.status !== undefined) {
    params["status"] = query.status;
  }
  if (query.search !== undefined) {
    params["search"] = query.search;
  }
  if (query.limit !== undefined) {
    params["limit"] = query.limit;
  }
  if (query.offset !== undefined) {
    params["offset"] = query.offset;
  }
  if (query.includeExpired !== undefined) {
    params["includeExpired"] = query.includeExpired;
  }
  if (query.sessionId !== undefined) {
    params["sessionId"] = query.sessionId;
  }
  if (query.userId !== undefined) {
    params["userId"] = query.userId;
  }
  if (query.context !== undefined) {
    params["context"] = query.context;
  }

  return params;
}

@Injectable({ providedIn: "root" })
export class AgentAdminService {
  private readonly http = inject(HttpClient);
  private readonly mutations = inject(ResourceMutationsService);

  /**
   * Retrieves the current agent catalog for the active tenant.
   *
   * @param query - Optional filter and pagination parameters.
   * @returns A stream of paginated agent data.
   */
  listAgents(query?: IAgentListQuery): Observable<IAgentListResponse> {
    return this.http.get<IAgentListResponse>(`${BASE_URL}/agents`, {
      params: buildQueryParams(query),
    });
  }

  // ============================================================================
  // Agent APIs
  // ============================================================================

  /**
   * Creates a AI agent using the MVP form contract.
   *
   * @param draft - UI form data for the new agent.
   * @returns A stream with the created agent record.
   */
  createAgent(draft: IAgentDraft): Observable<IAgent> {
    const payload = buildCreateAgentPayload(draft);
    return this.http
      .post<IAgent>(`${BASE_URL}/agents`, payload)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  publishAgent(agentId: string): Observable<IAgent> {
    return this.http.post<IAgent>(`${BASE_URL}/agents/${agentId}/publish`, {});
  }

  /**
   * Unpublishes a AI agent (reverts to draft status).
   *
   * @param agentId - The agent to unpublish.
   * @returns A stream with the unpublished agent record.
   */
  unpublishAgent(agentId: string): Observable<IAgent> {
    return this.http.post<IAgent>(
      `${BASE_URL}/agents/${agentId}/unpublish`,
      {}
    );
  }

  /**
   * Reverts a published agent's draft to the last published snapshot.
   *
   * @param agentId - The agent to revert.
   * @returns A stream with the reverted agent record.
   */
  revertToPublished(agentId: string): Observable<IAgent> {
    return this.http.post<IAgent>(`${BASE_URL}/agents/${agentId}/revert`, {});
  }

  /**
   * Retrieves a specific agent by ID.
   *
   * @param agentId - The agent ID to retrieve.
   * @returns A stream with the agent record.
   */
  getAgent(agentId: string): Observable<IAgent> {
    return this.http.get<IAgent>(`${BASE_URL}/agents/${agentId}`);
  }

  /**
   * Updates an existing AI agent.
   *
   * @param agentId - The agent to update.
   * @param draft - UI form data with updates.
   * @returns A stream with the updated agent record.
   */
  updateAgent(agentId: string, draft: IAgentDraft): Observable<IAgent> {
    const payload = buildCreateAgentPayload(draft);
    return this.http.put<IAgent>(`${BASE_URL}/agents/${agentId}`, payload);
  }

  /**
   * Soft-deletes an agent.
   *
   * @param agentId - The agent to delete.
   * @returns A completion stream (HTTP 204).
   */
  deleteAgent(agentId: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE_URL}/agents/${agentId}`)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Retrieves available agent templates.
   *
   * @returns A stream with the list of templates.
   */
  listTemplates(): Observable<{ templates: ITemplate[] }> {
    return this.http.get<{ templates: ITemplate[] }>(`${BASE_URL}/templates`);
  }

  // ============================================================================
  // Memory APIs (agent-memory-service)
  // ============================================================================

  listMemories(
    query?: IAgentMemoryQuery
  ): Observable<IAgentMemoryListResponse> {
    return this.http.get<IAgentMemoryListResponse>(`${BASE_URL}/memories`, {
      params: buildMemoryQueryParams(query),
    });
  }

  getMemory(id: string): Observable<IAgentMemory> {
    return this.http.get<IAgentMemory>(`${BASE_URL}/memories/${id}`);
  }

  createMemory(payload: IAgentMemoryCreatePayload): Observable<IAgentMemory> {
    return this.http
      .post<IAgentMemory>(`${BASE_URL}/memories`, payload)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  updateMemory(
    id: string,
    payload: IAgentMemoryUpdatePayload
  ): Observable<IAgentMemory> {
    return this.http
      .patch<IAgentMemory>(`${BASE_URL}/memories/${id}`, payload)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  approveMemory(id: string): Observable<IAgentMemory> {
    return this.http
      .patch<IAgentMemory>(`${BASE_URL}/memories/${id}/approve`, {})
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  rejectMemory(id: string): Observable<IAgentMemory> {
    return this.http
      .patch<IAgentMemory>(`${BASE_URL}/memories/${id}/reject`, {})
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  deleteMemory(id: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE_URL}/memories/${id}`)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  // ============================================================================
  // Built-in Tools APIs
  // ============================================================================

  /**
   * Retrieves the list of available built-in tools from agent-ai-service.
   *
   * @returns A stream with the list of built-in tool definitions.
   */
  listBuiltinTools(): Observable<IBuiltinTool[]> {
    return this.http.get<IBuiltinTool[]>(`${BASE_URL}/tools/builtins`);
  }

  /**
   * Updates the enabled_tools list for an agent.
   * Pass null to enable all built-in tools (default behavior).
   *
   * @param agentId - The agent to update.
   * @param enabledTools - Array of enabled tool names, or null for all.
   * @returns A stream with the updated agent record.
   */
  updateEnabledTools(
    agentId: string,
    enabledTools: string[] | null
  ): Observable<IAgent> {
    return this.http
      .patch<IAgent>(`${BASE_URL}/agents/${agentId}/tools`, {
        enabled_tools: enabledTools,
      })
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Updates tool description overrides for an agent.
   * Pass null to clear all overrides (use default descriptions).
   *
   * @param agentId - The agent to update.
   * @param overrides - Map of tool name → description, or null to clear.
   * @returns A stream with the updated agent record.
   */
  updateToolDescriptionOverrides(
    agentId: string,
    overrides: Record<string, string> | null
  ): Observable<IAgent> {
    return this.http
      .patch<IAgent>(`${BASE_URL}/agents/${agentId}/tool-descriptions`, {
        tool_description_overrides: overrides,
      })
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  // ============================================================================
  // MCP Server APIs
  // ============================================================================

  /**
   * Lists all MCP servers for the tenant.
   */
  listMcpServers(): Observable<IMcpServer[]> {
    return this.http.get<IMcpServer[]>(`${BASE_URL}/mcp-servers`);
  }

  /**
   * Gets a single MCP server by ID.
   */
  getMcpServer(id: string): Observable<IMcpServer> {
    return this.http.get<IMcpServer>(`${BASE_URL}/mcp-servers/${id}`);
  }

  /**
   * Creates a new MCP server.
   *
   * NOTE: `authType`/`authConfig` are camelCase here even though the
   * response body (`IMcpServer`) uses snake_case `auth_type`/`auth_config`
   * — this mirrors `CreateMcpServerDto` in `agent-admin-service`, which
   * accepts camelCase auth fields but persists/returns the entity as-is.
   */
  createMcpServer(data: {
    name: string;
    description?: string;
    transport_type: "http" | "sse";
    url: string;
    headers?: Record<string, string>;
    authType?: McpServerAuthType;
    authConfig?: Record<string, unknown>;
    enabled?: boolean;
    scope?: McpServerScope;
  }): Observable<IMcpServer> {
    return this.http
      .post<IMcpServer>(`${BASE_URL}/mcp-servers`, data)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Updates an existing MCP server. Same camelCase auth-field note as
   * {@link createMcpServer} applies here.
   */
  updateMcpServer(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      transport_type?: "http" | "sse";
      url?: string;
      headers?: Record<string, string> | null;
      authType?: McpServerAuthType;
      authConfig?: Record<string, unknown> | null;
      enabled?: boolean;
      scope?: McpServerScope;
    }
  ): Observable<IMcpServer> {
    return this.http
      .patch<IMcpServer>(`${BASE_URL}/mcp-servers/${id}`, data)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Deletes an MCP server (soft-delete).
   */
  deleteMcpServer(id: string): Observable<void> {
    return this.http
      .delete<void>(`${BASE_URL}/mcp-servers/${id}`)
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Lists the tools exposed by a live MCP server
   * (`GET admin/mcp-servers/:id/tools`, mcp-connections.md §2.4). This is a
   * live probe against the MCP server itself — call on-demand (e.g. when a
   * row expands), never for every row on page load.
   */
  listMcpServerTools(id: string): Observable<IMcpServerTool[]> {
    return this.http.get<IMcpServerTool[]>(
      `${BASE_URL}/mcp-servers/${id}/tools`
    );
  }

  /**
   * Runs a live connectivity probe against an MCP server
   * (`POST admin/mcp-servers/:id/test`, mcp-connections.md §2.2). No
   * persistence side-effect — `is_active` stays an explicit admin toggle.
   */
  testMcpServer(id: string): Observable<IMcpTestConnectionResult> {
    return this.http.post<IMcpTestConnectionResult>(
      `${BASE_URL}/mcp-servers/${id}/test`,
      {}
    );
  }

  /**
   * Usage summary + recent calls for the MCP detail page's Overview cards
   * and "Recent calls" section (`GET admin/mcp-servers/:id/usage`,
   * mcp-connections.md §3, §6.3). `windowDays` mirrors the connector usage
   * endpoint's `window` query param (days, default 7 server-side).
   */
  getMcpServerUsage(id: string, windowDays?: number): Observable<IMcpUsage> {
    return this.http.get<IMcpUsage>(`${BASE_URL}/mcp-servers/${id}/usage`, {
      params: windowDays ? { window: windowDays } : {},
    });
  }

  /**
   * Updates the enabled_mcp_servers list for an agent.
   * The list is keyed by MCP server NAME (not id) — `tool-bridge.service.ts`'s
   * `mergeMcpTools()` filters the runtime's name-keyed connected-server map,
   * matching `enabled_mcp_tools`'s server-name keying below.
   * Pass null to enable all MCP servers.
   */
  updateEnabledMcpServers(
    agentId: string,
    enabledMcpServers: string[] | null
  ): Observable<IAgent> {
    return this.http
      .patch<IAgent>(`${BASE_URL}/agents/${agentId}/mcp-servers`, {
        enabled_mcp_servers: enabledMcpServers,
      })
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  /**
   * Updates the per-tool MCP allowlist for an agent
   * (`PATCH admin/agents/:id/mcp-tools`, mcp-connections.md §4). The map is
   * keyed by MCP server name; a `null` value for a server means "all tools
   * from that server enabled". Pass `null` to clear all per-tool filtering.
   */
  updateEnabledMcpTools(
    agentId: string,
    enabledMcpTools: Record<string, string[] | null> | null
  ): Observable<IAgent> {
    return this.http
      .patch<IAgent>(`${BASE_URL}/agents/${agentId}/mcp-tools`, {
        enabled_mcp_tools: enabledMcpTools,
      })
      .pipe(tap(() => this.mutations.notify("ai")));
  }

  // ============================================================================
  // Version History APIs
  // ============================================================================

  /**
   * Lists all published versions for an agent.
   *
   * @param agentId - The agent whose versions to list.
   * @returns A stream with the list of version snapshots.
   */
  listVersions(agentId: string): Observable<IAgentVersion[]> {
    return this.http.get<IAgentVersion[]>(
      `${BASE_URL}/agents/${agentId}/versions`
    );
  }

  /**
   * Rolls an agent back to a specific version snapshot.
   *
   * @param agentId - The agent to rollback.
   * @param versionId - The version to rollback to.
   * @returns A stream with the restored agent record.
   */
  rollbackToVersion(agentId: string, versionId: string): Observable<IAgent> {
    return this.http.post<IAgent>(
      `${BASE_URL}/agents/${agentId}/versions/${versionId}/rollback`,
      {}
    );
  }

  /**
   * Deletes a specific version snapshot.
   *
   * @param agentId - The agent the version belongs to.
   * @param versionId - The version to delete.
   * @returns A completion stream (HTTP 204).
   */
  deleteVersion(agentId: string, versionId: string): Observable<void> {
    return this.http.delete<void>(
      `${BASE_URL}/agents/${agentId}/versions/${versionId}`
    );
  }
}
