import type { Client } from "../../infrastructure/create-client.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ManifestPlan } from "../../resources/manifests/index.js";
import { CliError } from "../cli-error.js";
import { extractManifestName } from "../extract-manifest-name.js";

export interface PlanCommandDeps {
  client: Pick<Client, "manifests">;
  manifest: Record<string, unknown>;
  log?: (msg: string) => void;
}

/**
 * `yoizen manifests plan -f <file>` — thin wrapper over
 * `client.manifests.put()` (store the revision) then `.plan()` (read-only
 * diff). `plan`/`apply` both operate on the LATEST stored revision for a
 * name (see `resources/manifests/client.ts`), so `put()` must run first —
 * mirrors the order `scripts/e2e/manifest-apply.sh` and
 * `scripts/e2e/manifest-showcase-driver.ts` use (PUT -> plan -> apply).
 */
export async function runPlanCommand({
  client,
  manifest,
  log = () => {},
}: PlanCommandDeps): Promise<Result<ManifestPlan, CliError>> {
  const nameResult = extractManifestName(manifest);
  if (!nameResult.ok) {
    return nameResult;
  }
  const name = nameResult.value;

  log(
    `manifests plan: PUT /provisioning/manifests/${name} (storing revision before planning)`
  );
  try {
    await client.manifests.put(name, manifest);
  } catch (cause) {
    return err(
      new CliError(`manifests plan: failed to store manifest '${name}'`, {
        cause,
      })
    );
  }

  log(`manifests plan: POST /provisioning/manifests/${name}/plan`);
  try {
    const plan = await client.manifests.plan(name);
    log(
      `manifests plan: ${plan.resources.length} resource(s), ${plan.preconditions.length} precondition(s)`
    );
    return ok(plan);
  } catch (cause) {
    return err(
      new CliError(`manifests plan: plan request failed for '${name}'`, {
        cause,
      })
    );
  }
}
