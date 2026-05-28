import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant channel_accounts + auto_reply_rules collections.
 * Single source of truth for channel-service provisioning.
 *
 * `tenant_id` is intentionally absent: the database is the boundary.
 */
export const CHANNEL_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "channel_accounts",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_channel_accounts" },
      },
      {
        keys: { channel: 1, external_id: 1 },
        options: { unique: true, name: "uniq_channel_accounts_channel_external" },
      },
      {
        keys: { channel: 1 },
        options: { name: "idx_channel_accounts_channel" },
      },
      {
        keys: { external_id: 1 },
        options: { name: "idx_channel_accounts_external" },
      },
    ],
  },
  {
    collection: "auto_reply_rules",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_auto_reply_rules" },
      },
      {
        keys: { account_id: 1 },
        options: { name: "idx_auto_reply_rules_account" },
      },
    ],
  },
];
