/**
 * Request/response types for the `audit` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/audit/audit.controller.ts` +
 *   `channel-audit.controller.ts` (+ `audit-proxy-query.dto.ts`) — pure JSON
 *   passthrough to `audit-service`, no reshaping.
 * - `services/audit-service/src/common/audit-list-helpers.ts`
 *   (`IAuditListResult<T>`), `.../modules/audit/audit.controller.ts`
 *   (`IAuditEvent`), `.../modules/channel-audit/channel-audit-projection.ts`
 *   (`IStoredChannelEvent`) define the real response shapes.
 *
 * Known gaps:
 * - List envelope is `{ events, limit, offset }` — there is NO `total`
 *   field at all (confirmed via `IAuditListResult<T>`), unlike every other
 *   `limit`/`offset` list in this SDK. `hasMore` is therefore a HEURISTIC:
 *   `items.length === limit` (a full page might mean there's more, or might
 *   mean the last page happened to be exactly full — the gateway gives no
 *   way to distinguish). Documented in `client.ts`.
 * - `GET /audit/events/chain/:correlationId` and the channel-events
 *   equivalent are implemented in `audit-service` but are **NOT proxied by
 *   the gateway** (`audit.controller.ts` / `channel-audit.controller.ts`
 *   only declare `@Get()` and `@Get(":id")` — no `chain` route). Calling a
 *   would-be `.getChain()` through the gateway would 404 by matching `chain`
 *   as an `:id`, not reach the intended endpoint. NOT implemented here —
 *   this is a gateway gap, not a client limitation. Track upstream before
 *   adding a `getChain()` method.
 * - There is no standalone gateway route for audit "gateway stats" — that
 *   endpoint is only called internally by the dashboard aggregator (see
 *   `../dashboard/types.ts`). Not exposed here.
 */

export interface QueryAuditEventsParams {
  type?: string;
  /** ISO-8601 date. */
  from?: string;
  /** ISO-8601 date. */
  to?: string;
  /** 1-500. */
  limit?: number;
  offset?: number;
}

export interface AuditEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  subject: string;
  correlation_id: string | null;
  causation_id: string | null;
  depth: number | null;
  /** ISO-8601 timestamp. */
  created_at: string;
}

export interface QueryChannelEventsParams {
  channel?: string;
  kind?: string;
  accountId?: string;
  /** ISO-8601 date. */
  from?: string;
  /** ISO-8601 date. */
  to?: string;
  /** 1-500. */
  limit?: number;
  offset?: number;
}

export interface ChannelEvent {
  id: string;
  tenantId: string;
  channel: string;
  provider: string;
  kind: string;
  accountId: string;
  fromId: string | null;
  toId: string | null;
  messageType: string | null;
  messageText: string | null;
  providerMessageId: string | null;
  correlationId: string | null;
  causationId: string | null;
  depth: number | null;
  data: Record<string, unknown>;
  natsSubject: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}
