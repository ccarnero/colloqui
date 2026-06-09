import { jsonSchema } from "ai";
import type { Tool } from "ai";

/**
 * Reference to an adapter + endpoint resolved via connector-admin.
 */
export interface AdapterReference {
  readonly adapterId: string;
  readonly endpointId: string;
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
  state: ToolExecutionContext,
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
