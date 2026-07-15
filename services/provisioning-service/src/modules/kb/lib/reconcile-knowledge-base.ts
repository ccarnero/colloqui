// T06 apply-time KB reconciler: create-or-update each non-external
// `knowledgeBases` entry via agent-admin-service's EXISTING API (never a
// direct table write), applying the checksum-reconciliation decision per
// document (skip unchanged, reembed changed, create new). Runs BEFORE the
// generic `applyManifestPlan` call — see `kb.interfaces.ts` header for why.

import type { KbSource } from "@yoizen/shared";
import type { PlanLogger } from "../../plan/lib/plan-logger.interface";
import { NOOP_PLAN_LOGGER } from "../../plan/lib/plan-logger.interface";
import type {
  IKnowledgeBaseReconciler,
  KbBundle,
  KbReconcileError,
  ManifestKnowledgeBaseLike,
  ReconcileDocumentOutcome,
  ReconcileKbOutcome,
} from "../domain/kb.interfaces";
import type { IKbBlobStore } from "../domain/kb-blob-store.interface";
import type { IKbChecksumRepository } from "../domain/kb-checksum-repository.interface";
import type { IAgentAdminKbClient } from "../infrastructure/agent-admin-kb-client";
import { decideDocumentAction } from "./decide-document-action";
import { fetchKbUrlSource } from "./fetch-kb-url-source";
import { resolveInlineOrFileSource } from "./resolve-kb-document-source";

export interface CreateKnowledgeBaseReconcilerDeps {
  readonly kbClient: IAgentAdminKbClient;
  readonly checksumRepository: IKbChecksumRepository;
  readonly blobStore: IKbBlobStore;
  readonly logger?: PlanLogger;
}

export function createKnowledgeBaseReconciler(
  deps: CreateKnowledgeBaseReconcilerDeps
): IKnowledgeBaseReconciler {
  const logger = deps.logger ?? NOOP_PLAN_LOGGER;

  return {
    async reconcile(tenantId, manifestName, manifest, bundle, _correlationId) {
      const outcomes: ReconcileKbOutcome[] = [];

      for (const kb of manifest.spec
        .knowledgeBases as readonly ManifestKnowledgeBaseLike[]) {
        if (kb.external) {
          logger.log(`kb: '${kb.name}' is external — skipping reconciliation`);
          continue;
        }

        const kbResult = await findOrCreateKb(deps, tenantId, kb.name, logger);
        if (!kbResult.ok) {
          return { ok: false, error: kbResult.error };
        }
        const kbExternalId = kbResult.value;

        const documentOutcomes: ReconcileDocumentOutcome[] = [];
        for (const doc of kb.documents) {
          const outcomeResult = await reconcileDocument(
            deps,
            tenantId,
            manifestName,
            kb.name,
            kbExternalId,
            doc.name,
            doc.source,
            bundle,
            logger
          );
          if (!outcomeResult.ok) {
            return { ok: false, error: outcomeResult.error };
          }
          documentOutcomes.push(outcomeResult.value);
        }

        outcomes.push({
          kbName: kb.name,
          kbExternalId,
          documents: documentOutcomes,
        });
      }

      return { ok: true, value: outcomes };
    },
  };
}

async function findOrCreateKb(
  deps: CreateKnowledgeBaseReconcilerDeps,
  tenantId: string,
  kbName: string,
  logger: PlanLogger
): Promise<
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: KbReconcileError }
> {
  const lookup = await deps.kbClient.findKbByName(tenantId, kbName);
  if (!lookup.ok) {
    return {
      ok: false,
      error: { kind: "kb_write_failed", kbName, message: lookup.error },
    };
  }
  if (lookup.value) {
    logger.log(
      `kb: '${kbName}' already exists -> externalId='${lookup.value.id}' (update-in-place — no mutable KB fields to reconcile in T06)`
    );
    return { ok: true, value: lookup.value.id };
  }

  const created = await deps.kbClient.createKb(tenantId, kbName);
  if (!created.ok) {
    return {
      ok: false,
      error: { kind: "kb_write_failed", kbName, message: created.error },
    };
  }
  logger.log(`kb: '${kbName}' created -> externalId='${created.value.id}'`);
  return { ok: true, value: created.value.id };
}

