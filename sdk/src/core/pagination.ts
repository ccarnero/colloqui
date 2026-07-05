/**
 * Generic pagination helper. There is NO single pagination convention across
 * the gateway today — verified 2026-07-04 (see sdk/GROWTH-PLAN.md P1.4):
 *
 * - `admin/agents`, `admin/jobs` (api-gateway `admin-agents.controller.ts`,
 *   `admin-jobs.controller.ts`) use `limit`/`offset` query params
 *   (`packages/shared/src/paginated-query.dto.ts`) and the downstream
 *   services (e.g. `agent-admin-service/src/modules/agents/agents.controller.ts`
 *   `listAgents`) respond with an envelope shaped `{ <resource>: T[], total: number }`.
 * - `workflows` (api-gateway `workflows.controller.ts` `GET /workflows` ->
 *   `workflow-service/src/modules/workflows/workflows.controller.ts` `listWorkflows`),
 *   `channels/accounts` (`channels.controller.ts` `GET /channels/accounts`),
 *   `connectors`, and `registry/services` take zero pagination params and
 *   return a bare array — there is nothing to paginate.
 * - One admin sub-route (`admin/knowledge-bases/:id/documents/:id/chunks`)
 *   uses `page`/`limit` instead of `offset`/`limit`, so even the "limit/offset"
 *   convention isn't fully consistent gateway-wide.
 *
 * `paginate()` is written to the REAL `limit`/`offset` + `{ items, total }`
 * convention (the closest thing to a standard, from the admin module) and
 * degrades to a single page via {@link toSinglePage} for endpoints that
 * return a bare array today. Resource clients (Phase 2) adapt their own
 * `fetchPage` to whichever shape their endpoint actually uses.
 */

export interface PageResult<T> {
  items: T[];
  /** Total item count across all pages, when the endpoint reports one. */
  total?: number;
  hasMore: boolean;
  /** Offset to request next; defaults to `offset + items.length` when omitted. */
  nextOffset?: number;
}

export type FetchPage<T> = (params: {
  limit: number;
  offset: number;
}) => Promise<PageResult<T>>;

export interface PaginateOptions {
  /** Page size requested from `fetchPage`. Default 50. */
  pageSize?: number;
  /** Offset to start iterating from. Default 0. */
  startOffset?: number;
}

export interface Paginated<T> extends AsyncIterable<T> {
  /** Escape hatch: fetch a single page directly instead of iterating every item. */
  page(params?: { limit?: number; offset?: number }): Promise<PageResult<T>>;
}

/**
 * `for await (const item of paginate(fetchPage))` walks every page in order,
 * yielding individual items. `.page()` is the escape hatch for callers that
 * want one page (and its `total`/`hasMore`) at a time.
 */
export function paginate<T>(
  fetchPage: FetchPage<T>,
  options: PaginateOptions = {}
): Paginated<T> {
  const pageSize = options.pageSize ?? 50;
  const startOffset = options.startOffset ?? 0;

  async function* iterate(): AsyncGenerator<T> {
    let offset = startOffset;
    for (;;) {
      const result = await fetchPage({ limit: pageSize, offset });
      for (const item of result.items) {
        yield item;
      }
      if (!result.hasMore || result.items.length === 0) {
        break;
      }
      offset = result.nextOffset ?? offset + result.items.length;
    }
  }

  return {
    [Symbol.asyncIterator]: () => iterate(),
    page: (params) =>
      fetchPage({
        limit: params?.limit ?? pageSize,
        offset: params?.offset ?? startOffset,
      }),
  };
}

/**
 * Wraps a bare-array response (today's shape for workflows, channel
 * accounts, connectors, registry services, ...) as a single, complete page —
 * so the same `paginate()` helper works uniformly even where the gateway
 * doesn't paginate yet.
 */
export function toSinglePage<T>(items: T[]): PageResult<T> {
  return { items, total: items.length, hasMore: false };
}

/**
 * Wraps a `limit`/`offset` response into a {@link PageResult}, computing
 * `hasMore` from `total` (the `admin/agents` / `admin/jobs` convention).
 */
export function toOffsetPage<T>(
  items: T[],
  total: number,
  offset: number
): PageResult<T> {
  const nextOffset = offset + items.length;
  return { items, total, hasMore: nextOffset < total, nextOffset };
}
