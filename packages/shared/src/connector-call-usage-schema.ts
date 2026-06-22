/**
 * Shared TimescaleDB schema for connector call usage events.
 * Lives in the same shared `yoizen_usage` database as channel events.
 *
 * Columns:
 *   - `tenant_id`       — tenant scope (hash partition key).
 *   - `ts`              — event timestamp (time partition key).
 *   - `idempotency_key` — canonical envelope idempotency key; forms the
 *                         PK with `tenant_id` + `ts` for deduplication.
 *   - `adapter_id`      — connector adapter identifier.
 *   - `endpoint_id`     — specific endpoint called (optional).
 *   - `status`          — HTTP status code of the upstream response.
 *   - `duration_ms`     — round-trip latency in milliseconds.
 *   - `cache_result`    — cache outcome: `HIT`, `MISS`, `BYPASS`, or null.
 *
 * Compressed after 7 days, retained for 30 days.
 */
export const CONNECTOR_CALL_USAGE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS connector_call_events (
    tenant_id       TEXT        NOT NULL,
    ts              TIMESTAMPTZ NOT NULL,
    idempotency_key TEXT        NOT NULL,
    adapter_id      TEXT        NOT NULL,
    endpoint_id     TEXT,
    status          INTEGER     NOT NULL,
    duration_ms     INTEGER     NOT NULL,
    cache_result    TEXT,
    PRIMARY KEY (tenant_id, idempotency_key, ts)
  );

  SELECT create_hypertable(
    'connector_call_events', 'ts',
    partitioning_column => 'tenant_id',
    number_partitions   => 16,
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists       => TRUE
  );

  CREATE INDEX IF NOT EXISTS idx_connector_call_events_tenant_adapter_ts
    ON connector_call_events (tenant_id, adapter_id, ts DESC);

  ALTER TABLE connector_call_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tenant_id, adapter_id'
  );

  SELECT add_compression_policy(
    'connector_call_events',
    INTERVAL '7 days',
    if_not_exists => TRUE
  );

  SELECT add_retention_policy(
    'connector_call_events',
    INTERVAL '30 days',
    if_not_exists => TRUE
  );
`;
