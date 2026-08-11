import type { IMongoCollectionSchema } from "./mongo-schema.types";

/** 60 days — mirrors Timescale retention policy on dedicated usage DB. */
const CHANNEL_USAGE_RETENTION_SECONDS = 60 * 24 * 60 * 60;

/**
 * Per-tenant usage metrics — lives in the dedicated usage Mongo instance
 * (separate from the main OLTP tenant DB). Captures ingress/egress/dlq
 * channel events at millisecond precision for billing and dashboard analytics.
 *
 * Documents use a `meta` subdocument for time-series metadata:
 * `{ tenant_id, channel_id, account_id }` (channel_id maps to envelope channel).
 *
 * NOTE for token sweeps: the `metaField: "meta"` below is MongoDB's
 * time-series metadata key (read back as `meta.account_id` /
 * `meta.tenant_id` by `usage.mongo.repository.ts`, written by
 * usage-aggregator-service's `batch-inserter.mongo.ts`). It has NOTHING to do
 * with the decommissioned Meta channel provider and MUST NOT be renamed — the
 * key is baked into every existing tenant's `channel_events` collection.
 */
export const CHANNEL_USAGE_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "channel_events",
    timeseries: {
      timeField: "ts",
      metaField: "meta",
      expireAfterSeconds: CHANNEL_USAGE_RETENTION_SECONDS,
    },
    indexes: [
      {
        keys: { "meta.account_id": 1, ts: -1 },
        options: { name: "idx_channel_events_account_ts" },
      },
      {
        keys: { "meta.channel_id": 1, direction: 1, ts: -1 },
        options: { name: "idx_channel_events_channel_dir_ts" },
      },
      {
        keys: { idempotency_key: 1, ts: 1 },
        options: { unique: true, name: "uniq_channel_events_idempotency_ts" },
      },
    ],
  },
];

/**
 * Shared usage Mongo schema for all tenants in an environment.
 *
 * Differs from {@link CHANNEL_USAGE_MONGO_SCHEMA} by including `tenant_id`
 * in the time-series `meta` subdocument for selective scans on shared clusters.
 */
export const SHARED_CHANNEL_USAGE_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "channel_events",
    timeseries: {
      timeField: "ts",
      metaField: "meta",
      expireAfterSeconds: CHANNEL_USAGE_RETENTION_SECONDS,
    },
    indexes: [
      {
        keys: { "meta.tenant_id": 1, "meta.account_id": 1, ts: -1 },
        options: { name: "idx_channel_events_tenant_account_ts" },
      },
      {
        keys: {
          "meta.tenant_id": 1,
          "meta.channel_id": 1,
          direction: 1,
          ts: -1,
        },
        options: { name: "idx_channel_events_tenant_channel_dir_ts" },
      },
      {
        keys: { "meta.tenant_id": 1, idempotency_key: 1, ts: 1 },
        options: {
          unique: true,
          name: "uniq_channel_events_tenant_idempotency_ts",
        },
      },
    ],
  },
];
