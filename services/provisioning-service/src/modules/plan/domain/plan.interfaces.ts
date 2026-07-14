// Types for the T03 read-only resolver + planner
// (manual-loops/declarative-provisioning.md).
//
// `ResourceKind` is deliberately the same union as `@yoizen/shared`'s
// `SecretScopeKind` — both describe "which manifest section a resource
// belongs to" — so we reuse it instead of declaring a parallel enum.

import type { SecretScopeKind, SymbolicRefType } from "@yoizen/shared";

export type ResourceKind = SecretScopeKind;

export const RESOURCE_KIND_ORDER: readonly ResourceKind[] = [
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
];

/** One differing top-level field between the live resource and the manifest's desired shape. */
export interface FieldDiff {
  readonly field: string;
  readonly current: unknown;
  readonly desired: unknown;
}

export type ResourceVerdict = "create" | "update" | "noop";

export interface ResourcePlanEntry {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly external: boolean;
  readonly verdict: ResourceVerdict;
  /** Populated only for `verdict === "update"`. */
  readonly diff: readonly FieldDiff[];
  /** Live platform id, when the resource (or its external counterpart) was found. */
  readonly externalId?: string;
}

export type PlanPreconditionKind =
  | "missing_secret"
  | "unresolvable_external_ref"
  | "downstream_error";

export interface PlanPrecondition {
  readonly kind: PlanPreconditionKind;
  readonly resourceKind: ResourceKind;
  readonly resourceName: string;
  readonly refType?: SymbolicRefType;
  readonly refValue?: string;
  readonly message: string;
}

export interface ManifestPlan {
  readonly manifestName: string;
  readonly resources: readonly ResourcePlanEntry[];
  readonly preconditions: readonly PlanPrecondition[];
}

/** Typed error when the ref graph contains a dependency cycle — never a hang. */
export interface CycleDetectedError {
  readonly kind: "cycle_detected";
  /** Node keys (`"<ResourceKind>:<name>"`) forming the cycle, in order. */
  readonly cycle: readonly string[];
  readonly message: string;
}
