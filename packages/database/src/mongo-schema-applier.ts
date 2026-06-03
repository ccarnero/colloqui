import type { Collection, Db } from "mongodb";
import type { IMongoCollectionSchema, IMongoIndexSpec } from "@yoizen/shared";

/**
 * Mongo error codes that mean the requested index clashes with one that
 * already exists:
 *  - 85 `IndexOptionsConflict`: same key pattern, different name/options
 *    (e.g. a legacy auto-named `path_1` vs a renamed `uniq_config_files_path`).
 *  - 86 `IndexKeySpecsConflict`: same name, different key spec.
 */
const INDEX_CONFLICT_CODES: ReadonlySet<number> = new Set([85, 86]);

function isIndexConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number" && INDEX_CONFLICT_CODES.has(code)) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    message.includes("already exists with a different name")
  );
}

/**
 * Order-sensitive equality for index key patterns. Compound indexes are
 * order-significant in MongoDB, so `{ a: 1, b: 1 }` !== `{ b: 1, a: 1 }`.
 */
function keysMatch(
  desired: Record<string, 1 | -1>,
  existing: Record<string, number>,
): boolean {
  const desiredKeys = Object.keys(desired);
  const existingKeys = Object.keys(existing);
  if (desiredKeys.length !== existingKeys.length) {
    return false;
  }
  for (let i = 0; i < desiredKeys.length; i++) {
    const key = desiredKeys[i]!;
    if (key !== existingKeys[i] || desired[key] !== existing[key]) {
      return false;
    }
  }
  return true;
}

function isIdOnlyKey(keys: Record<string, 1 | -1>): boolean {
  const names = Object.keys(keys);
  return names.length === 1 && names[0] === "_id";
}

/**
 * Recovers from an index name/option conflict by dropping the colliding
 * index(es) and recreating the one we want. A conflict means a previous
 * deploy created the same key pattern (or name) with different options;
 * reconciling makes {@link applyMongoSchema} idempotent across index renames
 * instead of wedging the whole tenant schema init on every request.
 *
 * The immutable `_id_` index can never be dropped, so conflicts on an
 * `_id`-only index are swallowed — the default `_id_` index already covers it.
 */
async function reconcileIndexConflict(
  collection: Collection,
  indexSpec: IMongoIndexSpec,
): Promise<void> {
  if (isIdOnlyKey(indexSpec.keys)) {
    return;
  }

  const existing = (await collection.indexes()) as Array<{
    name?: string;
    key?: Record<string, number>;
  }>;
  const desiredName = indexSpec.options?.name;
  const toDrop = new Set<string>();
  for (let i = 0; i < existing.length; i++) {
    const descriptor = existing[i]!;
    const name = descriptor.name;
    if (name === undefined || name === "_id_") {
      continue;
    }
    const keyMatches =
      descriptor.key !== undefined && keysMatch(indexSpec.keys, descriptor.key);
    const nameMatches = desiredName !== undefined && name === desiredName;
    if (keyMatches || nameMatches) {
      toDrop.add(name);
    }
  }

  for (const name of toDrop) {
    await collection.dropIndex(name);
  }
  await collection.createIndex(indexSpec.keys, indexSpec.options ?? {});
}

async function ensureIndex(
  collection: Collection,
  indexSpec: IMongoIndexSpec,
): Promise<void> {
  try {
    await collection.createIndex(indexSpec.keys, indexSpec.options ?? {});
  } catch (error: unknown) {
    if (!isIndexConflictError(error)) {
      throw error;
    }
    await reconcileIndexConflict(collection, indexSpec);
  }
}

/**
 * Ensures collections and indexes exist for the given schema descriptors.
 * Idempotent: safe to call on every `ensureSchema(tenantId)` invocation,
 * including after an index has been renamed or had its options changed.
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
      await ensureIndex(collection, schema.indexes[i]!);
    }
  }
}
