import type { Db, MongoClient } from "@yoizen/database";
import type { Sql } from "postgres";

/**
 * Bun `mock` from `bun:test` — typed loosely so this package stays test-runner agnostic.
 */
type BunMock = (impl?: (...args: unknown[]) => unknown) => unknown;

export type MockMongoCollectionHandler = (
  operation: string,
  args: readonly unknown[],
) => Promise<unknown> | unknown;

export interface IMockMongoCollection {
  findOne: (...args: unknown[]) => Promise<unknown>;
  find: (...args: unknown[]) => {
    sort: (...sortArgs: unknown[]) => {
      toArray: () => Promise<unknown[]>;
      project: (...projectArgs: unknown[]) => {
        toArray: () => Promise<unknown[]>;
      };
    };
    toArray: () => Promise<unknown[]>;
    project: (...projectArgs: unknown[]) => {
      toArray: () => Promise<unknown[]>;
    };
  };
  insertOne: (...args: unknown[]) => Promise<unknown>;
  insertMany: (...args: unknown[]) => Promise<unknown>;
  updateOne: (...args: unknown[]) => Promise<unknown>;
  deleteOne: (...args: unknown[]) => Promise<unknown>;
  deleteMany: (...args: unknown[]) => Promise<unknown>;
  aggregate: (...args: unknown[]) => { toArray: () => Promise<unknown[]> };
}

/**
 * Builds a mock MongoDB collection whose operations delegate to `handler`.
 */
export function createMockMongoCollection(
  handler: MockMongoCollectionHandler,
  mock: BunMock,
): IMockMongoCollection {
  const findResult = (args: readonly unknown[]) => ({
    sort: mock((...sortArgs: unknown[]) => ({
      toArray: mock(() => Promise.resolve(handler("find", [...args, ...sortArgs]))),
      project: mock((...projectArgs: unknown[]) => ({
        toArray: mock(() =>
          Promise.resolve(handler("find", [...args, ...sortArgs, ...projectArgs])),
        ),
      })),
    })),
    toArray: mock(() => Promise.resolve(handler("find", args))),
    project: mock((...projectArgs: unknown[]) => ({
      toArray: mock(() =>
        Promise.resolve(handler("find", [...args, ...projectArgs])),
      ),
    })),
  });

  return {
    findOne: mock((...args: unknown[]) =>
      Promise.resolve(handler("findOne", args)),
    ),
    find: mock((...args: unknown[]) => findResult(args)),
    insertOne: mock((...args: unknown[]) =>
      Promise.resolve(handler("insertOne", args)),
    ),
    insertMany: mock((...args: unknown[]) =>
      Promise.resolve(handler("insertMany", args)),
    ),
    updateOne: mock((...args: unknown[]) =>
      Promise.resolve(handler("updateOne", args)),
    ),
    deleteOne: mock((...args: unknown[]) =>
      Promise.resolve(handler("deleteOne", args)),
    ),
    deleteMany: mock((...args: unknown[]) =>
      Promise.resolve(handler("deleteMany", args)),
    ),
    aggregate: mock((...args: unknown[]) => ({
      toArray: mock(() => Promise.resolve(handler("aggregate", args))),
    })),
  };
}

/**
 * Creates a mock {@link MongoClient} backed by per-collection handlers.
 */
export function createMockMongoClient(
  collections: ReadonlyMap<string, MockMongoCollectionHandler>,
  mock: BunMock,
  databaseName = "yoizen",
): MongoClient {
  const db = {
    collection: (name: string) => {
      const handler =
        collections.get(name) ??
        ((_operation: string, _args: readonly unknown[]) => null);
      return createMockMongoCollection(handler, mock);
    },
    client: {
      startSession: mock(() => ({
        withTransaction: mock(
          async (fn: (session: unknown) => Promise<void>) => {
            await fn({});
          },
        ),
        endSession: mock(() => Promise.resolve()),
      })),
    },
  };

  return {
    db: (name?: string) => (name === undefined || name === databaseName ? db : db),
  } as unknown as MongoClient;
}

/**
 * Creates a mock tenant {@link Db} with optional per-collection handlers.
 */
export function createMockTenantDb(
  collections: ReadonlyMap<string, MockMongoCollectionHandler>,
  mock: BunMock,
): Db {
  return createMockMongoClient(collections, mock).db("yoizen");
}

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
