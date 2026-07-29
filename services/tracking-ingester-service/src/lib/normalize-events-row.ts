// normalize-events-row.ts — normalizes a raw `tracking.tracked_events` row (as
// returned by the `postgres` driver for `build-events-query.ts`) into the
// `EventRow` shape the pure response-shaping expects. Same I/O-boundary fix
// as `normalize-chain-event-row.ts`/`normalize-run-event-row.ts`:
// `timestamptz` columns arrive as JS `Date` objects, and every numeric/
// boolean jsonb extraction (`->>'status'`, `->>'durationMs'`,
// `->>'success'`, `->>'inputTokens'`, `->>'outputTokens'`, `->>'costUsd'`)
// arrives as TEXT (or `null`) — same treatment `normalize-run-event-row.ts`
// gives `payload_action_index`. T06 of
// `manual-loops/connectors/connection-call-inspector.md` added the
// MCP/LLM/agent-execution scalar columns; `payload_success` additionally
// needs text->boolean coercion (`"true"`/`"false"` as extracted by `->>`).
// T01 of `manual-loops/connectors/endpoint-scoped-recent-calls.md` added
// `payload_endpoint_id`: plain TEXT (or `null`), so — exactly like
// `payload_method`/`payload_resolved_url` — it needs NO coercion and rides
// through on the `...row` spread below, staying in both `RawEventRow` and
// `EventRow` unchanged.

import type { EventRow } from "./build-events-query.js";
import { toIsoMillis } from "./to-iso-millis.js";

/** Raw row shape as handed back by `sql.unsafe` for the events query — same
 * as `EventRow` except `occurred_at` may be a driver `Date` and every
 * numeric/boolean payload scalar arrives as text. */
export type RawEventRow = Omit<
  EventRow,
  | "occurred_at"
  | "payload_http_status"
  | "payload_duration_ms"
  | "payload_success"
  | "payload_input_tokens"
  | "payload_output_tokens"
  | "payload_cost_usd"
> & {
  occurred_at: string | Date;
  payload_http_status: string | null;
  payload_duration_ms: string | null;
  payload_success: string | null;
  payload_input_tokens: string | null;
  payload_output_tokens: string | null;
  payload_cost_usd: string | null;
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

function parseNullableBoolean(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }
  // Postgres `->>` on a jsonb boolean yields the literal text "true"/"false".
  // Anything else is treated as absent rather than defaulting to `false`,
  // so a malformed payload degrades gracefully instead of misreporting
  // call success.
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

export function normalizeEventsRow(row: RawEventRow): EventRow {
  return {
    ...row,
    occurred_at: toIsoMillis(row.occurred_at),
    payload_http_status: parseNullableNumber(row.payload_http_status),
    payload_duration_ms: parseNullableNumber(row.payload_duration_ms),
    payload_success: parseNullableBoolean(row.payload_success),
    payload_input_tokens: parseNullableNumber(row.payload_input_tokens),
    payload_output_tokens: parseNullableNumber(row.payload_output_tokens),
    payload_cost_usd: parseNullableNumber(row.payload_cost_usd),
  };
}
