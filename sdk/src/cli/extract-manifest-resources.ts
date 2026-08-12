import { err, ok, type Result } from "../lib/result.js";
import type { UndeployResourceKind } from "../resources/manifests/index.js";
import { CliError } from "./cli-error.js";

/** One resource declared by a manifest, as the `undeploy` preview lists it. */
export interface CliManifestResource {
  kind: UndeployResourceKind;
  name: string;
  /** `external: true` in the manifest — never owned, so undeploy never deletes it. */
  external: boolean;
}

/**
 * Section -> resource kind, mirroring provisioning-service's
 * `plan/lib/list-manifest-resources.ts` (same sections, same kind spelling,
 * same declaration order) plus `knowledgeBases` -> `knowledgeBase`, which
 * that helper omits because a KB has its own reconciler rather than a generic
 * writer — undeploy DOES delete knowledge bases
 * (`undeploy/lib/build-undeploy-order.ts`), so the preview must list them.
 */
const SECTION_TO_KIND: readonly (readonly [string, UndeployResourceKind])[] = [
  ["channels", "channel"],
  ["connectors", "connector"],
  ["mcpServers", "mcpServer"],
  ["skills", "skill"],
  ["agents", "agent"],
  ["services", "service"],
  ["systemVariables", "systemVariable"],
  ["workflows", "workflow"],
  ["knowledgeBases", "knowledgeBase"],
];

/**
 * Reads every resource a parsed manifest object declares (kind + name +
 * `external` flag) so `yoizen manifests undeploy` can PREVIEW what a run
 * would delete without calling the server — the manifest file is the only
 * input the CLI has before the user confirms with `--yes`, and the preview
 * must never mutate anything (not even a stored revision).
 *
 * Two honest limits of a client-side preview, both documented in the printed
 * output (`handle-manifests-command.ts`):
 * - ORDER is the manifest's declaration order, not the REVERSE dependency
 *   order the server computes (`undeploy/lib/build-undeploy-order.ts` derives
 *   it from apply's own topological order — it needs the ref graph, which
 *   lives server-side);
 * - LIVENESS is unknown: a listed resource may already be gone (the run then
 *   reports `not_found`, decision 6) — the preview lists what the manifest
 *   OWNS, not what is currently live.
 *
 * Reads defensively (the manifest is a `Record<string, unknown>` at the SDK
 * boundary, see `resources/manifests/types.ts`): an absent `spec`/section is
 * simply nothing to delete, a malformed one IS an error with a precise path,
 * mirroring `extract-secret-bindings.ts`'s style.
 */
export function extractManifestResources(
  manifest: Record<string, unknown>
): Result<CliManifestResource[], CliError> {
  const spec = manifest.spec;
  if (spec === undefined) {
    return ok([]);
  }
  if (typeof spec !== "object" || spec === null) {
    return err(new CliError("manifest 'spec' must be an object"));
  }
  const specRecord = spec as Record<string, unknown>;

  const resources: CliManifestResource[] = [];
  for (const [section, kind] of SECTION_TO_KIND) {
    const entries = specRecord[section];
    if (entries === undefined) {
      continue;
    }
    if (!Array.isArray(entries)) {
      return err(new CliError(`manifest 'spec.${section}' must be an array`));
    }
    for (let index = 0; index < entries.length; index += 1) {
      const entry: unknown = entries[index];
      const path = `spec.${section}[${index}]`;
      if (typeof entry !== "object" || entry === null) {
        return err(new CliError(`manifest '${path}' must be an object`));
      }
      const entryRecord = entry as Record<string, unknown>;
      const name = entryRecord.name;
      if (typeof name !== "string" || name.length === 0) {
        return err(
          new CliError(`manifest '${path}.name' must be a non-empty string`)
        );
      }
      const external = entryRecord.external;
      if (external !== undefined && typeof external !== "boolean") {
        return err(
          new CliError(`manifest '${path}.external' must be a boolean`)
        );
      }
      resources.push({ kind, name, external: external ?? false });
    }
  }

  return ok(resources);
}
