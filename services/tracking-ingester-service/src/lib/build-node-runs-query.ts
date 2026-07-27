// build-node-runs-query.ts — parametrized SQL for the per-node RECENT RUNS
// list (IF-editor round-2 task of manual-loops/admin-console, Runs tab).
// Ungrouped sibling of `build-node-stats-query.ts`: SAME CTE shape and SAME
// self-join keys (correlation_id, action_index, branch) over
// `tracking.tracked_events`, but with NO GROUP BY — each row is one
// individual (started, completed) pairing for a single `action_name`,
// ordered most-recent-first and capped at 20 rows. Deliberately NOT
// `tracking.tracked_event_spans`, for the exact reason recorded in
// `build-node-stats-query.ts`'s header comment (entity_id/kind_prefix
// pairing does not disambiguate actions within one run).

export interface NodeRunsQuery {
  readonly text: string;
  readonly params: readonly [
    correlationIds: readonly string[],
    tenant: string | null,
    actionName: string,
  ];
}

/** One individual (started, completed) run pairing for a single action. */
export interface NodeRunRow {
  readonly correlation_id: string;
  readonly occurred_at: string;
  readonly duration_ms: number | null;
  readonly step_status: string | null;
}

/**
 * Builds the parametrized SQL listing the most recent runs of a single
 * `actionName`, self-joined on `(correlation_id, action_index, branch)` —
 * same pairing discipline as `buildNodeStatsQuery`, just without the final
 * `GROUP BY`. Ordered by completion time descending, capped at 20 rows.
 */
export function buildNodeRunsQuery(
  correlationIds: readonly string[],
  tenant: string | null,
  actionName: string
): NodeRunsQuery {
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
)
SELECT
  s.correlation_id                                                   AS correlation_id,
  c.occurred_at                                                      AS occurred_at,
  (EXTRACT(EPOCH FROM (c.occurred_at - s.occurred_at)) * 1000)::float AS duration_ms,
  c.step_status                                                      AS step_status
FROM action_events s
JOIN action_events c
  ON c.correlation_id = s.correlation_id
 AND c.action_index   = s.action_index
 AND COALESCE(c.branch, '') = COALESCE(s.branch, '')
 AND c.kind = 'action_completed'
WHERE s.kind = 'action_started'
  AND s.action_name = $3
ORDER BY c.occurred_at DESC
LIMIT 20`;

  return { text, params: [correlationIds, tenant, actionName] };
}
