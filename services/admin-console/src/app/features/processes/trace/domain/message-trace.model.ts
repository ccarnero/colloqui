/**
 * View-model types for the Message trace debug view (Processes › Diagnostics).
 *
 * The business trace (causal chain + pub/sub topology) is assembled from the
 * audit list endpoints; the tech trace (OTel traceid) is surfaced as deep-link
 * keys only. See `.sdd/changes/processes-message-trace/`.
 */

/** A durable consumer subscribed to an event's subject. */
export interface ITraceSubscriber {
  readonly service: string;
  readonly durable: string;
  /** `producer` emits the next causal node; `sink` consumes without producing one. */
  readonly role: "producer" | "sink";
  /** Live JetStream/breaker health — Slice 2; absent in Slice 1. */
  readonly health?: IConsumerHealth;
}

export interface IConsumerHealth {
  readonly pending?: number;
  readonly ackPending?: number;
  readonly redelivered?: boolean;
  readonly circuitOpen?: boolean;
}

/** Delivery outcome of a `send` node. `unknown` until health/tier-3 data exists. */
export type DeliveryOutcome = "delivered" | "failed" | "unknown";

/** One node of the causal chain (a persisted audit event). */
export interface ITraceNodeInput {
  readonly id: string;
  /** `received` | `sent`/`send` | a platform event `type`. */
  readonly kind: string;
  readonly subject: string;
  readonly causationId: string | null;
  readonly depth: number;
  readonly createdAt: string;
  readonly from?: string;
  readonly to?: string;
  readonly text?: string;
  readonly accountId?: string;
  readonly source: "channel" | "platform";
  /** Optional, forward-compat with Slice 2 health-derived delivery. */
  readonly delivery?: DeliveryOutcome;
}

export interface ITraceNode extends ITraceNodeInput {
  readonly subscribers: readonly ITraceSubscriber[];
  readonly children: readonly ITraceNode[];
}

export type TraceVerdict =
  | "received"
  | "replied"
  | "published-unconfirmed"
  | "failed"
  | "empty";

export interface ITraceResult {
  readonly correlationId: string;
  readonly root: ITraceNode | null;
  /** Flat, created_at-ascending list (what the timeline renders). */
  readonly nodes: readonly ITraceNode[];
  readonly nodeCount: number;
  readonly verdict: TraceVerdict;
  /** Distinct delivery count across the chain (events × subscribers). */
  readonly deliveryCount: number;
}

/** A row in the "recent traces" picker (business correlation + tech traceid). */
export interface IRecentTrace {
  readonly correlationId: string;
  readonly channel: string;
  readonly verdict: TraceVerdict;
  readonly lastAt: string;
  /** OTel traceid (tech trace) when present on the events. */
  readonly traceId?: string;
}
