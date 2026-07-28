// format-payload-value.ts — tiny value formatters shared by the call
// inspector's NON-HTTP projections (MCP/execution/LLM,
// `manual-loops/connectors/connection-call-inspector.md` T07). The HTTP
// projection reuses `project-http-payload.ts` directly (SPEC constraint:
// "REUSE, do not duplicate") — these formatters exist because MCP/
// execution/LLM payloads have no equivalent existing projection to reuse,
// and mirror `project-http-payload.ts`'s own defensive style: every field
// is optional (redaction, truncation, older/newer payload shapes), so each
// is read defensively and simply omitted when absent, never thrown on.

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asScalarString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Pretty-prints an object/array value; passes strings through verbatim
 * (already-serialized payload fields, e.g. a pretty JSON string upstream);
 * `null` when the field is absent/empty. */
export function formatJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  return JSON.stringify(value, null, 2);
}
