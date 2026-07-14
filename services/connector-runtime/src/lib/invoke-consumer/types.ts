// Shared types for the async invoke result-parking pipeline
// (`manual-loops/connector-invoke-api.md` T05). Kept separate from
// `endpoint-call-core/types.ts` because these shapes describe the
// *transport/polling* record, not the core's execution result — the core
// stays unaware that an invocation can be polled at all.

import type {
  EndpointCallError,
  IEndpointCallResult,
} from "../endpoint-call-core";

/** Caller-supplied webhook target for async invoke result delivery (T05). */
export interface InvokeWebhookTarget {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/**
 * Redis-parked record for one invocation, read by
 * `GET /invoke/invocations/:invocationId` (facade) and
 * `GET /api/v1/connectors/invocations/:invocationId` (gateway).
 *
 * `pending` is written by the facade the moment `mode: "async"` is accepted
 * (T05 addition to `handleInvokeRequest`) so `GET` can tell "still queued"
 * apart from "this id never existed / already expired" — both of which read
 * as a Redis cache-miss. `completed` is written by the consumer, OVERWRITING
 * the same key (same TTL window resets), which is what makes result parking
 * idempotent across JetStream redelivery: replaying the same invocationId
 * writes the same key with the same shape, never creating a duplicate.
 */
export type InvocationRecord =
  | {
      readonly status: "pending";
      readonly tenantId: string;
      readonly invocationId: string;
      readonly acceptedAt: string;
    }
  | {
      readonly status: "completed";
      readonly tenantId: string;
      readonly invocationId: string;
      readonly completedAt: string;
      readonly outcome: "ok" | "error";
      readonly result?: IEndpointCallResult;
      readonly error?: {
        readonly kind: EndpointCallError["kind"];
        readonly message: string;
      };
    };
