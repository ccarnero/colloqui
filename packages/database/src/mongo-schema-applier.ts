import type { Db } from "mongodb";
import type { IMongoCollectionSchema } from "@yoizen/shared";

/**
 * Ensures collections and indexes exist for the given schema descriptors.
 * Idempotent: safe to call on every `ensureSchema(tenantId)` invocation.
 */
export async function applyMongoSchema(
  db: Db,
  schemas: readonly IMongoCollectionSchema[],
): Promise<void> {
  const existing = new Set<string>();
  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  for (let i = 0; i < listed.length; i++) {
    const name = listed[i]?.name;
    if (name !== undefined) {
      existing.add(name);
    }
  }

  for (let s = 0; s < schemas.length; s++) {
    const schema = schemas[s]!;
    if (!existing.has(schema.collection)) {
      if (schema.timeseries !== undefined) {
        await db.createCollection(schema.collection, {
          timeseries: {
            timeField: schema.timeseries.timeField,
            metaField: schema.timeseries.metaField,
            ...(schema.timeseries.expireAfterSeconds !== undefined
              ? { expireAfterSeconds: schema.timeseries.expireAfterSeconds }
              : {}),
          },
        });
      } else {
        await db.createCollection(schema.collection);
      }
      existing.add(schema.collection);
    }

    const collection = db.collection(schema.collection);
    for (let i = 0; i < schema.indexes.length; i++) {
      const indexSpec = schema.indexes[i]!;
      await collection.createIndex(indexSpec.keys, indexSpec.options ?? {});
    }
  }
}
