import type { IMongoCollectionSchema } from "./mongo-schema.types";

/**
 * Per-tenant audit collections — events, gateway audit, and channel message audit.
 * Single source of truth for audit-service lazy schema initialization.
 *
 * Note: `channel_events` here is the **audit** variant (full message envelope),
 * distinct from the usage time-series `channel_events` collection in
 * {@link CHANNEL_USAGE_MONGO_SCHEMA}.
 */
export const AUDIT_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  {
    collection: "events",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_events" },
      },
      {
        keys: { type: 1 },
        options: { name: "idx_events_type" },
      },
      {
        keys: { created_at: -1 },
        options: { name: "idx_events_created_at" },
      },
      {
        keys: { type: 1, created_at: -1 },
        options: { name: "idx_events_type_created" },
      },
      {
        keys: { correlation_id: 1, depth: 1, created_at: 1 },
        options: { name: "idx_events_correlation" },
      },
      {
        keys: { causation_id: 1 },
        options: { name: "idx_events_causation" },
      },
    ],
  },
  {
    collection: "gateway_audit_events",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_gateway_audit_events" },
      },
      {
        keys: { created_at: -1 },
        options: { name: "idx_gw_audit_created" },
      },
      {
        keys: { method: 1, created_at: -1 },
        options: { name: "idx_gw_audit_method" },
      },
      {
        keys: { route_type: 1, created_at: -1 },
        options: { name: "idx_gw_audit_route_type" },
      },
      {
        keys: { trace_id: 1 },
        options: { name: "idx_gw_audit_trace" },
      },
      {
        keys: { correlation_id: 1, depth: 1, created_at: 1 },
        options: { name: "idx_gw_audit_correlation" },
      },
      {
        keys: { causation_id: 1 },
        options: { name: "idx_gw_audit_causation" },
      },
    ],
  },
  {
    collection: "channel_events",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_channel_events_audit" },
      },
      {
        keys: { created_at: -1 },
        options: { name: "idx_ch_evt_created" },
      },
      {
        keys: { channel: 1, created_at: -1 },
        options: { name: "idx_ch_evt_channel" },
      },
      {
        keys: { kind: 1, created_at: -1 },
        options: { name: "idx_ch_evt_kind" },
      },
      {
        keys: { account_id: 1, created_at: -1 },
        options: { name: "idx_ch_evt_account" },
      },
      {
        keys: { tenant_id: 1, conversation_id: 1 },
        options: { name: "idx_ch_evt_tenant_conversation" },
      },
      {
        keys: { correlation_id: 1, depth: 1, created_at: 1 },
        options: { name: "idx_ch_evt_correlation" },
      },
      {
        keys: { causation_id: 1 },
        options: { name: "idx_ch_evt_causation" },
      },
    ],
  },
  {
    collection: "execution_events",
    indexes: [
      {
        keys: { _id: 1 },
        options: { name: "pk_execution_events" },
      },
      {
        keys: { execution_id: 1, created_at: 1 },
        options: { name: "idx_exec_evt_execution" },
      },
      {
        keys: { conversation_id: 1, created_at: 1 },
        options: { name: "idx_exec_evt_conversation" },
      },
      {
        keys: { agent_id: 1, created_at: -1 },
        options: { name: "idx_exec_evt_agent" },
      },
      {
        keys: { correlation_id: 1, depth: 1, created_at: 1 },
        options: { name: "idx_exec_evt_correlation" },
      },
      {
        keys: { causation_id: 1 },
        options: { name: "idx_exec_evt_causation" },
      },
    ],
  },
];

/** Namespace key for gateway audit DDL deduplication. */
export const GATEWAY_AUDIT_MONGO_NAMESPACE = "gateway_audit";

/** Namespace key for channel audit DDL deduplication. */
export const CHANNEL_AUDIT_MONGO_NAMESPACE = "channel_audit";

/** Subset applied when only the core events audit stream is needed. */
export const EVENTS_AUDIT_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  AUDIT_MONGO_SCHEMA[0]!,
];

/** Subset for gateway audit ingestion. */
export const GATEWAY_AUDIT_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  AUDIT_MONGO_SCHEMA[1]!,
];

/** Subset for channel message audit ingestion. */
export const CHANNEL_AUDIT_EVENTS_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  AUDIT_MONGO_SCHEMA[2]!,
];

/** Namespace key for execution audit DDL deduplication. */
export const EXECUTION_AUDIT_MONGO_NAMESPACE = "execution_audit";

/**
 * Subset for durable execution-lifecycle audit ingestion
 * (DOCS/archive/audits/METERING-FOUNDATION.md G1/G2). One row per
 * `execution_started/completed/failed` event, keyed by envelope id for
 * idempotent redelivery.
 */
export const EXECUTION_AUDIT_EVENTS_MONGO_SCHEMA: IMongoCollectionSchema[] = [
  AUDIT_MONGO_SCHEMA[3]!,
];
