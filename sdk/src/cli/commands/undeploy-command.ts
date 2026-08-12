import { NotFoundError } from "../../domain/errors.js";
import type { Client } from "../../infrastructure/create-client.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ManifestUndeployResult } from "../../resources/manifests/index.js";
import { CliError } from "../cli-error.js";
import { extractManifestName } from "../extract-manifest-name.js";
import { extractManifestResources } from "../extract-manifest-resources.js";
import type { VerdictRow } from "../format-verdict-table.js";

export interface UndeployCommandDeps {
  client: Pick<Client, "manifests">;
  manifest: Record<string, unknown>;
  log?: (msg: string) => void;
}

/** What `undeploy` would delete, derived from the manifest FILE alone (no server call). */
export interface UndeployPreview {
  name: string;
  rows: VerdictRow[];
}

/**
 * Outcome of a confirmed (`--yes`) run. `already_absent` is a SUCCESS:
 * `POST /manifests/:name/undeploy` answers 404 when nothing is stored under
 * `name`, which is exactly what a SECOND full undeploy sees (a fully
 * successful run deletes the stored record LAST — see
 * `services/provisioning-service/src/modules/undeploy/undeploy.controller.ts`'s
 * header, which mandates that callers render it as "already undeployed"
 * rather than a failure; decision 6 of PENDIENTES/12-undeploy.spec.md).
 */
export type UndeployCommandOutcome =
  | { kind: "undeployed"; name: string; report: ManifestUndeployResult }
  | { kind: "already_absent"; name: string };

/**
 * `yoizen manifests undeploy -f <file>` WITHOUT `--yes`: the dry preview.
 *
 * Reads the manifest's own sections (`extract-manifest-resources.ts`) and
 * turns them into `format-verdict-table.ts` rows — `delete` for the resources
 * the manifest owns, `external (kept)` for the ones it declares
 * `external: true` (never owned, so undeploy never deletes them, decision 4).
 * Calls NOTHING: no plan, no store, no undeploy — the point of the gate is
 * that the destructive verb has not run yet.
 */
export function buildUndeployPreview(
  manifest: Record<string, unknown>
): Result<UndeployPreview, CliError> {
  const nameResult = extractManifestName(manifest);
  if (!nameResult.ok) {
    return nameResult;
  }

  const resourcesResult = extractManifestResources(manifest);
  if (!resourcesResult.ok) {
    return resourcesResult;
  }

  return ok({
    name: nameResult.value,
    rows: resourcesResult.value.map((resource) => ({
      kind: resource.kind,
      name: resource.name,
      verdict: resource.external ? "external (kept)" : "delete",
    })),
  });
}

/**
 * `yoizen manifests undeploy -f <file> --yes`.
 *
 * The manifest FILE is used for ONE thing only: reading `metadata.name`
 * (same read path `plan`/`apply` use). The teardown itself always runs
 * against the STORED manifest server-side — this command deliberately does
 * NOT `put()` the file first (unlike `apply-command.ts`), because storing a
 * fresh revision just to delete it would both mutate state on a teardown and
 * change WHAT gets deleted (the file on disk may declare resources the stored
 * revision never applied, or omit ones it did).
 *
 * A 404 is translated to `already_absent` instead of an error (see
 * `UndeployCommandOutcome`); every other failure is wrapped in a `CliError`
 * whose `cause` is the transport's `SdkError`, so `format-error-detail.ts`
 * can render the typed 409 body (`undeploy_blocked` dependents, a partial
 * run's failing step).
 */
export async function runUndeployCommand({
  client,
  manifest,
  log = () => {},
}: UndeployCommandDeps): Promise<Result<UndeployCommandOutcome, CliError>> {
  const nameResult = extractManifestName(manifest);
  if (!nameResult.ok) {
    return nameResult;
  }
  const name = nameResult.value;

  log(`manifests undeploy: POST /provisioning/manifests/${name}/undeploy`);
  try {
    const report = await client.manifests.undeploy(name);
    log(
      `manifests undeploy: deleted=${String(report.deletedCount)} notFound=${String(report.notFoundCount)} skipped=${String(report.skippedCount)} manifestRecordDeleted=${String(report.manifestRecordDeleted)} durationMs=${String(report.durationMs)}`
    );
    return ok({ kind: "undeployed", name, report });
  } catch (cause) {
    if (cause instanceof NotFoundError) {
      log(
        `manifests undeploy: 404 from the server — nothing stored under '${name}', treating as already undeployed (decision 6)`
      );
      return ok({ kind: "already_absent", name });
    }
    return err(
      new CliError(
        `manifests undeploy: undeploy request failed for '${name}'`,
        {
          cause,
        }
      )
    );
  }
}