async function reconcileDocument(
  deps: CreateKnowledgeBaseReconcilerDeps,
  tenantId: string,
  manifestName: string,
  kbName: string,
  kbExternalId: string,
  documentName: string,
  source: KbSource,
  bundle: KbBundle | undefined,
  logger: PlanLogger
): Promise<
  | { readonly ok: true; readonly value: ReconcileDocumentOutcome }
  | { readonly ok: false; readonly error: KbReconcileError }
> {
  const resolved =
    source.type === "url"
      ? await fetchKbUrlSource(source.url)
      : resolveInlineOrFileSource(source, bundle);

  if (!resolved.ok) {
    return {
      ok: false,
      error: {
        kind: "document_resolve_failed",
        kbName,
        documentName,
        message: resolved.error.message,
      },
    };
  }

  const stored = await deps.checksumRepository.getChecksum(
    tenantId,
    manifestName,
    kbName,
    documentName
  );
  const action = decideDocumentAction(stored?.sha256, resolved.value.sha256);

  logger.log(
    `kb: document '${documentName}' (kb='${kbName}') action='${action}' sha256='${resolved.value.sha256.slice(0, 12)}...'`
  );

  if (action === "skip") {
    return {
      ok: true,
      value: {
        documentName,
        action: "skip",
        documentExternalId: stored?.documentExternalId,
      },
    };
  }

  // Content-addressed blob store: best-effort store for `file:` sources so
  // identical bytes are addressable across apply runs (decision 6). Never
  // blocks reconciliation — a store failure only means a future apply
  // cannot dedupe by blob key, the document itself still gets embedded.
  if (source.type === "file") {
    const stashed = await deps.blobStore.putBlob(
      tenantId,
      resolved.value.sha256,
      resolved.value.bytes
    );
    if (!stashed.ok) {
      logger.warn(
        `kb: document '${documentName}' blob store FAILED (non-fatal): ${stashed.error}`
      );
    }
  }

  const uploadResult =
    resolved.value.uploadMode === "file"
      ? await deps.kbClient.uploadFileDocument(
          tenantId,
          kbExternalId,
          documentName,
          resolved.value.bytes.toString("base64")
        )
      : await deps.kbClient.uploadTextDocument(
          tenantId,
          kbExternalId,
          documentName,
          resolved.value.bytes.toString("utf8")
        );

  if (!uploadResult.ok) {
    return {
      ok: false,
      error: {
        kind: "document_write_failed",
        kbName,
        documentName,
        message: uploadResult.error,
      },
    };
  }

  // Re-embed of a previously-applied document: agent-admin has no
  // "replace content" endpoint, so the reconciler uploads the new content
  // as a fresh document, then deletes the superseded one — re-indexing
  // ONLY this document, never the whole KB (SPEC.md decision 6).
  if (action === "reembed" && stored?.documentExternalId) {
    const deleted = await deps.kbClient.deleteDocument(
      tenantId,
      kbExternalId,
      stored.documentExternalId
    );
    if (!deleted.ok) {
      logger.warn(
        `kb: document '${documentName}' old-version delete FAILED (non-fatal): ${deleted.error}`
      );
    }
  }

  await deps.checksumRepository.upsertChecksum(
    tenantId,
    manifestName,
    kbName,
    documentName,
    {
      sha256: resolved.value.sha256,
      kbExternalId,
      documentExternalId: uploadResult.value.documentId,
    }
  );

  return {
    ok: true,
    value: {
      documentName,
      action,
      documentExternalId: uploadResult.value.documentId,
    },
  };
}
