import type {
  IMcpServer,
  McpServerAuthType,
  McpServerScope,
} from "../../../core/models/agent.model";

/** Scope options for the MCP server dialog — external (default) vs internal (in-cluster). */
export const MCP_SCOPE_LABELS: ReadonlyMap<McpServerScope, string> = new Map([
  ["external", "External"],
  ["internal", "Internal (in-cluster)"],
]);

export function mcpScopeOptions(): {
  value: McpServerScope;
  label: string;
}[] {
  return [...MCP_SCOPE_LABELS.entries()].map(([value, label]) => ({
    value,
    label,
  }));
}

/** Auth type options for the MCP server dialog — none/api-key/bearer/basic only (no oauth2, mcp-connections.md §0.4). */
export const MCP_AUTH_TYPE_LABELS: ReadonlyMap<McpServerAuthType, string> =
  new Map([
    ["none", "None"],
    ["api-key", "API Key"],
    ["bearer", "Bearer Token"],
    ["basic", "Basic Auth"],
  ]);

export function mcpAuthTypeOptions(): {
  value: McpServerAuthType;
  label: string;
}[] {
  return [...MCP_AUTH_TYPE_LABELS.entries()].map(([value, label]) => ({
    value,
    label,
  }));
}

export interface IMcpServerDialogData {
  mode: "create" | "edit";
  server?: IMcpServer;
}

/** Values the dialog hands back on close; the caller maps this to the create/update payload. */
export interface IMcpServerDialogResult {
  name: string;
  description?: string;
  transport_type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  authType: McpServerAuthType;
  authConfig?: Record<string, unknown>;
  enabled: boolean;
  scope: McpServerScope;
}
