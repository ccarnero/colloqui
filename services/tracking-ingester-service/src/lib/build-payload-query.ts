// build-payload-query.ts — parametrized SQL for one event's payload, scoped
// to a correlation AND a tenant (T04 of manual-loops/payload-capture.md).
// Pure query builder: no I/O — src/main.ts (the only I/O edge) executes this
// against the shared pool. Mirrors build-chain-query.ts's tenant scoping rule
// exactly: `tenant = $3 OR tenant IS NULL` (drift/non-envelope rows carry a
// NULL tenant and are still visible, same as the chain endpoint).
//
// The payload column is never materialized elsewhere: it is read directly
// out of the jsonb envelope at query time (`envelope->'data'->'payload'`),
// never SELECT * — same discipline as build-chain-query.ts, which excludes
// the raw envelope from the chain LIST payload entirely.

import type { PayloadStatus } from "./to-tracked-event-row.js";

export interface PayloadQuery {
  readonly text: string;
  readonly params: readonly [
    correlationId: string,
    eventId: string,
    tenant: string | null,
  ];
}

/** Row shape returned by the query built here. */
export interface PayloadRow {
  readonly payload: unknown;
  readonly payload_status: PayloadStatus;
}

/**
 * Builds the parametrized SQL that fetches the payload + lifecycle status of
 * one `tracking.tracked_events` row, scoped by `correlationId` AND `eventId`
 * AND `tenant` (including rows with a NULL tenant, same rule as
 * `buildChainQuery`).
 */
export function buildPayloadQuery(
  correlationId: string,
  eventId: string,
  tenant: string | null
): PayloadQuery {
  const text = `SELECT payload_status, envelope->'data'->'payload' AS payload
FROM tracking.tracked_events
WHERE correlation_id = $1
  AND event_id = $2
  AND (tenant = $3 OR tenant IS NULL)`;

  return { text, params: [correlationId, eventId, tenant] };
}
