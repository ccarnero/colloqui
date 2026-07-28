// project-mcp-payload.ts — projects a stored `mcp_call_completed` payload
// (`manual-loops/connectors/connection-call-inspector.md` T03 field shape:
// `mcp-call.activity.ts:339-350` — mcpServerId, serverName, toolName,
// success, durationMs, error?, arguments, result) into the call inspector's
// MCP section (T07). Pure function, no Angular/DOM.

import {
  asBoolean,
  asRecord,
  asScalarString,
  formatJson,
} from "./format-payload-value";

export interface IMcpPayloadProjection {
  readonly toolName: string | null;
  readonly serverName: string | null;
  readonly success: boolean | null;
  readonly durationMs: string | null;
  readonly error: string | null;
  /** Pretty-printed tool call arguments JSON, or `null` when absent. */
  readonly argumentsJson: string | null;
  /** Pretty-printed tool result JSON, or `null` when absent. */
  readonly resultJson: string | null;
}

export function projectMcpPayload(payload: unknown): IMcpPayloadProjection {
  const record = asRecord(payload) ?? {};
  return {
    toolName: asScalarString(record["toolName"]),
    serverName: asScalarString(record["serverName"]),
    success: asBoolean(record["success"]),
    durationMs: asScalarString(record["durationMs"]),
    error: asScalarString(record["error"]),
    argumentsJson: formatJson(record["arguments"]),
    resultJson: formatJson(record["result"]),
  };
}
