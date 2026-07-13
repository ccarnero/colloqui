// build-events-query.ts — parametrized SQL for `GET /events?type=<t>&resource=<r>
// &from=<iso>&limit=<n>` (T03 of manual-loops/connector-trace-linking.md): the
// generic events-by-type/resource list the connector "Recent calls" feature (and
// any future entity-detail "recent activity" panel) reads from
// `tracking.tracked_events` directly instead of audit-service's 60-minute window.
//
// Column set mirrors `ChainEventRow`/`RunEventRow` (never `SELECT *`, exclude the
// raw envelope jsonb), PLUS five payload-scalar columns extracted at query time
// the same way `build-run-events-query.ts` extracts step-event fields.
//
// `type`/`resource` mapping decision (verified against
// `services/connector-runtime/src/activities/_shared/event-publisher.ts`):
//   - `type` filters on `envelope->>'type'` (the CloudEvents-style field, e.g.
//     `"connector.endpoint_call.completed.v1"`), NOT the `domain`/`kind`/`version`
//     columns. Those columns are derived from the NATS *subject* and project as
//     `"platform.endpoint_call_completed.v1"` for this same event family — a
//     DIFFERENT string (T02 finding, manual-loops/connector-trace-linking.md).
//     The console's existing `connector-call.service.ts` already sends
//     `type=connector.endpoint_call.completed.v1` (matching `envelope.type`) to
//     audit-service; migrating it to this endpoint (T04) must accept the SAME
//     value it already sends, so `type` is scoped to `envelope->>'type'`.
//   - `resource` filters on `envelope->>'resource'` (e.g. `"adapter/<adapterId>"`)
//     for the identical reason: `event-publisher.ts` sets
//     `resource: \`adapter/${evt.adapterId}\`` on the envelope, and T05's deep-link
//     mapping table (manual-loops/connector-trace-linking.md) matches routes on
//     that exact `resource` shape. The `connector_id` column stores the bare id
//     (`adapterId ?? endpointId`, see `extract-detail-columns.ts`) for a DIFFERENT
//     purpose (T6 connector-detail dashboard filter) and is deliberately NOT reused
//     here — `resource` is optional and this endpoint must generalize to
//     non-connector families (mcp/agent/hosted-service, explicitly flagged as a
//     future consumer in the SPEC's "Out of scope" section) whose `resource` shape
//     is not `adapter/<id>`, so matching the envelope field verbatim is the only
//     choice that stays correct for all of them.
//
// Tenant scoping is a STRICT `tenant = $1` (no `OR tenant IS NULL`), same
// rationale as `build-run-root-query.ts`: `connector.endpoint_call.completed.v1`
// (and every other canonical `evt.*` family this endpoint targets) always carries
// a real tenant — there is no drift-row allowance to make here, unlike the
// chain/payload queries which intentionally include correlation-linked
// non-envelope rows.

import type { TrackedEventRow } from "./to-tracked-event-row.js";

export interface EventsQueryParams {
  readonly tenant: string;
  readonly type: string;
  /** `envelope->>'resource'` filter, e.g. `"adapter/<id>"`. Optional. */
  readonly resource: string | null;
  /** Inclusive lower bound on `occurred_at`, ISO-8601. Optional. */
  readonly from: string | null;
  /** Already clamped to `[1, MAX_LIST_LIMIT]` by the caller (`clampListLimit`). */
  readonly limit: number;
}

export interface EventsQuery {
  readonly text: string;
  readonly params: readonly (string | number)[];
}

/** Row shape returned by the query built here — a projection of
 * `TrackedEventRow` (envelope excluded) plus the five payload scalars the
 * connector "Recent calls" view needs. */
export type EventRow = Pick<
  TrackedEventRow,
  | "event_id"
  | "subject"
  | "tenant"
  | "producer"
  | "domain"
  | "kind"
  | "version"
  | "correlation_id"
  | "causation_id"
  | "causation_depth"
  | "occurred_at"
  | "tech"
  | "business_fn"
  | "rule"
  | "consumed_by"
  | "is_claim_check"
  | "compliance"
  | "workflow_id"
  | "run_id"
  | "connector_id"
  | "cache_status"
> & {
  has_envelope: boolean;
  /** `data.payload.method` — HTTP method of the connector call. */
  payload_method: string | null;
  /** `data.payload.resolvedUrl` — the resolved outbound URL (already
   * truncated at publish time, see `event-publisher.ts`'s `MAX_URL_LEN`). */
  payload_resolved_url: string | null;
  /** `data.payload.status` — HTTP response status code. Named
   * `payload_http_status`, NOT `payload_status`, to avoid colliding with the
   * unrelated `TrackedEventRow.payload_status` lifecycle column (`"inline" |
   * "resolved" | ...`) — the two have nothing to do with each other. */
  payload_http_status: number | null;
  /** `data.payload.durationMs` — call duration in milliseconds. */
  payload_duration_ms: number | null;
  /** `data.payload.cacheResult` — `"hit" | "miss" | "bypass" | null`. */
  payload_cache_result: string | null;
};

const EVENTS_COLUMNS = [
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
  "envelope->'data'->'payload'->>'method' AS payload_method",
  "envelope->'data'->'payload'->>'resolvedUrl' AS payload_resolved_url",
  "envelope->'data'->'payload'->>'status' AS payload_http_status",
  "envelope->'data'->'payload'->>'durationMs' AS payload_duration_ms",
  "envelope->'data'->'payload'->>'cacheResult' AS payload_cache_result",
] as const;

/**
 * Builds the parametrized SQL that fetches `tracking.tracked_events` rows
 * scoped to `tenant`, filtered by `envelope->>'type'` (required), optionally
 * `envelope->>'resource'` and a lower `occurred_at` bound, ordered
 * `occurred_at DESC` (most recent first — SPEC.md T03), capped at `limit`.
 * Never `SELECT *`; the raw `envelope` jsonb is excluded from the projection
 * (chain-list decision, manual-loops/trace-console.md T01, stands here too).
 */
export function buildEventsQuery(params: EventsQueryParams): EventsQuery {
  const conditions = ["tenant = $1", "envelope->>'type' = $2"];
  const values: (string | number)[] = [params.tenant, params.type];

  if (params.resource !== null) {
    values.push(params.resource);
    conditions.push(`envelope->>'resource' = $${values.length}`);
  }

  if (params.from !== null) {
    values.push(params.from);
    conditions.push(`occurred_at >= $${values.length}`);
  }

  values.push(params.limit);
  const limitPlaceholder = `$${values.length}`;

  const text = `SELECT ${EVENTS_COLUMNS.join(", ")}
FROM tracking.tracked_events
WHERE ${conditions.join("\n  AND ")}
ORDER BY occurred_at DESC
LIMIT ${limitPlaceholder}`;

  return { text, params: values };
}
