/**
 * Request/response types for the `manifests` resource
 * (`manual-loops/declarative-provisioning.md` T08), hand-typed against the
 * REAL gateway + downstream shapes:
 *
 * - Gateway routes: `services/api-gateway/src/modules/provisioning/provisioning.controller.ts`
 *   (`/provisioning/manifests/...`), proxying verbatim JSON (+ status
 *   passthrough for `plan`/`apply`) to provisioning-service.
 * - Downstream: `services/provisioning-service/src/modules/manifests/manifests.controller.ts`,
 *   `.../plan/plan.controller.ts`, `.../apply/apply.controller.ts`.
 *
 * The SDK has no `@yoizen/shared` dependency and no YAML-parsing dependency
 * (see sdk/package.json — no runtime `dependencies` at all). Per SPEC.md T08:
 * `validate()`/`put()`/`apply()` accept an ALREADY-PARSED manifest object
 * (`Record<string, unknown>`), never a YAML string — parsing YAML into an
 * object is the caller's responsibility (e.g. via `js-yaml`, not bundled
 * here). This is a deliberate scope limit, not an oversight.
 *
 * Known gap: the manifest shape itself (`IntegrationManifest` in
 * `@yoizen/shared`) is NOT re-declared here — every manifest-shaped
 * parameter/return field below is typed as `Record<string, unknown>` rather
 * than duplicating that schema (see the "Schemas ALWAYS imported from
 * @yoizen/shared" rule; the SDK cannot import it without adding the
 * dependency, so callers get a structural `Record` instead of the full
 * union of section types). Follow-up: consider vendoring `@yoizen/shared`'s
 * provisioning types (not the whole package) once the SDK's dependency
 * story allows it.
 */

import type { SecretScope } from "../secrets/types.js";

/** One structural/schema validation failure (`ManifestValidationError` downstream). Dot/bracket path into the manifest. */
export interface ManifestValidationErrorEntry {
  path: string;
  message: string;
}

/** `POST /provisioning/manifests/validate` response — never throws for an invalid manifest, only for transport-level failures. */
export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationErrorEntry[];
}

