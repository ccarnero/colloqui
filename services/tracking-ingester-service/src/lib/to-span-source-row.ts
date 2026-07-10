// Projects a just-inserted `TrackedEventRow` onto a `SpanSourceRow` (T1's
// `to-otel-span.ts` input shape) for REAL-TIME export from the ingest path
// (T2). Each row emits as its OWN zero-duration point span (`start_time ===
// end_time === occurred_at`) — this module does NOT attempt started/completed
// pairing.
//
// Pairing IS still available, but as an offline/query-time concern: the
// `tracking.tracked_event_spans` SQL view (T1, `src/sql/span-pairs.sql`) is
// consumed directly by Grafana's Postgres-datasource panels (T6 latency
// percentiles), not by this real-time export path. Real-time export cannot
// pair anyway — the `_completed` sibling of a just-started span may not exist
// yet at insert time, and buffering an open span across batches (possibly
// across service restarts) would trade emission latency/complexity for a
// duration that Tempo's own span timing already approximates via consecutive
// point spans in the same trace_id.

import type { SpanSourceRow } from "./to-otel-span.js";
import type { TrackedEventRow } from "./to-tracked-event-row.js";

/** Maps one inserted row to a zero-duration `SpanSourceRow` for immediate export. */
export function toSpanSourceRow(row: TrackedEventRow): SpanSourceRow {
  return {
    event_id: row.event_id,
    // Cross-tenant / non-envelope rows (T07) may carry a null correlation_id.
    // `to-otel-span.ts`'s trace_id derivation needs SOME string; fall back to
    // the row's own event_id so such a row still forms a valid (single-span)
    // trace instead of being silently dropped from export.
    correlation_id: row.correlation_id ?? row.event_id,
    causation_id: row.causation_id,
    start_time: row.occurred_at,
    end_time: row.occurred_at,
    duration_ms: 0,
    service_name: row.producer,
    tech: row.tech,
    business_fn: row.business_fn,
    is_claim_check: row.is_claim_check,
    compliance: row.compliance,
    tenant: row.tenant,
  };
}
