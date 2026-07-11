// Orchestrates the `GET /chains/:correlationId` request (T02 of
// manual-loops/trace-console.md): tenant guard, the two T01 row fetches, and
// shaping via `toChainResponse` — WITHOUT touching a concrete Postgres client.
// Same injected-I/O shape as `tracked-event-buffer.ts`'s `insert` option: the
// actual `sql.unsafe(...)` round trips are bound in `src/main.ts` (the only
// I/O edge), so this stays trivially testable with a stubbed pool.

import {
  buildChainQuery,
  type ChainEventRow,
  type ChainQuery,
} from "./build-chain-query.js";
import {
  buildSpansQuery,
  type ChainSpanRow,
  type SpansQuery,
} from "./build-spans-query.js";
import { type ChainResponse, toChainResponse } from "./to-chain-response.js";

export interface ChainRequestDeps {
  /** Executes the T01 events query — normally `sql.unsafe(query.text, query.params)`. */
  readonly queryEvents: (
    query: ChainQuery
  ) => Promise<readonly ChainEventRow[]>;
  /** Executes the T01 spans query — same client, over `tracked_event_spans`. */
  readonly querySpans: (query: SpansQuery) => Promise<readonly ChainSpanRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type ChainRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 404; readonly body: { readonly error: string } }
  | { readonly status: 200; readonly body: ChainResponse };

/**
 * Handles a chain read: 400 when `tenant` is missing (the gateway proxy
 * always sets `x-yoizen-tenant`; a missing header means the request bypassed
 * the gateway), 404 when the correlation has zero events for the tenant scope
 * (SPEC.md T02), otherwise 200 with the shaped `ChainResponse`.
 */
export async function handleChainRequest(
  correlationId: string,
  tenant: string | null,
  deps: ChainRequestDeps
): Promise<ChainRequestResult> {
  const log = deps.log ?? (() => {});

  if (tenant === null || tenant.trim().length === 0) {
    log(
      `handleChainRequest: REJECTED correlation_id=${correlationId} — missing x-yoizen-tenant header`
    );
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  log(
    `handleChainRequest: fetching chain correlation_id=${correlationId} tenant=${tenant}`
  );

  const chainQuery = buildChainQuery(correlationId, tenant);
  const spansQuery = buildSpansQuery(correlationId, tenant);

  const [events, spans] = await Promise.all([
    deps.queryEvents(chainQuery),
    deps.querySpans(spansQuery),
  ]);

  log(
    `handleChainRequest: correlation_id=${correlationId} tenant=${tenant} events=${events.length} spans=${spans.length}`
  );

  if (events.length === 0) {
    log(
      `handleChainRequest: NOT FOUND correlation_id=${correlationId} tenant=${tenant} — zero events`
    );
    return {
      status: 404,
      body: { error: `no events found for correlation_id ${correlationId}` },
    };
  }

  const response = toChainResponse(correlationId, tenant, events, spans);
  log(
    `handleChainRequest: OK correlation_id=${correlationId} tenant=${tenant} count=${response.summary.count} orphan_count=${response.summary.orphan_count}`
  );
  return { status: 200, body: response };
}
