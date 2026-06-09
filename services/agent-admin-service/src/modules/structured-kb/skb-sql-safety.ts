/**
 * SQL safety utilities for the SKB query pipeline.
 *
 * These pure functions validate and sanitize LLM-generated SQL
 * to prevent injection and destructive queries.
 */

const BLOCKED_KEYWORDS = [
  "DELETE",
  "INSERT",
  "UPDATE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "REPLACE",
];

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function hasBlockedKeyword(sql: string): boolean {
  for (const kw of BLOCKED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(sql)) return true;
  }
  return false;
}

function hasSemicolon(sql: string): boolean {
  return sql.includes(";");
}

function hasUnion(sql: string): boolean {
  return /\bUNION\b/i.test(sql);
}

function hasLineComment(sql: string): boolean {
  return sql.includes("--");
}

function hasBlockComment(sql: string): boolean {
  return sql.includes("/*");
}

function hasPgCatalog(sql: string): boolean {
  return /\bpg_catalog\b/i.test(sql);
}

function hasInformationSchema(sql: string): boolean {
  return /\binformation_schema\b/i.test(sql);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `false` if the string contains any dangerous SQL pattern.
 * Safe for use on WHERE clause fragments or full SQL strings.
 */
export function isSafe(sql: string): boolean {
  if (hasBlockedKeyword(sql)) return false;
  if (hasSemicolon(sql)) return false;
  if (hasUnion(sql)) return false;
  if (hasLineComment(sql)) return false;
  if (hasBlockComment(sql)) return false;
  if (hasInformationSchema(sql)) return false;
  if (hasPgCatalog(sql)) return false;
  return true;
}

/**
 * Ensures the SQL string is a SELECT-only query.
 * Throws if it contains any DDL or DML keywords.
 */
export function validateSelectOnly(sql: string): void {
  const trimmed = sql.trim();

  // Also reject if any blocked keyword is present
  if (hasBlockedKeyword(trimmed)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
}

/**
 * Ensures the WHERE clause fragment does not contain dangerous patterns.
 * Throws on stacked queries, UNION, comments, pg_catalog, etc.
 */
export function validateWhereClause(sql: string): void {
  if (hasSemicolon(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasUnion(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasLineComment(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasBlockComment(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasPgCatalog(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasInformationSchema(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
  if (hasBlockedKeyword(sql)) {
    throw new Error("SQL safety violation: potentially dangerous pattern detected");
  }
}

/**
 * Adds or caps the LIMIT clause in a SQL query.
 * - If no LIMIT is present, `LIMIT <maxLimit>` is appended (before OFFSET if present).
 * - If LIMIT exceeds `maxLimit`, it is capped.
 * - If LIMIT is within bounds, it is preserved.
 *
 * @param sql      SQL SELECT query
 * @param maxLimit Maximum allowed limit (default 100, max 1000)
 */
export function enforceLimit(sql: string, maxLimit: number = DEFAULT_LIMIT): string {
  const cap = Math.min(maxLimit, MAX_LIMIT);

  const limitRe = /\blimit\s+(\d+)\b/i;
  const match = sql.match(limitRe);

  if (!match) {
    // No LIMIT clause — add one
    const offsetRe = /\boffset\s+(\d+)\b/i;
    const offsetMatch = sql.match(offsetRe);
    if (offsetMatch) {
      return sql.replace(offsetRe, `LIMIT ${cap} OFFSET $1`);
    }
    return `${sql} LIMIT ${cap}`;
  }

  const existingLimit = parseInt(match[1], 10);
  if (existingLimit > cap) {
    return sql.replace(limitRe, `LIMIT ${cap}`);
  }

  return sql;
}

/**
 * Removes characters that are dangerous or invalid in SQL identifiers.
 */
export function sanitizeIdentifier(name: string): string {
  return name
    .replace(/'/g, "")
    .replace(/;/g, "")
    .replace(/--/g, "")
    .replace(/`/g, "")
    .replace(/\0/g, "");
}
