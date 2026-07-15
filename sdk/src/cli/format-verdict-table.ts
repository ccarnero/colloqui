/** One row of `plan`/`apply`'s printed per-resource verdict table. */
export interface VerdictRow {
  kind: string;
  name: string;
  verdict: string;
}

/**
 * Formats `plan`/`apply`'s per-resource verdict table. This output is Gate
 * G5's assertion source (`manual-loops/samples-reorg.md`), so the literal
 * words `create`/`update`/`noop` MUST appear verbatim, tab-separated, one
 * resource per line — stable and trivially greppable
 * (`grep -E "create|update|noop"`). Do not add ANSI color codes or reflow
 * this table; downstream gates parse it as plain text.
 */
export function formatVerdictTable(rows: VerdictRow[]): string {
  const header = ["KIND", "NAME", "VERDICT"].join("\t");
  const lines = rows.map((row) => [row.kind, row.name, row.verdict].join("\t"));
  return [header, ...lines].join("\n");
}
