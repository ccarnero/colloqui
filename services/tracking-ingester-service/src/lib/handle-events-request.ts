// Orchestrates the
// `GET /events?type=<t>&resource=<r>&from=<iso>&limit=<n>&endpointId=<id>
// &toolName=<name>`
// request (T03 of manual-loops/connector-trace-linking.md; the optional
// `endpointId` filter is T01 and the optional `toolName` filter is T06 of
// manual-loops/connectors/endpoint-scoped-recent-calls.md): tenant guard,
// query-param validation (`parseEventsQuery`), the projected list query
// (`buildEventsQuery`), and shaping via `toEventsResponse` — WITHOUT touching
// a concrete Postgres client. Same injected-I/O shape as
// `handle-chain-request.ts`/`handle-run-request.ts`: the actual
// `sql.unsafe(...)` round trip is bound in `src/main.ts` (the only I/O edge).

import {
  buildEventsQuery,
  type EventRow,
  type EventsQuery,
} from "./build-events-query.js";
import {
  parseEventsQuery,
  type RawEventsQueryInput,
} from "./parse-events-query.js";
import { type EventsResponse, toEventsResponse } from "./to-events-response.js";

export interface EventsRequestDeps {
  /** Executes the events list query — normally
   * `sql.unsafe(query.text, query.params).then((rows) => rows.map(normalizeEventsRow))`. */
  readonly queryEvents: (query: EventsQuery) => Promise<readonly EventRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type EventsRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 200; readonly body: EventsResponse };

/**
 * Handles an events-by-type/resource read: 400 when `tenant` is missing (the
 * gateway proxy always sets `x-yoizen-tenant`; a missing header means the
 * request bypassed the gateway), 400 when the query params fail validation
 * (missing `type`, malformed `from`), otherwise 200 with the shaped
 * `EventsResponse` — 200 with an empty `events` array when nothing matches
 * (this is a filtered list, not a single-resource lookup, so an empty result
 * is not a 404).
 */
export async function handleEventsRequest(
  tenant: string | null,
  rawQuery: RawEventsQueryInput,
  deps: EventsRequestDeps
): Promise<EventsRequestResult> {
  const log = deps.log ?? ((): void => {});

  if (tenant === null || tenant.trim().length === 0) {
    log("handleEventsRequest: REJECTED — missing x-yoizen-tenant header");
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  const parsed = parseEventsQuery(rawQuery);
  if (!parsed.ok) {
    log(`handleEventsRequest: REJECTED tenant=${tenant} — ${parsed.error}`);
    return {
      status: 400,
      body: { error: parsed.error },
    };
  }

  const { type, resource, from, endpointId, toolName, limit } = parsed.value;
  log(
    `handleEventsRequest: fetching tenant=${tenant} type=${type} resource=${resource ?? "-"} from=${from ?? "-"} endpointId=${endpointId ?? "-"} toolName=${toolName ?? "-"} limit=${limit}`
  );

  const query = buildEventsQuery({
    tenant,
    type,
    resource,
    from,
    endpointId,
    toolName,
    limit,
  });
  const events = await deps.queryEvents(query);

  log(
    `handleEventsRequest: OK tenant=${tenant} type=${type} resource=${resource ?? "-"} from=${from ?? "-"} endpointId=${endpointId ?? "-"} toolName=${toolName ?? "-"} limit=${limit} count=${events.length}`
  );

  const response = toEventsResponse(
    tenant,
    type,
    resource,
    from,
    endpointId,
    toolName,
    limit,
    events
  );
  return { status: 200, body: response };
}
