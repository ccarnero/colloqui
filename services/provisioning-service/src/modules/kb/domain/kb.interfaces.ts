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

import type { KbSource } from "@yoizen/shared";

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
  | "document_write_failed";

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
   */
  reconcile(
    tenantId: string,
    manifestName: string,
    manifest: {
      spec: { knowledgeBases: readonly ManifestKnowledgeBaseLike[] };
    },
    bundle: KbBundle | undefined,
    correlationId: string | undefined
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
}

export const KB_RECONCILER = Symbol("KB_RECONCILER");

/** No-op reconciler for tests / manifests with no `knowledgeBases`. */
export const NOOP_KB_RECONCILER: IKnowledgeBaseReconciler = {
  async reconcile() {
    return { ok: true, value: [] };
  },
};
