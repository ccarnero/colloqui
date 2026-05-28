import {
  ADAPTER_MONGO_SCHEMA,
  AUDIT_MONGO_SCHEMA,
  CHANNEL_MONGO_SCHEMA,
  CHANNEL_USAGE_MONGO_SCHEMA,
  TENANT_AUTH_MONGO_SCHEMA,
  WORKFLOW_MONGO_SCHEMA,
  type IMongoCollectionSchema,
} from "@yoizen/shared";

/**
 * Serializes Mongo index options for embedding in a mongosh init script.
 */
function serializeIndexOptions(
  options: IMongoCollectionSchema["indexes"][number]["options"],
): string {
  if (options === undefined) {
    return "{}";
  }
  return JSON.stringify(options);
}

/**
 * Builds a mongosh script that idempotently creates collections, time-series
 * collections, and indexes for `databaseName`.
 */
export function buildMongoSchemaInitScript(
  databaseName: string,
  schemas: readonly IMongoCollectionSchema[],
): string {
  const blocks: string[] = [
    `const targetDb = db.getSiblingDB(${JSON.stringify(databaseName)});`,
    "function ensureCollection(name, options) {",
    "  const existing = targetDb.getCollectionNames();",
    "  if (existing.includes(name)) return;",
    "  if (options) {",
    "    targetDb.createCollection(name, options);",
    "  } else {",
    "    targetDb.createCollection(name);",
    "  }",
    "}",
    "function ensureIndex(collectionName, keys, options) {",
    "  targetDb.getCollection(collectionName).createIndex(keys, options);",
    "}",
  ];

  for (let s = 0; s < schemas.length; s++) {
    const schema = schemas[s]!;
    if (schema.timeseries !== undefined) {
      const tsOptions = {
        timeseries: {
          timeField: schema.timeseries.timeField,
          metaField: schema.timeseries.metaField,
          ...(schema.timeseries.expireAfterSeconds !== undefined
            ? { expireAfterSeconds: schema.timeseries.expireAfterSeconds }
            : {}),
        },
      };
      blocks.push(
        `ensureCollection(${JSON.stringify(schema.collection)}, ${JSON.stringify(tsOptions)});`,
      );
    } else {
      blocks.push(`ensureCollection(${JSON.stringify(schema.collection)});`);
    }

    for (let i = 0; i < schema.indexes.length; i++) {
      const indexSpec = schema.indexes[i]!;
      blocks.push(
        `ensureIndex(${JSON.stringify(schema.collection)}, ${JSON.stringify(indexSpec.keys)}, ${serializeIndexOptions(indexSpec.options)});`,
      );
    }
  }

  blocks.push(`print("[tenant-mongo-init] schema applied on ${databaseName}");`);
  return blocks.join("\n");
}

/** Per-tenant OLTP database bootstrap (yoizen). */
export const TENANT_OLTP_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  ...WORKFLOW_MONGO_SCHEMA,
  ...ADAPTER_MONGO_SCHEMA,
  ...CHANNEL_MONGO_SCHEMA,
  ...TENANT_AUTH_MONGO_SCHEMA,
  ...AUDIT_MONGO_SCHEMA,
];

/** Per-tenant usage database bootstrap (yoizen_usage). */
export const TENANT_USAGE_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  ...CHANNEL_USAGE_MONGO_SCHEMA,
];
