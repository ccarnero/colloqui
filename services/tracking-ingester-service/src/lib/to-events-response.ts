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
  /** Echo of the `endpointId` filter that produced this list (T01 of
   * `manual-loops/connectors/endpoint-scoped-recent-calls.md`) — echoed for
   * the same reason `resource`/`from` are: the console renders the applied
   * filter set from the response, not from what it believes it sent. `null`
   * when the caller did not scope by endpoint. The per-row endpoint id is a
   * DIFFERENT field, `EventRow.payload_endpoint_id`, which rides through
   * inside `events`. */
  readonly endpointId: string | null;
  /** Echo of the `toolName` filter that produced this list (T06 of
   * `manual-loops/connectors/endpoint-scoped-recent-calls.md`) — echoed for
   * the same reason `resource`/`from`/`endpointId` are: the console renders
   * the applied filter set from the response, not from what it believes it
   * sent. `null` when the caller did not scope by tool. The per-row tool name
   * is a DIFFERENT field, `EventRow.payload_tool_name`, which rides through
   * inside `events`. */
  readonly toolName: string | null;
  readonly limit: number;
  readonly count: number;
  readonly events: readonly EventRow[];
}

export function toEventsResponse(
  tenant: string,
  type: string,
  resource: string | null,
  from: string | null,
  endpointId: string | null,
  toolName: string | null,
  limit: number,
  events: readonly EventRow[]
): EventsResponse {
  return {
    tenant,
    type,
    resource,
    from,
    endpointId,
    toolName,
    limit,
    count: events.length,
    events,
  };
}
