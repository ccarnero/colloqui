// build-node-stats-query.ts — parametrized SQL for the per-node execution
// aggregate (T07 of manual-loops/admin-console/console-redesign-builder-v2.md,
// implementing the option-(b) recommendation recorded as "T06 findings" in
// that SPEC). Grouped self-join over `tracking.tracked_events` on
// `(correlation_id, action_index, branch)` — deliberately NOT
// `tracking.tracked_event_spans` (span-pairs.sql), whose `entity_id`/
// `kind_prefix` pairing collapses to the SAME values for every action of a
// run and therefore does not disambiguate actions within one run (see the
// SPEC's T06 findings, "Existing pairing view is NOT directly reusable").
//
// Same jsonb-path-projection discipline as `build-run-events-query.ts` (T03
// of run-view.md) — `action_started`/`action_completed` events do not
// promote `actionName`/`actionIndex`/`branch`/`status` to dedicated columns
// (`extract-detail-columns.ts` only promotes `workflow_id`/`run_id` for
// rule 19), so this query extracts them at query time via
// `envelope->'data'->'payload'->>'...'`, exactly like the SPEC's query
// sketch.
//
// Windowing: the CALLER (workflow-service, via a new correlation-id-listing
// repo method) already narrows `correlationIds` to a 7-day window before
// this query ever runs, mirroring `getWorkflowsSummary`'s 7d/24h convention
// — this query does not re-apply a date filter, it aggregates exactly the
// correlation ids it is handed.

export interface NodeStatsQuery {
  readonly text: string;
  readonly params: readonly [
    correlationIds: readonly string[],
    tenant: string | null,
  ];
}

/** One `(action_name, branch)` aggregate row. `runs` is always >= 1 (GROUP
 * BY only emits rows for pairs that actually completed at least once);
 * `p95_ms`/`ok_ratio` are floats straight off Postgres (`percentile_cont`
 * and the `::float` cast both return `double precision`, which the
 * `postgres` driver already parses as a JS `number`) — normalized
 * defensively anyway by `normalize-node-stats-row.ts`, same discipline as
 * every other query in this service. */
export interface NodeStatsRow {
  readonly action_name: string;
  readonly branch: string | null;
  readonly runs: number;
  readonly p95_ms: number | null;
  readonly ok_ratio: number | null;
}

/**
 * Builds the parametrized SQL that self-joins `action_started`/
 * `action_completed` rows for the given `correlationIds`, scoped to
 * `tenant` (including rows with a NULL tenant, same drift-row allowance as
 * `build-run-events-query.ts`), and aggregates `runs`/`p95_ms`/`ok_ratio`
 * per `(action_name, branch)`.
 */
export function buildNodeStatsQuery(
  correlationIds: readonly string[],
  tenant: string | null
): NodeStatsQuery {
  const text = `WITH action_events AS (
  SELECT
    correlation_id,
    envelope->'data'->'payload'->>'actionName'         AS action_name,
    envelope->'data'->'payload'->>'branch'              AS branch,
    (envelope->'data'->'payload'->>'actionIndex')::int  AS action_index,
    envelope->'data'->'payload'->>'status'              AS step_status,
    kind,
    occurred_at
  FROM tracking.tracked_events
  WHERE correlation_id = ANY($1::text[])
    AND (tenant = $2 OR tenant IS NULL)
    AND kind IN ('action_started', 'action_completed')
),
spans AS (
  SELECT
    s.action_name, s.branch,
    EXTRACT(EPOCH FROM (c.occurred_at - s.occurred_at)) * 1000 AS duration_ms,
    c.step_status
  FROM action_events s
  JOIN action_events c
    ON c.correlation_id = s.correlation_id
   AND c.action_index   = s.action_index
   AND COALESCE(c.branch, '') = COALESCE(s.branch, '')
   AND c.kind = 'action_completed'
  WHERE s.kind = 'action_started'
    AND s.action_name IS NOT NULL
)
SELECT
  action_name,
  branch,
  COUNT(*)::int                                                    AS runs,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float  AS p95_ms,
  (COUNT(*) FILTER (WHERE step_status = 'ok'))::float / COUNT(*)::float AS ok_ratio
FROM spans
GROUP BY action_name, branch`;

  return { text, params: [correlationIds, tenant] };
}
