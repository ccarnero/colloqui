import type { Tool } from "ai";
import { jsonSchema } from "ai";

/**
 * Reference to an adapter + endpoint resolved via connector-admin.
 */
export interface AdapterReference {
  readonly adapterId: string;
  readonly endpointId: string;
}

/**
 * Reference to a tool exposed by a connected MCP server (mcp-connections.md §4).
 * Parallel to {@link AdapterReference}. Used to give MCP tools a stable,
 * addressable identity (`"<serverName>:<toolName>"`) for per-tool filtering
 * and description overrides — execution still flows through the AI SDK's own
 * `Tool.execute`, not through the tool executor.
 */
export interface McpReference {
  readonly serverName: string;
  readonly toolName: string;
}

/**
 * Definition of a tool available to agents.
 *
 * Tools can be:
 * - **builtin**: executed directly via a handler function (communicate, resource)
 * - **adapter**: executed via HTTP through connector-admin adapter resolution
 * - **custom**: any other registered tool
 */
export interface ToolDef {
  /** Unique identifier for the tool */
  readonly name: string;
  /** Description shown to the LLM during tool selection */
  readonly description: string;
  /** JSON Schema describing the tool's input parameters */
  readonly inputSchema: Record<string, unknown>;
  /** If this tool is backed by an adapter, the adapter reference */
  readonly adapterRef?: AdapterReference;
  /**
   * If this tool is exposed by a connected MCP server, the MCP reference
   * (mcp-connections.md §4). Parallel to {@link adapterRef}. When set, the
   * tool's `name` is namespaced as `"<serverName>:<toolName>"`.
   */
  readonly mcpRef?: McpReference;
  /**
   * If this is an adapter tool, the endpoint path within the adapter.
   * @deprecated Use adapterRef instead for new tools.
   */
  readonly endpoint?: string;
  /** Whether this is a builtin tool (executed locally) */
  readonly builtin?: boolean;
  /** Tool does not modify state (read-only) */
  readonly readOnly?: boolean;
  /** Maximum output characters before truncation */
  readonly maxOutputChars?: number;
}

/**
 * Result returned from tool execution.
 */
export interface ToolResult {
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
}

/**
 * Runtime state passed to tool executors containing tenant and execution context.
 */
export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly sessionId?: string;
  readonly userId?: string;
  /**
   * Conversation id for this chat turn, when known (metering-foundation.md
   * G5). Threaded into MCP call usage events as `correlationId` — nullable
   * since not every caller (e.g. non-conversational chat requests) has one.
   */
  readonly conversationId?: string;
}

/**
 * Internal representation of a registered tool including its handler.
 * Builtin tools have a direct handler; adapter tools use the adapter executor.
 */
export interface RegisteredTool {
  readonly definition: ToolDef;
  readonly handler?: ToolHandler;
}

/**
 * Handler function for builtin tools.
 */
export type ToolHandler = (
  params: Record<string, unknown>,
  state: ToolExecutionContext
) => Promise<ToolResult> | ToolResult;

/**
 * Convert a ToolDef to a Vercel AI SDK Tool definition for LLM calls.
 */
export function toolDefToVercelTool(def: ToolDef): Tool {
  return {
    description: def.description,
    inputSchema: jsonSchema(def.inputSchema),
  };
}
