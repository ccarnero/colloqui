/**
 * `@yoizen/platform-sdk/mcp-servers` — the `mcpServers` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  McpServerCallOptions,
  McpServersClient,
  McpServersClientDeps,
} from "./client.js";
export { createMcpServersClient } from "./client.js";
export type {
  CreateMcpServerInput,
  McpServer,
  McpServerTestConnectionResult,
  McpServerTool,
  McpServerUsage,
  McpServerUsageParams,
  McpServerUsageRecentCall,
  McpServerUsageSummary,
  UpdateMcpServerInput,
} from "./types.js";
