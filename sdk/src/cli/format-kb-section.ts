import type {
  KbPlanEntry,
  ReconcileKbOutcome,
} from "../resources/manifests/types.js";

/**
 * Formats the knowledge-base section printed AFTER the per-resource verdict
 * table. Knowledge bases are reconciled per-document (create/reembed/keep/
 * pending_fetch), so they do not fit the strict `create|update|noop` verdict
 * contract `format-verdict-table.ts` documents — they get their own section
 * instead of rows in that table, leaving G5's greppable table untouched.
 * Returns [] when there is nothing to print (no section header for an empty
 * or absent kb list).
 */
export function formatKbPlanSection(
  entries: readonly KbPlanEntry[] | undefined
): string[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const lines = ["", "KNOWLEDGE BASES:"];
  for (const entry of entries) {
    lines.push(`  ${entry.kbName}: ${entry.summary}`);
    for (const document of entry.documents) {
      const chunkSuffix =
        document.chunkEstimate !== undefined
          ? ` (~${document.chunkEstimate} chunks)`
          : "";
      lines.push(
        `    ${document.documentName}: ${document.action}${chunkSuffix}`
      );
    }
  }
  return lines;
}

export function formatKbApplySection(
  outcomes: readonly ReconcileKbOutcome[] | undefined
): string[] {
  if (!outcomes || outcomes.length === 0) {
    return [];
  }
  const lines = ["", "KNOWLEDGE BASES:"];
  for (const outcome of outcomes) {
    lines.push(
      `  ${outcome.kbName}/${outcome.documentName}: ${outcome.action}`
    );
  }
  return lines;
}
