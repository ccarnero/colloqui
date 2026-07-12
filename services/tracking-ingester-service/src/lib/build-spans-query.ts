// build-spans-query.ts — parametrized SQL for the paired spans of a
// correlation, scoped to a tenant. Same scoping shape as
// build-chain-query.ts, over the `tracking.tracked_event_spans` view
// (src/sql/span-pairs.sql), which projects `kind_prefix`/`entity_id` from
// its internal `base` CTE.

export interface SpansQuery {
  readonly text: string;
  readonly params: readonly [correlationId: string, tenant: string | null];
}

/** Row shape returned by the query built here — the five columns SPEC.md's
 * T01 requires from `tracking.tracked_event_spans`, PLUS `event_id`/
 * `causation_id` (T01 of manual-loops/run-view.md, cross-run-leakage fix):
 * `scope-run-spans.ts` needs these to attribute a span row to a specific
 * run — `entity_id` alone is not enough (action-event spans carry no
 * executionId-shaped entity_id at all, see that file's header). Both
 * columns already exist on the underlying `tracking.tracked_event_spans`
 * view (src/sql/span-pairs.sql's final SELECT) — this only widens the
 * projection, no view change needed. */
export interface ChainSpanRow {
  event_id: string;
  causation_id: string | null;
  kind_prefix: string | null;
  entity_id: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

const SPAN_COLUMNS = [
  "event_id",
  "causation_id",
  "kind_prefix",
  "entity_id",
  "start_time AS started_at",
  "end_time AS completed_at",
  "duration_ms",
] as const;

/**
 * Builds the parametrized SQL that fetches every `tracking.tracked_event_spans`
 * row belonging to `correlationId`, scoped to `tenant` — including rows with
 * a NULL tenant, same scoping rule as build-chain-query.ts.
 */
export function buildSpansQuery(
  correlationId: string,
  tenant: string | null
): SpansQuery {
  const text = `SELECT ${SPAN_COLUMNS.join(", ")}
FROM tracking.tracked_event_spans
WHERE correlation_id = $1
  AND (tenant = $2 OR tenant IS NULL)
ORDER BY started_at`;

  return { text, params: [correlationId, tenant] };
}
