// build-chain-query.ts — parametrized SQL for all events of a correlation,
// scoped to a tenant. Pure query builder: no I/O — src/main.ts (a later task)
// executes this against the shared pool.
//
// Column set mirrors `TrackedEventRow` (src/lib/to-tracked-event-row.ts) minus
// the raw `envelope` jsonb, which SPEC.md T01 explicitly excludes from the
// list payload ("never SELECT *; exclude the raw envelope jsonb from the list
// payload"). `has_envelope` signals whether the excluded jsonb is an actual
// compliant `EventEnvelope` shape rather than a raw non-envelope body: it is
// derived from `compliance <> 'none'`, since canonical/stage-1 rows
// (`compliance` = 'full'|'partial') carry a real envelope, while
// non-envelope/drift rows (`compliance` = 'none') store the raw family body
// verbatim in the same `envelope` column (see build-non-envelope-row.ts).

import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface ChainQuery {
  readonly text: string;
  readonly params: readonly [correlationId: string, tenant: string | null];
}

/** Row shape returned by the query built here — `TrackedEventRow` minus
 * `envelope`, plus the derived `has_envelope` flag. */
export type ChainEventRow = Omit<TrackedEventRow, "envelope"> & {
  has_envelope: boolean;
};

const CHAIN_COLUMNS = [
  "event_id",
  "subject",
  "tenant",
  "producer",
  "domain",
  "kind",
  "version",
  "correlation_id",
  "causation_id",
  "causation_depth",
  "occurred_at",
  "tech",
  "business_fn",
  "rule",
  "consumed_by",
  "is_claim_check",
  "compliance",
  "workflow_id",
  "run_id",
  "connector_id",
  "cache_status",
  "(compliance <> 'none') AS has_envelope",
] as const;

/**
 * Builds the parametrized SQL that fetches every `tracking.tracked_events`
 * row belonging to `correlationId`, scoped to `tenant` — including rows with
 * a NULL tenant (drift/non-envelope rows), per SPEC.md user decision 4
 * ("rows with tenant IS NULL belonging to the correlation are included but
 * flagged"). `has_envelope` is that flag.
 */
export function buildChainQuery(
  correlationId: string,
  tenant: string | null
): ChainQuery {
  const text = `SELECT ${CHAIN_COLUMNS.join(", ")}
FROM tracking.tracked_events
WHERE correlation_id = $1
  AND (tenant = $2 OR tenant IS NULL)
ORDER BY occurred_at`;

  return { text, params: [correlationId, tenant] };
}
