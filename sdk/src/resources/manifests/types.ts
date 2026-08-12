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
