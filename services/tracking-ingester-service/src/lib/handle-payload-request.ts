// Orchestrates the `GET /chains/:correlationId/events/:eventId/payload`
// request (T04 of manual-loops/payload-capture.md): tenant guard, the T04
// payload query, and status-driven response shaping — WITHOUT touching a
// concrete Postgres client. Same injected-I/O shape as
// handle-chain-request.ts: the actual `sql.unsafe(...)` round trip is bound
// in src/main.ts (the only I/O edge), so this stays trivially testable with
// a stubbed pool.

import {
  buildPayloadQuery,
  type PayloadQuery,
  type PayloadRow,
} from "./build-payload-query.js";
import type { PayloadStatus } from "./to-tracked-event-row.js";

export interface PayloadRequestDeps {
  /** Executes the T04 payload query — normally `sql.unsafe(query.text, query.params)`. */
  readonly queryPayload: (
    query: PayloadQuery
  ) => Promise<readonly PayloadRow[]>;
  /** Optional line logger for verbose query-path logging. */
  readonly log?: (message: string) => void;
}

export type PayloadRequestResult =
  | { readonly status: 400; readonly body: { readonly error: string } }
  | { readonly status: 404; readonly body: { readonly error: string } }
  | { readonly status: 410; readonly body: { readonly error: string } }
  | {
      readonly status: 200;
      readonly body: {
        readonly payload: unknown;
        readonly payload_status: PayloadStatus;
      };
    };

/**
 * Handles a payload read: 400 when `tenant` is missing (same rule as
 * handleChainRequest — the gateway proxy always sets `x-yoizen-tenant`), 404
 * when the (correlation_id, event_id, tenant) scope matches zero rows
 * (unknown event), 410 Gone when `payload_status = 'scrubbed'` (retention
 * expired, payload content is gone but the row still exists), 404 with a
 * distinguishing reason when `payload_status` is `'none'` (never captured)
 * or `'unresolved'` (claim-check resolution failed at ingest), otherwise 200
 * with `{ payload, payload_status }`.
 */
export async function handlePayloadRequest(
  correlationId: string,
  eventId: string,
  tenant: string | null,
  deps: PayloadRequestDeps
): Promise<PayloadRequestResult> {
  const log = deps.log ?? (() => {});

  if (tenant === null || tenant.trim().length === 0) {
    log(
      `handlePayloadRequest: REJECTED correlation_id=${correlationId} event_id=${eventId} — missing x-yoizen-tenant header`
    );
    return {
      status: 400,
      body: { error: "missing x-yoizen-tenant header" },
    };
  }

  log(
    `handlePayloadRequest: fetching payload correlation_id=${correlationId} event_id=${eventId} tenant=${tenant}`
  );

  const query = buildPayloadQuery(correlationId, eventId, tenant);
  const rows = await deps.queryPayload(query);

  log(
    `handlePayloadRequest: correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} rows=${rows.length}`
  );

  const row = rows[0];
  if (row === undefined) {
    log(
      `handlePayloadRequest: NOT FOUND correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} — unknown event`
    );
    return {
      status: 404,
      body: {
        error: `no event found for correlation_id ${correlationId} event_id ${eventId}`,
      },
    };
  }

  if (row.payload_status === "scrubbed") {
    log(
      `handlePayloadRequest: GONE correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} — payload scrubbed`
    );
    return {
      status: 410,
      body: {
        error: `payload for event ${eventId} was scrubbed per retention policy (payload_status=scrubbed)`,
      },
    };
  }

  if (row.payload_status === "none") {
    log(
      `handlePayloadRequest: NOT FOUND correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} — payload never captured`
    );
    return {
      status: 404,
      body: {
        error: `payload was never captured for event ${eventId} (payload_status=none)`,
      },
    };
  }

  if (row.payload_status === "unresolved") {
    log(
      `handlePayloadRequest: NOT FOUND correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} — payload unresolved`
    );
    return {
      status: 404,
      body: {
        error: `payload capture failed to resolve for event ${eventId} (payload_status=unresolved — claim-check expired or cache unreachable)`,
      },
    };
  }

  log(
    `handlePayloadRequest: OK correlation_id=${correlationId} event_id=${eventId} tenant=${tenant} payload_status=${row.payload_status}`
  );
  return {
    status: 200,
    body: { payload: row.payload, payload_status: row.payload_status },
  };
}
