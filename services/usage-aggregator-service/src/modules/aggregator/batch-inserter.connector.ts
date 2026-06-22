import type { Sql } from "@yoizen/database";
import type { IConnectorCallEventRow } from "./envelope-parser";

/**
 * Upserts a homogeneous batch of {@link IConnectorCallEventRow} into the
 * `connector_call_events` hypertable using a single `UNNEST`-driven
 * `INSERT ... ON CONFLICT (tenant_id, idempotency_key, ts) DO NOTHING`.
 *
 * Mirrors the channel event inserter pattern: one round-trip per batch,
 * ON CONFLICT deduplification for exactly-once semantics across aggregator
 * restarts and NATS redeliveries.
 *
 * @returns the row count inserted by the server (not counting duplicates
 *          skipped by `ON CONFLICT`).
 */
export async function insertConnectorCallBatch(
  sql: Sql,
  rows: readonly IConnectorCallEventRow[],
  tenantId: string
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const tenantIds = new Array<string>(rows.length);
  const ts = new Array<Date>(rows.length);
  const idem = new Array<string>(rows.length);
  const adapterIds = new Array<string>(rows.length);
  const endpointIds = new Array<string | null>(rows.length);
  const statuses = new Array<number>(rows.length);
  const durationMs = new Array<number>(rows.length);
  const cacheResults = new Array<string | null>(rows.length);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    tenantIds[i] = tenantId;
    ts[i] = r.ts;
    idem[i] = r.idempotencyKey;
    adapterIds[i] = r.adapterId;
    endpointIds[i] = r.endpointId;
    statuses[i] = r.status;
    durationMs[i] = r.durationMs;
    cacheResults[i] = r.cacheResult;
  }

  const result = await sql`
    INSERT INTO connector_call_events (
      tenant_id,
      ts,
      idempotency_key,
      adapter_id,
      endpoint_id,
      status,
      duration_ms,
      cache_result
    )
    SELECT * FROM UNNEST(
      ${sql.array(tenantIds)}::text[],
      ${sql.array(ts)}::timestamptz[],
      ${sql.array(idem)}::text[],
      ${sql.array(adapterIds)}::text[],
      ${sql.array(endpointIds)}::text[],
      ${sql.array(statuses)}::integer[],
      ${sql.array(durationMs)}::integer[],
      ${sql.array(cacheResults)}::text[]
    )
    ON CONFLICT (tenant_id, idempotency_key, ts) DO NOTHING
  `;

  return typeof result.count === "number" ? result.count : rows.length;
}
