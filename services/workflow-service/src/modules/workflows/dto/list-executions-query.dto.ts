/**
 * Pagination + sort query for `GET /workflows/:id/executions`.
 *
 * The workflow-service bootstraps with `withValidationPipe: false`
 * (see `services/workflow-service/src/main.ts`), so we coerce + clamp
 * here without paying the cost of `class-validator` reflection.
 *
 * Fast path is O(1): a few string→int parses, a clamp, and a strict
 * `"asc"|"desc"` whitelist match.
 */

export type ExecutionsSortDirection = "asc" | "desc";

export interface IListExecutionsQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: ExecutionsSortDirection;
}

export const LIST_EXECUTIONS_DEFAULT_PAGE = 1;
export const LIST_EXECUTIONS_DEFAULT_PAGE_SIZE = 20;
export const LIST_EXECUTIONS_MAX_PAGE_SIZE = 100;
export const LIST_EXECUTIONS_DEFAULT_SORT: ExecutionsSortDirection = "desc";

const parsePositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/**
 * Parses + clamps an arbitrary query bag into the strict shape the
 * service expects. Unknown / invalid values fall back to defaults.
 */
export function parseListExecutionsQuery(
  query: Record<string, unknown> | undefined,
): IListExecutionsQuery {
  const page = parsePositiveInt(query?.page, LIST_EXECUTIONS_DEFAULT_PAGE);
  const rawPageSize = parsePositiveInt(
    query?.pageSize,
    LIST_EXECUTIONS_DEFAULT_PAGE_SIZE,
  );
  const pageSize = Math.min(rawPageSize, LIST_EXECUTIONS_MAX_PAGE_SIZE);
  const sortRaw = typeof query?.sort === "string" ? query.sort : "";
  const sort: ExecutionsSortDirection =
    sortRaw === "asc" ? "asc" : LIST_EXECUTIONS_DEFAULT_SORT;
  return { page, pageSize, sort };
}
