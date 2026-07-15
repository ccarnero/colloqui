// Pure checksum-reconciliation decision (SPEC.md decision 6): unchanged
// sha256 -> skip re-embedding; changed -> re-index only that document;
// never-seen-before -> create.

export type DocumentReconcileAction = "create" | "reembed" | "skip";

export function decideDocumentAction(
  storedSha256: string | undefined,
  currentSha256: string
): DocumentReconcileAction {
  if (storedSha256 === undefined) {
    return "create";
  }
  if (storedSha256 === currentSha256) {
    return "skip";
  }
  return "reembed";
}
