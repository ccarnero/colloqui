import { describe, expect, it } from "bun:test";
import type { Db } from "mongodb";
import type { IMongoCollectionSchema } from "@yoizen/shared";
import { applyMongoSchema } from "../../src/mongo-schema-applier";

interface IFakeIndex {
  name: string;
  key: Record<string, number>;
}

interface ICreateIndexCall {
  keys: Record<string, number>;
  options: Record<string, unknown>;
}

/**
 * Minimal in-memory Mongo collection/db doubles. `conflictKeyOnce` makes the
 * next `createIndex` for that exact key pattern throw an
 * `IndexOptionsConflict` (code 85), mirroring a legacy auto-named index.
 */
function buildFakeDb(options: {
  collections?: string[];
  preexistingIndexes?: IFakeIndex[];
  conflictKeyJson?: string;
}): {
  db: Db;
  createIndexCalls: ICreateIndexCall[];
  droppedIndexes: string[];
} {
  const createIndexCalls: ICreateIndexCall[] = [];
  const droppedIndexes: string[] = [];
  const indexes: IFakeIndex[] = [
    { name: "_id_", key: { _id: 1 } },
    ...(options.preexistingIndexes ?? []),
  ];
  let conflictArmed = options.conflictKeyJson !== undefined;

  const collection = {
    async createIndex(
      keys: Record<string, number>,
      indexOptions: Record<string, unknown> = {},
    ): Promise<string> {
      createIndexCalls.push({ keys, options: indexOptions });
      if (conflictArmed && JSON.stringify(keys) === options.conflictKeyJson) {
        conflictArmed = false;
        throw Object.assign(
          new Error("Index already exists with a different name: path_1"),
          { code: 85 },
        );
      }
      const name =
        (indexOptions.name as string | undefined) ??
        `${Object.keys(keys).join("_")}_1`;
      indexes.push({ name, key: keys });
      return name;
    },
    async indexes(): Promise<IFakeIndex[]> {
      return indexes.slice();
    },
    async dropIndex(name: string): Promise<void> {
      droppedIndexes.push(name);
      const idx = indexes.findIndex((entry) => entry.name === name);
      if (idx >= 0) {
        indexes.splice(idx, 1);
      }
    },
  };

  const db = {
    listCollections() {
      return {
        async toArray(): Promise<Array<{ name: string }>> {
          return (options.collections ?? []).map((name) => ({ name }));
        },
      };
    },
    async createCollection(): Promise<unknown> {
      return collection;
    },
    collection(): unknown {
      return collection;
    },
  };

  return { db: db as unknown as Db, createIndexCalls, droppedIndexes };
}

const SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "config_files",
    indexes: [
      { keys: { _id: 1 }, options: { name: "pk_config_files" } },
      { keys: { path: 1 }, options: { unique: true, name: "uniq_config_files_path" } },
    ],
  },
];

describe("applyMongoSchema", () => {
  it("creates indexes without dropping when there is no conflict", async () => {
    const { db, createIndexCalls, droppedIndexes } = buildFakeDb({
      collections: [],
    });

    await applyMongoSchema(db, SCHEMA);

    expect(droppedIndexes).toEqual([]);
    expect(createIndexCalls).toHaveLength(2);
  });

  it("drops a legacy auto-named index and recreates the desired one on conflict", async () => {
    const { db, createIndexCalls, droppedIndexes } = buildFakeDb({
      collections: ["config_files"],
      preexistingIndexes: [{ name: "path_1", key: { path: 1 } }],
      conflictKeyJson: JSON.stringify({ path: 1 }),
    });

    await applyMongoSchema(db, SCHEMA);

    expect(droppedIndexes).toContain("path_1");
    const pathCreates = createIndexCalls.filter(
      (call) => JSON.stringify(call.keys) === JSON.stringify({ path: 1 }),
    );
    // One failed attempt + one successful recreate after the drop.
    expect(pathCreates).toHaveLength(2);
    expect(pathCreates[1]?.options.name).toBe("uniq_config_files_path");
  });

  it("swallows conflicts on the immutable _id index without dropping _id_", async () => {
    const { db, droppedIndexes } = buildFakeDb({
      collections: ["config_files"],
      conflictKeyJson: JSON.stringify({ _id: 1 }),
    });

    await applyMongoSchema(db, SCHEMA);

    expect(droppedIndexes).toEqual([]);
  });

  it("rethrows non-conflict errors", async () => {
    const { db } = buildFakeDb({ collections: ["config_files"] });
    const failing = [
      {
        collection: "config_files",
        indexes: [{ keys: { path: 1 }, options: { name: "x" } }],
      },
    ] as IMongoCollectionSchema[];

    const collection = db.collection("config_files");
    collection.createIndex = async () => {
      throw Object.assign(new Error("network"), { code: 6 });
    };

    await expect(applyMongoSchema(db, failing)).rejects.toThrow("network");
  });
});
