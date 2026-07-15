// Types for the T04 apply engine (manual-loops/declarative-provisioning.md).
//
// Apply reconciles the T03 plan against live platform state via the EXISTING
// service APIs (create-or-update by name/externalId) — NEVER direct table
// writes, NEVER deletes (user decision 8). Stop-at-first-error semantics:
// apply processes the plan's resources IN DEPENDENCY ORDER and halts on the
// first write failure, reporting what was applied and what remains pending.
// Re-applying the same manifest resumes: the next apply call always
// re-plans against current live state, so already-converged resources come
// back as `noop` and are skipped.

import type { ReconcileKbOutcome } from "../../kb/domain/kb.interfaces";
import type {
  ResourceKind,
  ResourceVerdict,
} from "../../plan/domain/plan.interfaces";

/** One resource that was actually acted on (verdict `create` or `update`). */
export interface ResourceApplyOutcome {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly verdict: "create" | "update";
  /** Live platform id after the write (new id for create, existing id for update). */
  readonly externalId: string;
}

/** A resource the planner marked `noop` — nothing was written. */
export interface ResourceNoopOutcome {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly verdict: "noop";
  readonly externalId?: string;
}

export type ResourceOutcome = ResourceApplyOutcome | ResourceNoopOutcome;

/** Typed reasons a single resource's write can fail. Never a thrown exception. */
export type ApplyWriteErrorKind =
  | "secret_not_resolvable"
  | "missing_required_field"
  | "unsupported_kind_shape"
  | "downstream_error";

export interface ApplyWriteError {
  readonly kind: ApplyWriteErrorKind;
  readonly resourceKind: ResourceKind;
  readonly resourceName: string;
  readonly message: string;
}

/** Manifest-level typed errors surfaced before any write is attempted. */
export interface ManifestApplyPlanError {
  readonly kind: "plan_error";
  readonly message: string;
}

export interface ManifestApplyPreconditionError {
  readonly kind: "unmet_precondition";
  readonly message: string;
}

export type ManifestApplyError =
  | ManifestApplyPlanError
  | ManifestApplyPreconditionError;

export interface ManifestApplySuccess {
  readonly manifestName: string;
  /** Every resource the planner listed, in dependency order, each with the outcome of processing it. */
  readonly resources: readonly ResourceOutcome[];
  readonly appliedCount: number;
  readonly noopCount: number;
  readonly durationMs: number;
  /** T06 — knowledge-base reconciliation outcomes (create/reembed/skip per document), run before `resources`. */
  readonly knowledgeBases?: readonly ReconcileKbOutcome[];
}

export interface ManifestApplyFailure {
  readonly kind: "apply_failed";
  readonly manifestName: string;
  /** Resources successfully applied/noop'd BEFORE the failure (dependency order). */
  readonly applied: readonly ResourceOutcome[];
  /** Resources the planner listed but apply never reached (dependency order). */
  readonly pending: readonly {
    kind: ResourceKind;
    name: string;
    verdict: ResourceVerdict;
  }[];
  readonly failure: ApplyWriteError;
  readonly durationMs: number;
}
