import type { Client } from "../../infrastructure/create-client.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ManifestValidationResult } from "../../resources/manifests/index.js";
import { CliError } from "../cli-error.js";

export interface ValidateCommandDeps {
  client: Pick<Client, "manifests">;
  manifest: Record<string, unknown>;
  /** Verbose pipeline logging — every stage logs what it did (repo style rule). */
  log?: (msg: string) => void;
}

/**
 * `yoizen manifests validate -f <file>` — thin wrapper over
 * `client.manifests.validate()`. Never mutates anything server-side; the
 * manifest being structurally invalid (`result.valid === false`) is NOT a
 * `Result.error` here (it's the expected "found problems" path) — only
 * transport-level failures (network, auth, 5xx) become `CliError`.
 */
export async function runValidateCommand({
  client,
  manifest,
  log = () => {},
}: ValidateCommandDeps): Promise<Result<ManifestValidationResult, CliError>> {
  log(
    "manifests validate: POST /provisioning/manifests/validate (structural check only, no mutation)"
  );
  try {
    const result = await client.manifests.validate(manifest);
    log(
      `manifests validate: valid=${String(result.valid)} errors=${result.errors.length}`
    );
    return ok(result);
  } catch (cause) {
    return err(new CliError("manifests validate: request failed", { cause }));
  }
}
