// Port for the T04 apply-audit events (TAXONOMY.md rule 22). Declared here so
// `apply-manifest.ts` (the pure orchestrator) stays free of a `nats` import —
// same separation `publish-invoke-request.ts` uses for connector-runtime's
// async invoke facade. The concrete JetStream-backed implementation is
// `../infrastructure/apply-events.publisher.ts`.
//
// Every method is BEST-EFFORT and must never throw — a broker outage must
// never break the apply engine itself (same contract as
// `ServiceEventsPublisher` in registry-service).
//
// CAUSAL CHAIN (matches TAXONOMY.md rule 22 addendum + golden rows
// seq1322-1326, and mirrors workflow-service's
// execution-completed-publisher.activity.ts sibling-hop pattern):
// `apply_started` is the run ROOT — correlation_id = its own envelope id,
// causation_id = null, depth 0. `resource_applied`/`apply_completed`/
// `apply_failed` are SIBLING hops off that root — each cites the
// `apply_started` envelope id as `causation_id`, inherits its
// `correlation_id`, and sits at depth 1 (constant, never chained
// child-to-child). `applyStarted` therefore RETURNS the run's causal
// context so `apply-manifest.ts` can thread it into every subsequent call.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { ApplyWriteError } from "./apply.interfaces";

/**
 * Causal context of one apply run, returned by `applyStarted` and threaded
 * by `apply-manifest.ts` into every sibling event of the same run.
 */
export interface ApplyRunAudit {
  /** The `apply_started` envelope id — every sibling cites it as `causation_id`. */
  readonly causationId: string;
  /** The run's `correlation_id` (equals the root id) — inherited by every sibling. */
  readonly correlationId: string;
}

export interface ApplyStartedEvent {
  readonly tenantId: string;
  readonly manifestName: string;
  readonly revision: number;
  readonly resourceCount: number;
}

/** Sibling events carry the run's causal context so they join its chain. */
export interface ApplyRunCausalContext {
  readonly correlationId: string;
  readonly causationId: string;
}

export interface ResourceAppliedEvent extends ApplyRunCausalContext {
  readonly tenantId: string;
  readonly manifestName: string;
  readonly kind: ResourceKind;
  readonly name: string;
  readonly verdict: "create" | "update";
  readonly externalId: string;
}

export interface ApplyCompletedEvent extends ApplyRunCausalContext {
  readonly tenantId: string;
  readonly manifestName: string;
  readonly appliedCount: number;
  readonly noopCount: number;
  readonly durationMs: number;
}

export interface ApplyFailedEvent extends ApplyRunCausalContext {
  readonly tenantId: string;
  readonly manifestName: string;
  readonly failure: ApplyWriteError;
  readonly appliedSoFar: readonly { kind: ResourceKind; name: string }[];
}

export interface IApplyEventPublisher {
  /** Publishes the run root and RETURNS its causal context for the siblings. */
  applyStarted(event: ApplyStartedEvent): Promise<ApplyRunAudit>;
  resourceApplied(event: ResourceAppliedEvent): Promise<void>;
  applyCompleted(event: ApplyCompletedEvent): Promise<void>;
  applyFailed(event: ApplyFailedEvent): Promise<void>;
}

export const APPLY_EVENT_PUBLISHER = Symbol("APPLY_EVENT_PUBLISHER");

/**
 * No-op publisher for tests / contexts where audit events are irrelevant.
 * `applyStarted` still returns a well-formed (empty) causal context so
 * callers can thread it without branching on the publisher implementation.
 */
export const NOOP_APPLY_EVENT_PUBLISHER: IApplyEventPublisher = {
  async applyStarted() {
    return { causationId: "", correlationId: "" };
  },
  async resourceApplied() {},
  async applyCompleted() {},
  async applyFailed() {},
};
