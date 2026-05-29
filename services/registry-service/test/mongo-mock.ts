import { mock } from "bun:test";
import type { MongoClient } from "mongodb";

type CollectionMock = {
  findOne: ReturnType<typeof mock>;
  find: ReturnType<typeof mock>;
  insertOne: ReturnType<typeof mock>;
  findOneAndUpdate: ReturnType<typeof mock>;
  deleteOne: ReturnType<typeof mock>;
  deleteMany: ReturnType<typeof mock>;
  aggregate: ReturnType<typeof mock>;
  countDocuments: ReturnType<typeof mock>;
  updateOne: ReturnType<typeof mock>;
};

export function makeCollectionMock(queue: unknown[]): CollectionMock {
  const shift = (): unknown =>
    queue.length > 0 ? queue.shift() : undefined;
  const shiftOne = async (): Promise<unknown> => {
    const next = shift();
    if (next instanceof Error) throw next;
    if (Array.isArray(next)) return next[0] ?? null;
    return next ?? null;
  };
  const shiftMany = async (): Promise<unknown[]> => {
    const next = shift();
    if (next instanceof Error) throw next;
    if (Array.isArray(next)) return next;
    return next ? [next] : [];
  };
  return {
    findOne: mock(shiftOne),
    insertOne: mock(async () => {
      const next = shift();
      if (next instanceof Error) throw next;
      return { acknowledged: true };
    }),
    findOneAndUpdate: mock(async () => shiftOne()),
    deleteOne: mock(async () => {
      const next = shift();
      if (next instanceof Error) throw next;
      return { deletedCount: Number(next ?? 1) };
    }),
    deleteMany: mock(async () => ({ deletedCount: 0 })),
    updateOne: mock(async () => ({ modifiedCount: 1 })),
    countDocuments: mock(async () => {
      const next = await shiftMany();
      return next.length;
    }),
    find: mock(() => ({
      sort: mock(() => ({
        skip: mock(() => ({
          limit: mock(() => ({
            toArray: mock(shiftMany),
          })),
        })),
        toArray: mock(shiftMany),
        limit: mock(() => ({
          next: mock(shiftOne),
        })),
      })),
    })),
    aggregate: mock(() => ({
      toArray: mock(shiftMany),
    })),
  };
}

export function makeRegistryMongoClient(queue: unknown[]): MongoClient {
  const collections = new Map<string, CollectionMock>();
  return {
    db: mock(() => ({
      collection: mock((name: string) => {
        let col = collections.get(name);
        if (!col) {
          col = makeCollectionMock(queue);
          collections.set(name, col);
        }
        return col;
      }),
    })),
  } as unknown as MongoClient;
}
