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
  // T06 (manual-loops/provisioning-manifest-gaps.md, gap 6) — BEFORE agent:
  // an agent's `enabledMcpServerRefs` and a workflow's `mcpCall.serverId`
  // both reference an mcpServers[] entry by manifest name, so mcp servers
  // must be resolved/created first (mirrors the connector-before-agent
  // ordering already established for connectorRef).
  "mcpServer",
  // T01 (manual-loops/provisioning-manifest-gaps-3.md, workstream a) —
  // BEFORE agent: an agent's `profile.model_config.subagents[].catalog_skill_id`
  // references a skills[] entry by manifest name via `skillRef` (T02), so
  // skills must be resolved/created first — mirrors the mcpServer-before-
  // agent ordering above exactly.
  "skill",
  "agent",
  "service",
  // T04 (manual-loops/provisioning-manifest-gaps.md, gap 4) — a leaf node
  // with no refs in/out today (`ai-system-variables` consumes them at
  // RUNTIME, not manifest-time); placed anywhere before workflows per the
  // task text.
  "systemVariable",
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
  | "downstream_error"
  // manual-loops/provisioning-manifest-gaps.md T05, gap 5, decision 6 ruling
  // (2026-07-16): a manifest-declared route `pathPrefix` collides with an
  // existing LIVE route owned by a DIFFERENT service/manifest/tenant —
  // `registry.routes` are not tenant-isolated at the live gateway proxy
  // layer. Surfaced here at plan time (informational) AND re-verified inside
  // `registry-services-writer.ts` at apply time, right before any route is
  // written (the actual enforcement point, mirroring how `missing_secret` is
  // informational here but actually enforced by the writer's own broker
  // resolution).
  | "route_collision";

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
