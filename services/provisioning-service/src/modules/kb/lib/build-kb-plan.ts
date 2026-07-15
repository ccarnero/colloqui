// T06 read-only KB plan: reports create/reembed/skip per document and the
// "will re-embed N documents (~M chunks)" cost estimate BEFORE any embedding
// is paid for (SPEC.md decision 6). Pure — the only "read" here is
// `storedChecksumLookup`, a synchronous function the caller resolves from
// its own checksum repository before calling this (kept synchronous so this
// function itself stays trivially unit-testable without an async DB fake).
//
// `file:` sources are compared using the manifest-DECLARED sha256 (trusted —
// same value `resolveInlineOrFileSource` will verify the bundle against at
// apply time) since the bundle itself is an apply-time-only artifact; plan
// never requires the bundle to be uploaded. `url:` sources cannot be
// checksummed without a network fetch, which plan must never perform (T03's
// "NEVER mutates/side-effects" contract) — those documents are conservatively
// reported as `pending_fetch` and always counted toward the re-embed
// estimate, biasing the estimate toward over- rather than under-reporting.

import type { IntegrationManifest } from "@yoizen/shared";
import type {
  KbDocumentPlanEntry,
  KbPlanEntry,
} from "../../plan/domain/plan.interfaces";
import { computeSha256 } from "./compute-sha256";
import { decideDocumentAction } from "./decide-document-action";
import { formatKbPlanSummary } from "./format-kb-plan-summary";

/** Matches `documents.service.ts`'s default `chunk_size` (1000 chars) — a
 * best-effort estimate only, real chunking may split differently. */
const CHARS_PER_CHUNK_ESTIMATE = 1000;

export type StoredKbChecksumLookup = (
  kbName: string,
  documentName: string
) => string | undefined;

export function buildKbPlan(
  manifest: IntegrationManifest,
  storedChecksumLookup: StoredKbChecksumLookup
): readonly KbPlanEntry[] {
  // Defensive: a manifest read back from JSONB storage always carries
  // `knowledgeBases` (the T01 schema applies `.default([])` at parse time),
  // but guard against a `?? []` gap so a malformed row can never throw here
  // and blank the whole plan response.
  const knowledgeBases = manifest.spec.knowledgeBases ?? [];
  return knowledgeBases.map((kb) => {
    if (kb.external) {
      return {
        kbName: kb.name,
        external: true,
        documents: [],
        reembedCount: 0,
        summary: `knowledge base '${kb.name}' is external — no reconciliation`,
      };
    }

    const documents: KbDocumentPlanEntry[] = kb.documents.map((doc) => {
      if (doc.source.type === "url") {
        return { documentName: doc.name, action: "pending_fetch" };
      }

      const currentSha256 =
        doc.source.type === "inline"
          ? computeSha256(doc.source.content)
          : doc.source.sha256;
      const storedSha256 = storedChecksumLookup(kb.name, doc.name);
      const action = decideDocumentAction(storedSha256, currentSha256);
      const chunkEstimate =
        doc.source.type === "inline"
          ? Math.max(
              1,
              Math.ceil(doc.source.content.length / CHARS_PER_CHUNK_ESTIMATE)
            )
          : undefined;

      return { documentName: doc.name, action, chunkEstimate };
    });

    const reembedCount = documents.filter(
      (d) =>
        d.action === "create" ||
        d.action === "reembed" ||
        d.action === "pending_fetch"
    ).length;

    const knownChunkEstimates = documents
      .filter((d) => d.action === "create" || d.action === "reembed")
      .map((d) => d.chunkEstimate)
      .filter((v): v is number => v !== undefined);
    const chunkEstimateTotal =
      knownChunkEstimates.length > 0
        ? knownChunkEstimates.reduce((sum, v) => sum + v, 0)
        : undefined;

    return {
      kbName: kb.name,
      external: false,
      documents,
      reembedCount,
      chunkEstimateTotal,
      summary: formatKbPlanSummary(kb.name, reembedCount, chunkEstimateTotal),
    };
  });
}