/** Stored revision shape (`IManifestRevision` downstream) — returned by `put()`/`get()`. */
export interface ManifestRevision {
  id: string;
  tenantId: string;
  name: string;
  revision: number;
  manifest: Record<string, unknown>;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * Mirrors provisioning-service's `ResourceKind`
 * (`services/provisioning-service/src/modules/plan/domain/plan.interfaces.ts`),
 * itself `= SecretScopeKind` from `@yoizen/shared`'s manifest schema.
 * `"systemVariable"` (T04) and `"mcpServer"` (T06) added in
 * `manual-loops/provisioning-manifest-gaps.md` T07 so `plan()`/`apply()`
 * responses for manifests with `systemVariables[]`/`mcpServers[]` sections
 * type-check against the real server payload shape. `"skill"` added
 * (manual-loops/provisioning-manifest-gaps-3.md T01, workstream a) for the
 * same reason, so `plan()`/`apply()` responses for manifests with a
 * `skills[]` section type-check too.
 */
export type ResourceKind =
  | "channel"
  | "connector"
  | "agent"
  | "service"
  | "systemVariable"
  | "mcpServer"
  | "skill"
  | "workflow";

export type ResourceVerdict = "create" | "update" | "noop";

/** One differing top-level field between the live resource and the manifest's desired shape (`FieldDiff` downstream). */
export interface ManifestFieldDiff {
  field: string;
  current: unknown;
  desired: unknown;
}

export interface ManifestResourcePlanEntry {
  kind: ResourceKind;
  name: string;
  external: boolean;
  verdict: ResourceVerdict;
  /** Populated only for `verdict === "update"`. */
  diff: ManifestFieldDiff[];
  externalId?: string;
}

export type ManifestPlanPreconditionKind =
  | "missing_secret"
  | "unresolvable_external_ref"
  | "downstream_error";

export interface ManifestPlanPrecondition {
  kind: ManifestPlanPreconditionKind;
  resourceKind: ResourceKind;
  resourceName: string;
  refType?: string;
  refValue?: string;
  message: string;
}

export type KbDocumentPlanAction =
  | "create"
  | "reembed"
  | "skip"
  | "pending_fetch";

export interface KbDocumentPlanEntry {
  documentName: string;
  action: KbDocumentPlanAction;
  chunkEstimate?: number;
}

export interface KbPlanEntry {
  kbName: string;
  external: boolean;
  documents: KbDocumentPlanEntry[];
  reembedCount: number;
  chunkEstimateTotal?: number;
  summary: string;
}

/** `POST /provisioning/manifests/:name/plan` response (200 — 404/409 surface as `NotFoundError`/`ConflictError`, see `client.ts`). */
export interface ManifestPlan {
  manifestName: string;
  resources: ManifestResourcePlanEntry[];
  preconditions: ManifestPlanPrecondition[];
  knowledgeBases?: KbPlanEntry[];
}

/** One resource that was actually acted on (verdict `create` or `update`). */
export interface ManifestResourceApplyOutcome {
  kind: ResourceKind;
  name: string;
  verdict: "create" | "update";
  externalId: string;
}

/** A resource the planner marked `noop` — nothing was written. */
export interface ManifestResourceNoopOutcome {
  kind: ResourceKind;
  name: string;
  verdict: "noop";
  externalId?: string;
}

export type ManifestResourceOutcome =
  | ManifestResourceApplyOutcome
  | ManifestResourceNoopOutcome;

export interface ReconcileKbDocumentOutcome {
  documentName: string;
  /** Apply-side actions only — `pending_fetch` exists solely in plans. */
  action: "create" | "reembed" | "skip";
  documentExternalId?: string;
  [key: string]: unknown;
}

/**
 * Mirrors provisioning-service's `ReconcileKbOutcome`
 * (`modules/kb/domain/kb.interfaces.ts`): one entry per KB with its
 * per-document outcomes NESTED — not one flat entry per document. The SDK
 * shipped the flat shape by mistake until 2026-08-11, which made the CLI
 * print `<kb>/undefined: undefined` after every apply.
 */
export interface ReconcileKbOutcome {
  kbName: string;
  kbExternalId: string;
  documents: ReconcileKbDocumentOutcome[];
  [key: string]: unknown;
}

/**
 * `POST /provisioning/manifests/:name/apply` response (200, `ManifestApplySuccess`
 * downstream). Failures (`manifest_not_found` -> 404, `cycle_detected` ->
 * 409, `apply_failed`/precondition/plan errors -> 409) all surface as thrown
 * `NotFoundError`/`ConflictError` — `error.details.body` carries the typed
 * error payload for inspection (partial-failure `applied`/`pending`
 * resources live there, so a caller can decide whether to re-apply to
 * resume).
 */
export interface ManifestApplyResult {
  manifestName: string;
  resources: ManifestResourceOutcome[];
  appliedCount: number;
  noopCount: number;
  durationMs: number;
  knowledgeBases?: ReconcileKbOutcome[];
}

/**
 * `apply()`'s optional KB content bundle. T06's `ApplyManifestRequestBody`
 * shape: tar bytes are base64-encoded into the JSON body as
 * `{ bundle: { contentBase64 } }` — there is no `manifest` field in the
 * apply request body (apply always operates on the LATEST stored revision
 * for `name`, put via `manifests.put()` beforehand).
 */
export interface ManifestApplyBundle {
  /** Raw tar bytes — base64-encoded by the client before sending. */
  bundle: Uint8Array;
}

/* ── undeploy (PENDIENTES/12-undeploy.spec.md T02) ───────────────────────────
 *
 * EVERY type below mirrors, FIELD FOR FIELD, the service interfaces in
 * `services/provisioning-service/src/modules/undeploy/domain/undeploy.interfaces.ts`
 * (T01). Only the TYPE NAMES are prefixed for this namespace (the downstream
 * name is cited on each). Nothing is flattened, renamed, or dropped: the
 * `ReconcileKbOutcome` drift fixed in commit d6fca63f (the SDK shipped a FLAT
 * per-document shape while the service nested documents inside a per-KB
 * entry, which made the CLI print `<kb>/undefined: undefined`) is the exact
 * failure mode this rule exists to prevent — if the service nests, the SDK
 * nests.
 */

/**
 * Mirrors `UndeployResourceKind` — `ResourceKind` widened with
 * `"knowledgeBase"`, because a knowledge base is a manifest-owned resource
 * with its own reconciler instead of a generic writer, so it is deliberately
 * NOT a member of `ResourceKind` itself (see the downstream doc comment).
 */
export type UndeployResourceKind = ResourceKind | "knowledgeBase";

/**
 * Mirrors `UndeployAction` — what undeploy DID with one declared resource:
 * - `deleted` — the downstream admin API accepted the DELETE;
 * - `not_found` — nothing live matched the deletion key (already gone or
 *   never applied). Decision 6: a SUCCESS, undeploy is idempotent;
 * - `skipped_external` — the manifest marks the resource `external: true`, so
 *   it was never owned and is never deleted (decision 4);
 * - `skipped_no_delete_api` — the downstream admin API exposes no delete
 *   route. No kind is in this state today (all nine were live-verified
 *   2026-08-12); the member exists so an unwired kind degrades loudly.
 */
export type UndeployAction =
  | "deleted"
  | "not_found"
  | "skipped_external"
  | "skipped_no_delete_api";

/** Mirrors `ResourceUndeployOutcome`. */
export interface ResourceUndeployOutcome {
  kind: UndeployResourceKind;
  name: string;
  action: UndeployAction;
  /** Live platform id that was deleted — set only for `action: "deleted"`. */
  externalId?: string;
}

/**
 * Mirrors `SecretUndeployOutcome` — one `secrets:` binding of the manifest.
 * Decision 2 of that spec: secrets die with the manifest, deleted AFTER their
 * owner resource. Same `UndeployAction` union as a resource, because a
 * binding inherits its owner's fate.
 */
export interface SecretUndeployOutcome {
  name: string;
  scope: SecretScope;
  action: UndeployAction;
}

/** Mirrors `UndeployErrorKind` — the typed reasons ONE delete step can fail. */
export type UndeployErrorKind = "downstream_error" | "lookup_failed";

/** Mirrors `UndeployStepError`. */
export interface UndeployStepError {
  kind: UndeployErrorKind;
  resourceKind: UndeployResourceKind | "secret";
  resourceName: string;
  message: string;
}

/**
 * `POST /provisioning/manifests/:name/undeploy` response (200) — mirrors
 * `ManifestUndeploySuccess` (renamed `...Result` here for symmetry with
 * `ManifestApplyResult`, which mirrors `ManifestApplySuccess` the same way).
 *
 * Failures surface as thrown errors, exactly like `apply()`: `NotFoundError`
 * (404 — no stored manifest, i.e. ALREADY UNDEPLOYED after a first full run,
 * since the record is deleted last) and `ConflictError` (409 —
 * `undeploy_blocked`, `cycle_detected`, or a partial run). The typed body
 * lives in `error.details.body.error` (see `ManifestUndeployFailure` /
 * `UndeployBlockedError`).
 */
export interface ManifestUndeployResult {
  manifestName: string;
  /** Every declared resource, in REVERSE dependency order, with its outcome. */
  resources: ResourceUndeployOutcome[];
  /** Every declared `secrets:` binding, each processed after its owner resource. */
  secrets: SecretUndeployOutcome[];
  deletedCount: number;
  notFoundCount: number;
  skippedCount: number;
  /** `kb_document_checksums` rows removed for this manifest (provisioning's own state). */
  checksumRowsDeleted: number;
  /** True once the stored manifest record itself was deleted (LAST step). */
  manifestRecordDeleted: boolean;
  durationMs: number;
}

/**
 * Mirrors `ManifestUndeployFailure` — the 409 body of a PARTIAL run
 * (`error.details.body.error`). The stored manifest is kept, so re-running
 * `undeploy` resumes from whatever is still live.
 */
export interface ManifestUndeployFailure {
  kind: "undeploy_failed";
  manifestName: string;
  /** Resources processed BEFORE the failure (reverse dependency order). */
  resources: ResourceUndeployOutcome[];
  /** Secret bindings processed BEFORE the failure. */
  secrets: SecretUndeployOutcome[];
  /** Declared resources undeploy never reached (reverse dependency order). */
  pending: { kind: UndeployResourceKind; name: string }[];
  failure: UndeployStepError;
  /** ALWAYS false on this branch — the contract decision 6 leans on. */
  manifestRecordDeleted: false;
  durationMs: number;
}

/** Mirrors `BlockingReference` — one (manifest, resource) pair blocking the teardown. */
export interface UndeployBlockingReference {
  /** The OTHER stored manifest that references the resource as `external: true`. */
  manifestName: string;
  resourceKind: UndeployResourceKind;
  resourceName: string;
}

/**
 * Mirrors `UndeployBlockedError` — decision 4's shared-resource guard: another
 * stored manifest of the same tenant consumes a resource this manifest owns,
 * so undeploy REFUSES with 409 listing every manifest+resource pair. No
 * `--force` in v1.
 */
export interface UndeployBlockedError {
  kind: "undeploy_blocked";
  manifestName: string;
  dependents: UndeployBlockingReference[];
  message: string;
}
