/**
 * MongoDB index and collection schema descriptors — parallel to SQL DDL
 * strings in `*-schema.ts` files. Applied idempotently by
 * `@yoizen/database` `applyMongoSchema()`.
 */

export interface IMongoIndexSpec {
  readonly keys: Record<string, 1 | -1>;
  readonly options?: {
    readonly unique?: boolean;
    readonly sparse?: boolean;
    readonly partialFilterExpression?: Record<string, unknown>;
    readonly expireAfterSeconds?: number;
    readonly name?: string;
  };
}

export interface IMongoCollectionSchema {
  readonly collection: string;
  readonly indexes: readonly IMongoIndexSpec[];
  readonly timeseries?: {
    readonly timeField: string;
    readonly metaField: string;
    readonly expireAfterSeconds?: number;
  };
}
