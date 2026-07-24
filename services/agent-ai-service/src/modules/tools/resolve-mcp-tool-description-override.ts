/**
 * Looks up an MCP tool's description override by its sanitized
 * `"<serverName>__<toolName>"` key (agent-mcp-tool-naming.md T01, Option B —
 * single global identity, no legacy-form fallback: the measured live
 * migration surface on the dev tenant was 0 colon-keyed entries, so there is
 * nothing to bridge — see the SPEC's Progress log). An empty-string override
 * is treated as "no override" (explicit empty is not distinguishable from
 * absent at this layer).
 */
export function resolveMcpToolDescriptionOverride(
  overrides: Record<string, string> | null | undefined,
  key: string
): string | undefined {
  const description = overrides?.[key];
  return typeof description === "string" && description.length > 0
    ? description
    : undefined;
}
