/**
 * Derives an OpenAI-tool-name-safe key for a merged MCP tool.
 *
 * agent-mcp-tool-naming.md T01 (Option B — global separator change; human
 * RULED this over the SPEC's Option-A recommendation, 2026-07-24 Progress
 * log). The colon-joined `"<serverName>:<toolName>"` addressing identity
 * (`tool-definition.ts`'s `McpReference` doc, `tool-bridge.service.ts`'s
 * `mergeMcpTools`) is replaced with `__` (double underscore) EVERYWHERE —
 * this derived string becomes BOTH the merged tool's `tools` record key AND
 * the `name` sent to the LLM (via the AI SDK's `tool()` shape), so it must
 * always satisfy OpenAI's `^[a-zA-Z0-9_-]+$` tool-name pattern.
 *
 * `__` is chosen over a single `_` because server/tool names may already
 * contain a single underscore (e.g. `sample_server`), so `__` remains a
 * syntactically distinguishable joiner without needing a denylist of the
 * character.
 *
 * Neither `serverName` nor `toolName` is guaranteed to be API-safe on its
 * own: MCP server names carry no character-class validation
 * (`mcp-servers.dto.ts`'s `CreateMcpServerDto.name` is `@IsString @Length`
 * only — a name with a space or dot, e.g. `deepwiki.internal`, is legal
 * today) and tool names are whatever the remote MCP server exposes. Every
 * character outside `[a-zA-Z0-9_-]` is stripped after joining so the result
 * always matches the LLM-facing pattern.
 */
export function sanitizeMcpToolKey(
  serverName: string,
  toolName: string
): string {
  return `${serverName}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "");
}
