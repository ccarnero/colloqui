// Parametrized SQL for one T03 (payload-capture) retention-scrub batch.
//
// Selects up to `batchSize` candidate rows (`occurred_at < cutoff` AND
// `payload_status IN ('inline', 'resolved')` — the exact predicate the
// partial index `idx_tracked_events_payload_scrub_scan`
// (src/sql/tracked-events.sql) was built to serve) and, in the SAME
// statement, empties `envelope.data.payload` and flips them to 'scrubbed'.
//
// `FOR UPDATE SKIP LOCKED` on the candidate CTE makes concurrent scrub runs
// (e.g. an overlapping manual dry-run/apply, or a retried CronJob) safe: a
// row already locked by another in-flight batch is simply skipped rather
// than blocking or double-scrubbing.
//
// `jsonb_set(..., '{data,payload}', 'null'::jsonb)` sets the JSON path to an
// explicit JSON `null` (NOT a SQL NULL / key removal). This mirrors the
// existing convention in `tracked-events.sql`'s payload_status backfill,
// which already treats `envelope -> 'data' -> 'payload' = 'null'::jsonb` as
// "no payload" — so a re-scrubbed row is indistinguishable in shape from a
// row that never had `data.payload` set at all.
//
// Pure query builder — no I/O. The script entrypoint executes this via
// `sql.unsafe(query.text, query.params)`, the same pattern `build-chain-query.ts`
// documents and `src/main.ts` already uses for `queryEvents`.

export interface ScrubBatchQuery {
  readonly text: string;
  readonly params: readonly [cutoffIso: string, batchSize: number];
}

export function buildScrubBatchQuery(
  cutoff: Date,
  batchSize: number
): ScrubBatchQuery {
  const text = `
WITH candidates AS (
  SELECT event_id
  FROM tracking.tracked_events
  WHERE occurred_at < $1
    AND payload_status IN ('inline', 'resolved')
  ORDER BY occurred_at
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE tracking.tracked_events t
SET envelope = jsonb_set(t.envelope, '{data,payload}', 'null'::jsonb),
    payload_status = 'scrubbed',
    payload_scrubbed_at = now()
FROM candidates
WHERE t.event_id = candidates.event_id
`.trim();

  return { text, params: [cutoff.toISOString(), batchSize] };
}
