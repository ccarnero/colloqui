// Parametrized SQL for the T03 (payload-capture) scrub script's DRY-RUN
// report: candidate row count per tenant, using the exact same predicate the
// batched UPDATE (`build-scrub-batch-query.ts`) scrubs — so the dry-run
// number is a faithful preview of what `--apply` would do.
//
// Pure query builder — no I/O, same shape as `build-chain-query.ts`.

export interface ScrubCandidateCountQuery {
  readonly text: string;
  readonly params: readonly [cutoffIso: string];
}

/** One row of the dry-run report. `tenant` is `null` for drift/non-envelope rows. */
export interface ScrubCandidateCountRow {
  readonly tenant: string | null;
  readonly count: number;
}

export function buildScrubCandidateCountQuery(
  cutoff: Date
): ScrubCandidateCountQuery {
  const text = `
SELECT tenant, COUNT(*)::int AS count
FROM tracking.tracked_events
WHERE occurred_at < $1
  AND payload_status IN ('inline', 'resolved')
GROUP BY tenant
ORDER BY tenant NULLS LAST
`.trim();

  return { text, params: [cutoff.toISOString()] };
}
