import type { Sql } from "@yoizen/database";

/**
 * Appends a postgres.js tagged fragment to a dynamic `SET` clause list.
 * Use with `sql.unsafe(composeUpdateSetClause(updates))` in UPDATE statements.
 */
export function appendSqlSetFragment(
  updates: string[],
  assignment: ReturnType<Sql>,
): void {
  updates.push(assignment as unknown as string);
}

/**
 * Joins SET fragments from {@link appendSqlSetFragment} (O(n) in fragment count).
 */
export function composeUpdateSetClause(updates: string[]): string {
  return updates.join(", ");
}

/**
 * Joins WHERE fragments for COUNT + paginated SELECT (O(n) in fragment count).
 */
export function joinDynamicWhereFragments(fragments: string[]): string {
  return fragments.length > 0 ? fragments.join(" AND ") : "1=1";
}
