/**
 * `@yoizen/platform-sdk/manifests` — the `manifests` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `connectors` reference implementation, SPEC.md
 * `manual-loops/declarative-provisioning.md` T08).
 */

export type {
  ManifestApplyOptions,
  ManifestCallOptions,
  ManifestsClient,
  ManifestsClientDeps,
} from "./client.js";
export { createManifestsClient } from "./client.js";
export type {
  KbDocumentPlanAction,
  KbDocumentPlanEntry,
  KbPlanEntry,
  ManifestApplyBundle,
  ManifestApplyResult,
  ManifestFieldDiff,
  ManifestPlan,
  ManifestPlanPrecondition,
  ManifestPlanPreconditionKind,
  ManifestResourceApplyOutcome,
  ManifestResourceNoopOutcome,
  ManifestResourceOutcome,
  ManifestResourcePlanEntry,
  ManifestRevision,
  ManifestUndeployFailure,
  ManifestUndeployResult,
  ManifestValidationErrorEntry,
  ManifestValidationResult,
  ReconcileKbOutcome,
  ResourceKind,
  ResourceUndeployOutcome,
  ResourceVerdict,
  SecretUndeployOutcome,
  UndeployAction,
  UndeployBlockedError,
  UndeployBlockingReference,
  UndeployErrorKind,
  UndeployResourceKind,
  UndeployStepError,
} from "./types.js";
