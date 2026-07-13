// to-events-response.ts — shapes the raw rows returned by
// `build-events-query.ts` into the `GET /events` response body. Pure
// function: no I/O, no DB client — `handle-events-request.ts` passes it the
// rows the driver returned (already normalized by `normalize-events-row.ts`).

import type { EventRow } from "./build-events-query.js";

export interface EventsResponse {
  readonly tenant: string;
  readonly type: string;
  readonly resource: string | null;
  readonly from: string | null;
  readonly limit: number;
  readonly count: number;
  readonly events: readonly EventRow[];
}

export function toEventsResponse(
  tenant: string,
  type: string,
  resource: string | null,
  from: string | null,
  limit: number,
  events: readonly EventRow[]
): EventsResponse {
  return {
    tenant,
    type,
    resource,
    from,
    limit,
    count: events.length,
    events,
  };
}
