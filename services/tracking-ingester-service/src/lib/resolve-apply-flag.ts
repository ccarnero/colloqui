// Resolves whether the T03 (payload-capture) scrub script runs in DRY-RUN
// (default) or APPLY mode. Pure — takes `process.argv` as plain input so the
// dry-run/apply decision is unit-testable without touching `process` itself.

/** DRY-RUN by default; APPLY only when the caller passes `--apply` verbatim. */
export function resolveApplyFlag(argv: readonly string[]): boolean {
  return argv.includes("--apply");
}
