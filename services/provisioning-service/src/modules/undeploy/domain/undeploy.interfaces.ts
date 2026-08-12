// Types for the undeploy engine (PENDIENTES/12-undeploy.spec.md T01).
//
// Undeploy is the EXPLICIT teardown verb: `POST /manifests/:name/undeploy`
// deletes, in the REVERSE of apply's dependency order, exactly the resources
// the STORED manifest owns. It is a SEPARATE path from apply — apply stays
// create-or-update only (decisions 2/8, see `apply/lib/apply-manifest.ts`'s
// header, still true) and no writer gained delete behavior.
//
// Shape deliberately mirrors `apply/domain/apply.interfaces.ts`'s
// `ManifestApplySuccess`/`ManifestApplyFailure` pair (same field names where
// the meaning is the same: `manifestName`, `resources`, `durationMs`,
// `pending`, `failure`) so a caller that already renders an apply report can
// render an undeploy report with the same code path.
//
// Stop-at-first-error, same as apply: the run halts on the first delete that
// fails and reports what was already deleted plus what it never reached. A
// partial undeploy KEEPS the stored manifest record so re-running resumes
// (see `undeploy.service.ts`).

import type { SecretScope } from "@yoizen/shared";
import type { ResourceKind } from "../../plan/domain/plan.interfaces";

/**
 * `ResourceKind` widened with `"knowledgeBase"` — the SAME widening
 * `ApplyWriteError.resourceKind` already does, and for the same reason: a
 * knowledge base is a manifest-owned resource with its own reconciler
 * instead of a generic writer (`kb/domain/kb.interfaces.ts` header), so it
 * is deliberately NOT a member of `ResourceKind` itself (that union also
 * drives `PlatformResourceWriters` and `RESOURCE_KIND_ORDER`). Undeploy must
 * still be able to delete one, hence the local widening — never a widening
 * of `ResourceKind`.
 */
export type UndeployResourceKind = ResourceKind | "knowledgeBase";

/**
 * What undeploy DID with one declared resource.
 *
 * - `deleted` — a live resource matched this kind's DELETION KEY (see the
 *   per-kind table in
 *   `undeploy/infrastructure/platform-resource-deleters.provider.ts`; note
 *   that NO key proves which manifest created a resource — channels prove
 *   apply-provenance, every other kind matches by name) and the downstream
 *   admin API accepted the DELETE.
 * - `not_found` — nothing live matched the deletion key (already gone, never
 *   applied, or — for channels — a same-named account apply never created).
 *   Decision 6: this is a SUCCESS, undeploy is idempotent.
 * - `skipped_external` — the manifest itself marks the resource
 *   `external: true`; it was never owned, so it is never deleted (decision 4).
 * - `skipped_no_delete_api` — the downstream admin API for this kind exposes
 *   NO delete route, so there is nothing to call. Never a crash, never a
 *   blocker (SPEC "Prior art"). No kind is in this state today — every one of
 *   the nine was live-verified 2026-08-12 — but the outcome exists so a kind
 *   whose deleter is not wired degrades loudly instead of silently.
 */
export type UndeployAction =
  | "deleted"
  | "not_found"
  | "skipped_external"
  | "skipped_no_delete_api";

export interface ResourceUndeployOutcome {
  readonly kind: UndeployResourceKind;
  readonly name: string;
  readonly action: UndeployAction;
  /** Live platform id that was deleted — set only for `action: "deleted"`. */
  readonly externalId?: string;
}

/**
 * One `secrets:` binding of the manifest. Decision 2 of this spec: secrets
 * die with the manifest, deleted AFTER their owner resource (the owner is
 * gone, the credential must not outlive it).
 *
 * Same `UndeployAction` union as a resource, with the same meanings, because
 * a binding inherits its owner's fate:
 * - `skipped_external` — the BINDING is marked `external: true`, or its owner
 *   resource is (the owner survives, so its credential must too);
 * - `skipped_no_delete_api` — the owner resource survives only because its
 *   downstream API has no delete route; deleting the credential of a live
 *   resource would break it.
 */
export interface SecretUndeployOutcome {
  readonly name: string;
  readonly scope: SecretScope;
  readonly action: UndeployAction;
}

/** Typed reasons ONE delete step can fail. Never a thrown exception. */
export type UndeployErrorKind =
  /** The downstream admin API (or the k8s API, for a secret) refused or was unreachable. */
  | "downstream_error"
  /** Resolving the resource's live id failed (the find-by-name read itself errored). */
  | "lookup_failed";

export interface UndeployStepError {
  readonly kind: UndeployErrorKind;
  readonly resourceKind: UndeployResourceKind | "secret";
  readonly resourceName: string;
  readonly message: string;
}

export interface ManifestUndeploySuccess {
  readonly manifestName: string;
  /** Every declared resource, in REVERSE dependency order, with its outcome. */
  readonly resources: readonly ResourceUndeployOutcome[];
  /** Every declared `secrets:` binding, each processed after its owner resource. */
  readonly secrets: readonly SecretUndeployOutcome[];
  readonly deletedCount: number;
  readonly notFoundCount: number;
  readonly skippedCount: number;
  /** `kb_document_checksums` rows removed for this manifest (provisioning's own state). */
  readonly checksumRowsDeleted: number;
  /** True once the stored manifest record itself was deleted (LAST step). */
  readonly manifestRecordDeleted: boolean;
  readonly durationMs: number;
}

export interface ManifestUndeployFailure {
  readonly kind: "undeploy_failed";
  readonly manifestName: string;
  /** Resources processed BEFORE the failure (reverse dependency order). */
  readonly resources: readonly ResourceUndeployOutcome[];
  /** Secret bindings processed BEFORE the failure. */
  readonly secrets: readonly SecretUndeployOutcome[];
  /** Declared resources undeploy never reached (reverse dependency order). */
  readonly pending: readonly {
    readonly kind: UndeployResourceKind;
    readonly name: string;
  }[];
  readonly failure: UndeployStepError;
  /**
   * ALWAYS false on this branch — spelled out (rather than implied) because
   * it is the contract decision 6 leans on: a partial undeploy keeps the
   * stored manifest so a re-run resumes from whatever is still live.
   */
  readonly manifestRecordDeleted: false;
  readonly durationMs: number;
}

/** One (manifest, resource) pair blocking the teardown (decision 4). */
export interface BlockingReference {
  /** The OTHER stored manifest that references the resource as `external: true`. */
  readonly manifestName: string;
  readonly resourceKind: UndeployResourceKind;
  readonly resourceName: string;
}

/**
 * Decision 4: another STORED manifest of the same tenant consumes a resource
 * this manifest owns (declares it `external: true`). Undeploy REFUSES —
 * 409, listing every manifest+resource pair. No `--force` in v1.
 */
export interface UndeployBlockedError {
  readonly kind: "undeploy_blocked";
  readonly manifestName: string;
  readonly dependents: readonly BlockingReference[];
  readonly message: string;
}

export interface ManifestNotFoundUndeployError {
  readonly kind: "manifest_not_found";
  readonly name: string;
}
