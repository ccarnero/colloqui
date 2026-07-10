// Pure splitter: turns the raw text of a `.sql` DDL file into the ordered list
// of executable statements. Strips `--` line comments first, then splits on the
// top-level `;`. The tracked-events DDL contains no procedural bodies (no
// functions / DO blocks with embedded `;`), so a plain `;`-split is safe and
// deliberately kept simple — this is NOT a general SQL parser.
//
// Kept separate from `apply-schema.ts` so both the runnable script and the
// idempotency spec load the exact same statements from the exact same file.

/**
 * Splits raw `.sql` file text into trimmed, executable statements.
 *
 * @param sqlText raw contents of a `.sql` file
 * @returns statements in file order, comments stripped, empties removed
 */
export function loadSchemaStatements(sqlText: string): string[] {
  const withoutComments = sqlText
    .split("\n")
    .map((line) => {
      const commentStart = line.indexOf("--");
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
