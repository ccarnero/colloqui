import { createHash } from "node:crypto";

/**
 * Resolves a collision-free key for a merged MCP tool.
 *
 * agent-mcp-tool-naming.md T01 — two distinct addressing pairs can sanitize
 * to the same string (e.g. server names `srv.a` and `srv a` both fold to
 * `srva` once illegal characters are stripped), or a sanitized MCP tool name
 * can collide with an agent-defined tool of the same name. In either case
 * the colliding entry must NOT
 * silently overwrite (or be dropped in favor of) the existing one — a short
 * deterministic disambiguator (6 hex chars of a SHA-256 of the ORIGINAL,
 * pre-sanitization addressing key) is appended so both entries stay present
 * and addressable, and the caller logs both colliding addressing keys
 * (verbose logging constraint).
 */
export function disambiguateMcpToolKey(
  sanitizedKey: string,
  existingKeys: ReadonlySet<string>,
  addressingKey: string
): string {
  if (!existingKeys.has(sanitizedKey)) {
    return sanitizedKey;
  }
  const suffix = createHash("sha256")
    .update(addressingKey)
    .digest("hex")
    .slice(0, 6);
  return `${sanitizedKey}__${suffix}`;
}
