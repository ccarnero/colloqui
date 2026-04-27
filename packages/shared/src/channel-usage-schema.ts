/**
 * Per-tenant usage metrics schema — lives in the **dedicated**
 * `postgres-usage` tenant instance (separate from the main OLTP
 * tenant DB). Captures ingress/egress/dlq channel events at
 * millisecond precision for billing and dashboard analytics.
 *
 * This schema assumes the `timescaledb` extension is available (the
 * provisioner hornea `timescale/timescaledb-ha:pg17` with
 * `shared_preload_libraries = 'timescaledb'`). All DDL is idempotent
 * and safe to replay via `TenantConnectionManager.setSchema()`.
 *
 * Columns:
 *   - `ts`              — original envelope `time` (partitioning dim).
 *   - `idempotency_key` — canonical envelope `idempotencykey`; forms
 *                         the PK with `ts` so replayed inserts are
 *                         deduped via `ON CONFLICT DO NOTHING`.
 *   - `account_id`      — `envelope.accountid`.
 *   - `channel`         — `envelope.channel` (`whatsapp`,`instagram`,...).
 *   - `direction`       — normalized ingress/egress/dlq (derived from
 *                         envelope `kind` / stream prefix).
 *   - `subject`         — original NATS subject (retained for audit
 *                         + UI inspection).
 *   - `message_type`    — provider-reported message type (text, media…).
 *
 * Continuous aggregates (`channel_events_hourly`, `channel_events_daily`)
 * back the dashboard. The raw hypertable is kept for 60 days with
 * compression after 7 days. Chunk interval is 1 day to keep scan
 * counts small on narrow `ts` ranges.
 */
export const CHANNEL_USAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS channel_events (
  ts              TIMESTAMPTZ  NOT NULL,
  idempotency_key TEXT         NOT NULL,
  account_id      TEXT         NOT NULL,
  channel         TEXT         NOT NULL,
  direction       TEXT         NOT NULL CHECK (direction IN ('ingress','egress','dlq')),
  subject         TEXT         NOT NULL,
  message_type    TEXT,
  PRIMARY KEY (idempotency_key, ts)
);

SELECT create_hypertable(
  'channel_events',
  'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_channel_events_account_ts
  ON channel_events (account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_channel_events_channel_dir_ts
  ON channel_events (channel, direction, ts DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS channel_events_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  account_id,
  channel,
  direction,
  count(*)::BIGINT AS events
FROM channel_events
GROUP BY bucket, account_id, channel, direction
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS channel_events_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  account_id,
  channel,
  direction,
  count(*)::BIGINT AS events
FROM channel_events
GROUP BY bucket, account_id, channel, direction
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'channel_events_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy(
  'channel_events_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

ALTER MATERIALIZED VIEW channel_events_hourly
  SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW channel_events_daily
  SET (timescaledb.materialized_only = false);

ALTER TABLE channel_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'account_id, channel, direction'
);

SELECT add_compression_policy(
  'channel_events',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'channel_events',
  INTERVAL '60 days',
  if_not_exists => TRUE
);
`;

/**
 * Shared TimescaleDB schema for all tenants in an environment.
 *
 * Differs from {@link CHANNEL_USAGE_SCHEMA_SQL} by adding `tenant_id`
 * as the first logical dimension in keys/indexes and as a TimescaleDB
 * hash partitioning column. This keeps per-tenant scans selective while
 * allowing one shared usage cluster per environment.
 */
export const SHARED_CHANNEL_USAGE_SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS channel_events (
  tenant_id       TEXT         NOT NULL,
  ts              TIMESTAMPTZ  NOT NULL,
  idempotency_key TEXT         NOT NULL,
  account_id      TEXT         NOT NULL,
  channel         TEXT         NOT NULL,
  direction       TEXT         NOT NULL CHECK (direction IN ('ingress','egress','dlq')),
  subject         TEXT         NOT NULL,
  message_type    TEXT,
  PRIMARY KEY (tenant_id, idempotency_key, ts)
);

SELECT create_hypertable(
  'channel_events',
  'ts',
  partitioning_column => 'tenant_id',
  number_partitions => 16,
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_channel_events_tenant_account_ts
  ON channel_events (tenant_id, account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_channel_events_tenant_channel_dir_ts
  ON channel_events (tenant_id, channel, direction, ts DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS channel_events_hourly
WITH (timescaledb.continuous) AS
SELECT
  tenant_id,
  time_bucket('1 hour', ts) AS bucket,
  account_id,
  channel,
  direction,
  count(*)::BIGINT AS events
FROM channel_events
GROUP BY tenant_id, bucket, account_id, channel, direction
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS channel_events_daily
WITH (timescaledb.continuous) AS
SELECT
  tenant_id,
  time_bucket('1 day', ts) AS bucket,
  account_id,
  channel,
  direction,
  count(*)::BIGINT AS events
FROM channel_events
GROUP BY tenant_id, bucket, account_id, channel, direction
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'channel_events_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy(
  'channel_events_daily',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

ALTER MATERIALIZED VIEW channel_events_hourly
  SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW channel_events_daily
  SET (timescaledb.materialized_only = false);

ALTER TABLE channel_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, account_id, channel, direction'
);

SELECT add_compression_policy(
  'channel_events',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

SELECT add_retention_policy(
  'channel_events',
  INTERVAL '60 days',
  if_not_exists => TRUE
);
`;
