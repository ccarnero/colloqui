import { err, ok, type Result } from "../lib/result.js";
import { CliError } from "./cli-error.js";

/**
 * `plan`/`apply` need the manifest's `metadata.name` to call
 * `client.manifests.put(name, manifest)`/`.plan(name)`/`.apply(name)` — the
 * manifest object itself is a `Record<string, unknown>` at the SDK boundary
 * (no `@yoizen/shared` dependency, see `resources/manifests/types.ts`), so
 * this reads it back out defensively rather than assuming the shape.
 */
export function extractManifestName(
  manifest: Record<string, unknown>
): Result<string, CliError> {
  const metadata = manifest.metadata;
  if (typeof metadata !== "object" || metadata === null) {
    return err(new CliError("manifest is missing a 'metadata' object"));
  }
  const name = (metadata as Record<string, unknown>).name;
  if (typeof name !== "string" || name.length === 0) {
    return err(
      new CliError("manifest is missing 'metadata.name' (a non-empty string)")
    );
  }
  return ok(name);
}
