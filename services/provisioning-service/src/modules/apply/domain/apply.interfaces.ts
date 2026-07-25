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
  | "downstream_error"
  // manual-loops/provisioning-manifest-gaps.md T03, gap 3 — a workflow/agent
  // definition declared an ALLOWLISTED symbolic ref (see
  // `plan/lib/substitution-allowlist.ts`) whose target name has no
  // resolved real id yet (never created/resolved, or created AFTER this
  // resource in dependency order — should not happen given
  // `topological-resource-order.ts`, but fails loud instead of assuming).
  | "unresolved_symbolic_ref"
  // manual-loops/provisioning-manifest-gaps.md T03, gap 3 — an ALLOWLISTED
  // key held a recognized single-key ref-object, but its ref kind is not the
  // ONE kind that key accepts (e.g. `{ agentRef }` sitting in `accountId`,
  // which only accepts `channelRef`). A symbolic ref like this would never
  // be resolved; forwarding it raw to the writer (typed `string` downstream)
  // would only surface at runtime with no trail — so this fails loud with
  // the same posture as `unresolved_symbolic_ref`, naming expected vs actual.
  | "mismatched_symbolic_ref"
  // manual-loops/provisioning-manifest-gaps-2.md T02, gap 3, decision 5
  // ruling (2026-07-16, FAIL LOUD) — a recognized single-key ref-object
  // (`{ <SYMBOLIC_REF_KEYS member>: name }`) sits at a key that is NOT in
  // `SUBSTITUTION_ALLOWLIST` at all, so it was never a candidate for
  // resolution in the first place. Persisting it verbatim would silently
  // corrupt the resource (the writer receives a nested ref-object where it
  // expects a plain value/id) — so this fails loud, naming the key, the ref
  // kind/name, and the owning resource, exactly like its allowlisted-key
  // siblings above.
  | "unallowlisted_symbolic_ref"
  // manual-loops/provisioning-manifest-gaps-3.md T03, workstream d — an
  // ARRAY-allowlisted key (`plan/lib/array-substitution-allowlist.ts`, e.g.
  // `accountIds`) held a NON-array value. The array allowlist only knows how
  // to substitute per-element inside a real array; a scalar/object/other
  // shape at that key is not a shape this substitution path can walk, and
  // silently falling back to scalar handling would mask an authoring
  // mistake (the key IS documented as plural). Fails loud instead of
  // guessing, naming the key and the owning resource.
  | "invalid_array_substitution_shape"
  // manual-loops/provisioning-manifest-gaps.md T05, gap 5, decision 6 ruling
  // (2026-07-16) — a declared route `pathPrefix` collides with a LIVE route
  // owned by a DIFFERENT service/tenant. Re-verified by
  // `registry-services-writer.ts` immediately before writing any route
  // (create or remove-then-recreate), never just at plan time.
  | "route_collision"
  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — a knowledge
  // base's own reconciliation failure (`KbReconcileErrorKind`), surfaced
  // through the SAME `ManifestApplyFailure` envelope as every other resource
  // write failure once KB reconciliation moved INSIDE `applyManifestPlan`'s
  // dependency-ordered run (see `apply-manifest.ts`'s
  // `reconcileKnowledgeBases` hook) — never a bespoke shape.
  | "kb_write_failed"
  | "document_resolve_failed"
  | "document_write_failed"
  // manual-loops/provisioning-manifest-gaps-4.md T03 — a `service.env[]`
  // endpoint-ref value (`{ connectorRef, endpointMethod, endpointPath }`)
  // resolved its CONNECTOR (T02's `unresolved_symbolic_ref` already covers
  // "connector not resolvable"), but none of that connector's LIVE
  // `endpoints[]` (fetched via `GET /connectors/:id`) matches the declared
  // `(endpointMethod, endpointPath)` pair. NEW kind because no existing kind
  // expresses "parent resolved, child missing": `unresolved_symbolic_ref`/
  // `mismatched_symbolic_ref` are about the ref's NAME (the connector),
  // never about a live sub-resource nested one level deeper that only
  // exists after a network re-fetch; `route_collision`/`kb_write_failed`
  // are unrelated domains. The message names the connector, method, and
  // path — never a value.
  | "endpoint_ref_not_found";

export interface ApplyWriteError {
  readonly kind: ApplyWriteErrorKind;
  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — widened with
  // "knowledgeBase" ONLY here (error reporting), never in `ResourceKind`
  // itself: `ResourceKind` also drives `PlatformResourceWriters`
  // (`Record<ResourceKind, IPlatformResourceWriter>`) and
  // `RESOURCE_KIND_ORDER`, and `kb.interfaces.ts`'s header comment documents
  // why a knowledge base deliberately has NEITHER (its own reconciler, not a
  // generic writer) — widening `ResourceKind` itself would force a
  // `knowledgeBase` entry into both and reopen that settled decision.
  readonly resourceKind: ResourceKind | "knowledgeBase";
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
