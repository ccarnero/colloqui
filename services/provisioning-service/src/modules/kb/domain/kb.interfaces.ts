// Types for the T06 knowledge-base reconciler
// (manual-loops/declarative-provisioning.md).
//
// KBs are deliberately NOT folded into `ResourceKind`/`PlatformResourceClients`/
// `PlatformResourceWriters` (the generic T03/T04 dependency-ordered pipeline):
// those ports model "one manifest resource -> one existing-service create/update
// call" with no side channel, but KB reconciliation needs THREE extra inputs
// the generic writer signature has no room for — the per-apply-call content
// bundle (tar, multipart), the checksum-reconciliation decision (this
// service's OWN bookkeeping, read before every write), and a guarded
// server-side fetch for `url:` sources. Coercing that into
// `IPlatformResourceWriter.create(tenantId, resource, context)` would either
// smuggle the bundle through `WriterContext` for every writer (leaking a
// KB-specific concern into channel/connector/service/workflow writers) or
// force `AnyManifestResource` to carry bundle bytes (violating the manifest's
// own "structure and wiring only" contract, decision 3). Instead KBs are
// reconciled by a dedicated `IKnowledgeBaseReconciler`, run BEFORE the
// generic `applyManifestPlan` call, whose only channel back into the generic
// pipeline is a `name -> externalId` map threaded through
// `WriterContext.knowledgeBaseExternalIds` so `agents-writer.ts` can resolve
// `knowledgeBaseRefs` (SPEC.md: "KB before agent").
//
// manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — UPDATE: KBs are
// no longer reconciled strictly BEFORE `applyManifestPlan` starts. A KB's
// `ingestion_config.provider_connector_id` may reference a connector CREATED
// in the SAME apply run, and connectors are resolved/created INSIDE
// `applyManifestPlan`'s dependency-ordered loop — reconciling KBs first (the
// pre-T03-gap-2 order) could never see that connector's freshly-created id.
// `apply-manifest.ts`'s `reconcileKnowledgeBases` hook now calls this
// reconciler MID-LOOP, right after every "connector"-kind resource has been
// created/updated/noop'd and before the next resource kind begins (still
// strictly before "agent", preserving the original "KB before agent"
// contract) — see that file for the exact boundary logic.

import type { KbSource, SymbolicRefType } from "@yoizen/shared";

/** Resolves `(refType, manifestName) -> realId`, mirrors
 * `build-substituted-resource.ts`'s `resolveRef` shape exactly — passed by
 * `apply-manifest.ts`'s `reconcileKnowledgeBases` hook so `reconcile()` can
 * substitute a `provider_connector_id` ref before CREATING a new KB. */
export type KbResolveRef = (
  refType: SymbolicRefType,
  name: string
) => string | undefined;

/** Extracted tar bundle contents: relative path -> file bytes. */
export type KbBundle = ReadonlyMap<string, Buffer>;

export type ResolveKbSourceErrorKind =
  | "file_not_in_bundle"
  | "file_checksum_mismatch"
  | "file_too_large"
  | "url_rejected"
  | "url_fetch_failed"
  | "url_too_large";

export interface ResolveKbSourceError {
  readonly kind: ResolveKbSourceErrorKind;
  readonly message: string;
}

/** Content resolved from a `KbSource`, ready to hand to agent-admin's upload API. */
export interface ResolvedKbDocumentContent {
  readonly sha256: string;
  readonly bytes: Buffer;
  /** `text` -> agent-admin's `upload` (content_text) endpoint; `file` -> `upload-file` (base64). */
  readonly uploadMode: "text" | "file";
}

export interface ReconcileDocumentOutcome {
  readonly documentName: string;
  readonly action: "create" | "reembed" | "skip";
  readonly documentExternalId?: string;
}

export interface ReconcileKbOutcome {
  readonly kbName: string;
  readonly kbExternalId: string;
  readonly documents: readonly ReconcileDocumentOutcome[];
}

export type KbReconcileErrorKind =
  | "kb_write_failed"
  | "document_resolve_failed"
  | "document_write_failed"
  // manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — a KB's
  // `ingestion_config.provider_connector_id` failed the SAME T02/T03
  // fail-loud checks a workflow/agent tree's allowlisted refs would (see
  // `substitute-symbolic-refs.ts`); reused verbatim (same string literal
  // kinds, same walker), never a bespoke KB-only error kind.
  | "unresolved_symbolic_ref"
  | "mismatched_symbolic_ref"
  | "unallowlisted_symbolic_ref";

export interface KbReconcileError {
  readonly kind: KbReconcileErrorKind;
  readonly kbName: string;
  readonly documentName?: string;
  readonly message: string;
}

export interface IKnowledgeBaseReconciler {
  /**
   * Reconciles every non-external `knowledgeBases` entry of `manifest`
   * against agent-admin-service (create-or-update by name, never a direct
   * table write) and returns a `kbName -> kbExternalId` map for
   * `agents-writer.ts` to resolve `knowledgeBaseRefs`.
   *
   * `resolveRef` (manual-loops/provisioning-manifest-gaps-2.md T03, gap 2)
   * is used ONLY when CREATING a new (non-external) KB whose
   * `ingestion_config` embeds a `{ connectorRef: <name> }` at
   * `provider_connector_id` — substituted to the real connector-admin id via
   * `substitute-kb-ingestion-config.ts` before `IAgentAdminKbClient.createKb`
   * is called. Omitted (or `undefined`) call sites (pre-T03-gap-2 tests, or
   * a manifest with no `ingestion_config`) behave exactly as before.
   */
  reconcile(
    tenantId: string,
    manifestName: string,
    manifest: {
      spec: { knowledgeBases: readonly ManifestKnowledgeBaseLike[] };
    },
    bundle: KbBundle | undefined,
    correlationId: string | undefined,
    resolveRef?: KbResolveRef
  ): Promise<
    | { readonly ok: true; readonly value: readonly ReconcileKbOutcome[] }
    | { readonly ok: false; readonly error: KbReconcileError }
  >;
}

/** Narrow structural type so this module doesn't need the full `IntegrationManifest` import cycle. */
export interface ManifestKnowledgeBaseLike {
  readonly name: string;
  readonly external?: boolean;
  readonly documents: readonly {
    readonly name: string;
    readonly source: KbSource;
  }[];
  /** manual-loops/provisioning-manifest-gaps-2.md T03, gap 2 — opaque, may
   * embed `{ connectorRef: <name> }` at `provider_connector_id`. */
  readonly ingestion_config?: Record<string, unknown>;
}

export const KB_RECONCILER = Symbol("KB_RECONCILER");

/** No-op reconciler for tests / manifests with no `knowledgeBases`. */
export const NOOP_KB_RECONCILER: IKnowledgeBaseReconciler = {
  async reconcile() {
    return { ok: true, value: [] };
  },
};
