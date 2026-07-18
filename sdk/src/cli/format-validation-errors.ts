/**
 * Renders a `PUT /manifests/:name` 400 validation body
 * (`{ valid: false, errors: [{ path, message }] }`, see
 * `manifests.controller.ts` / `@yoizen/shared`'s `ManifestValidationError`)
 * into `  <path>: <message>` lines — the SAME shape
 * `handle-manifests-command.ts` already prints for `manifests validate`.
 *
 * Returns `undefined` (not an empty array) when `errors` is absent or holds
 * no well-formed entries, so `format-error-detail.ts` can fall through to the
 * next renderer instead of treating "recognized shape, zero lines" as a hit.
 */
export function formatValidationErrors(
  bodyRecord: Record<string, unknown>
): string[] | undefined {
  if (!Array.isArray(bodyRecord.errors)) {
    return undefined;
  }
  const lines: string[] = [];
  for (const entry of bodyRecord.errors) {
    if (
      entry &&
      typeof entry === "object" &&
      "path" in entry &&
      "message" in entry
    ) {
      const { path, message } = entry as { path: unknown; message: unknown };
      lines.push(`  ${String(path)}: ${String(message)}`);
    }
  }
  return lines.length > 0 ? lines : undefined;
}
