import type { IMcpServer } from "../../../core/models/agent.model";
import type { AgentAdminService } from "../../../core/services/agent-admin.service";
import type { IMcpServerDialogResult } from "../../../shared/components/mcp-server-dialog/mcp-server-dialog.types";

/**
 * Builds the PATCH payload for an MCP server edit.
 *
 * Mirrors `mcp-servers-page.component.ts`'s `openEdit()` payload mapping
 * (duplicated per T03 scope constraints — this folder only). Managed
 * servers omit registry-owned fields (name/transport_type/url) since the
 * backend rejects them with a 409 (mcp-connections.md §2.3).
 */
export function buildMcpServerUpdatePayload(
  server: IMcpServer,
  result: IMcpServerDialogResult
): Parameters<AgentAdminService["updateMcpServer"]>[1] {
  const editable: Parameters<AgentAdminService["updateMcpServer"]>[1] = {
    description: result.description ?? null,
    headers: result.headers ?? null,
    authType: result.authType,
    authConfig: result.authConfig ?? null,
    enabled: result.enabled,
    scope: result.scope,
  };

  if (server.managed_by) {
    return editable;
  }

  return {
    ...editable,
    name: result.name,
    transport_type: result.transport_type,
    url: result.url,
  };
}
