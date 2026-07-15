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
  /** T06 — populated by `buildManifestPlan`; optional so pre-T06 fixtures still typecheck. */
  readonly knowledgeBases?: readonly KbPlanEntry[];
}

/** Typed error when the ref graph contains a dependency cycle — never a hang. */
export interface CycleDetectedError {
  readonly kind: "cycle_detected";
  /** Node keys (`"<ResourceKind>:<name>"`) forming the cycle, in order. */
  readonly cycle: readonly string[];
  readonly message: string;
}

// ---------------------------------------------------------------------------
// T06: knowledge-base reconciliation plan (separate from the generic
// `resources` dependency-ordered array — see `modules/kb/lib/build-kb-plan.ts`
// header for why KBs are NOT folded into `ResourceKind`/`PlatformResourceClients`).
// ---------------------------------------------------------------------------

/**
 * `pending_fetch` is unique to `url:` sources: the checksum is unknown until
 * apply performs the guarded server-side fetch, so plan cannot yet say
 * create/update/skip — it conservatively counts the document toward the
 * re-embed estimate (decision 6: "plan reports the embedding cost before it
 * is paid", biased toward over- rather than under-reporting cost).
 */
export type KbDocumentPlanAction =
  | "create"
  | "reembed"
  | "skip"
  | "pending_fetch";

export interface KbDocumentPlanEntry {
  readonly documentName: string;
  readonly action: KbDocumentPlanAction;
  /** Best-effort chunk estimate — only known for `inline` sources at plan time. */
  readonly chunkEstimate?: number;
}

export interface KbPlanEntry {
  readonly kbName: string;
  readonly external: boolean;
  readonly documents: readonly KbDocumentPlanEntry[];
  /** Count of documents with action `create`/`reembed`/`pending_fetch`. */
  readonly reembedCount: number;
  readonly chunkEstimateTotal?: number;
  /** Human-readable "will re-embed N documents (~M chunks)" summary line. */
  readonly summary: string;
}
