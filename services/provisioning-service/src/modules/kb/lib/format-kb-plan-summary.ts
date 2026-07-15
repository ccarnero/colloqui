// Pure formatter for the T06 "plan reports the embedding cost before it is
// paid" requirement (SPEC.md decision 6).

export function formatKbPlanSummary(
  kbName: string,
  reembedCount: number,
  chunkEstimateTotal: number | undefined
): string {
  if (reembedCount === 0) {
    return `knowledge base '${kbName}': no documents to re-embed`;
  }
  const documentWord = reembedCount === 1 ? "document" : "documents";
  const chunkPart =
    chunkEstimateTotal !== undefined
      ? ` (~${String(chunkEstimateTotal)} chunks)`
      : "";
  return `knowledge base '${kbName}': will re-embed ${String(reembedCount)} ${documentWord}${chunkPart}`;
}
