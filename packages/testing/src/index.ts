import type { Sql } from "postgres";

/**
 * Bun `mock` from `bun:test` — typed loosely so this package stays test-runner agnostic.
 */
type BunMock = (impl?: (...args: unknown[]) => unknown) => unknown;

/**
 * postgres.js mock that dequeues row batches per tagged-template invocation.
 */
export function createQueuedSql(rowsQueue: unknown[][], mock: BunMock): Sql {
  const fn = mock(() => {
    const next = rowsQueue.shift();
    return Promise.resolve(next ?? []);
  });
  return Object.assign(fn, {
    json: (v: unknown) => v,
    unsafe: mock(() => Promise.resolve([])),
  }) as unknown as Sql;
}

/**
 * Simple postgres.js mock returning the same row set for every query.
 */
export function createMockPostgresSql(mock: BunMock, defaultRows: unknown[] = []): Sql {
  const fn = mock((..._args: unknown[]) => Promise.resolve(defaultRows));
  return fn as unknown as Sql;
}
