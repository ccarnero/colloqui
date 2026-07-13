// normalize-events-row.ts — normalizes a raw `tracking.tracked_events` row (as
// returned by the `postgres` driver for `build-events-query.ts`) into the
// `EventRow` shape the pure response-shaping expects. Same I/O-boundary fix
// as `normalize-chain-event-row.ts`/`normalize-run-event-row.ts`:
// `timestamptz` columns arrive as JS `Date` objects, and the two numeric
// jsonb extractions (`->>'status'`, `->>'durationMs'`) arrive as TEXT (or
// `null`) — same treatment `normalize-run-event-row.ts` gives
// `payload_action_index`.

import type { EventRow } from "./build-events-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the events query — same
 * as `EventRow` except `occurred_at` may be a driver `Date` and the two
 * numeric payload scalars arrive as text. */
export type RawEventRow = Omit<
  EventRow,
  "occurred_at" | "payload_http_status" | "payload_duration_ms"
> & {
  occurred_at: string | Date;
  payload_http_status: string | null;
  payload_duration_ms: string | null;
};

function parseNullableNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  // Guards against a malformed/non-numeric jsonb value degrading the whole
  // response instead of just this one field — same defensive treatment
  // `normalize-run-event-row.ts` gives `payload_action_index`.
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeEventsRow(row: RawEventRow): EventRow {
  return {
    ...row,
    occurred_at: toIsoMillis(row.occurred_at),
    payload_http_status: parseNullableNumber(row.payload_http_status),
    payload_duration_ms: parseNullableNumber(row.payload_duration_ms),
  };
}
