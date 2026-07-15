import type { Client } from "../../infrastructure/create-client.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { ManifestApplyResult } from "../../resources/manifests/index.js";
import { CliError } from "../cli-error.js";
import { extractManifestName } from "../extract-manifest-name.js";
import { extractSecretBindings } from "../extract-secret-bindings.js";
import { resolveSecretsFromEnv } from "../resolve-secrets-from-env.js";

export interface ApplyCommandDeps {
  client: Pick<Client, "manifests" | "secrets">;
  manifest: Record<string, unknown>;
  /** `--secrets-from-env` (decision 9). */
  secretsFromEnv?: boolean;
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

/**
 * `yoizen manifests apply -f <file> [--secrets-from-env]`.
 *
 * With `--secrets-from-env`: reads the manifest's `spec.secrets` bindings,
 * resolves each VALUE from the identically-named environment variable
 * (failing fast listing ALL missing vars — never one at a time), then puts
 * every secret via `client.secrets.set()` BEFORE storing/applying the
 * manifest — mirrors the bind-then-provision order
 * `scripts/e2e-manifest-showcase-driver.ts` exercises against the real
 * provisioning-service. Secret values travel from `env` straight into
 * `client.secrets.set()` and are never logged, never written to disk,
 * never passed as argv.
 *
 * Then always: `client.manifests.put()` (store the revision) followed by
 * `client.manifests.apply()` (execute the plan in dependency order).
 */
export async function runApplyCommand({
  client,
  manifest,
  secretsFromEnv = false,
  env = process.env,
  log = () => {},
}: ApplyCommandDeps): Promise<Result<ManifestApplyResult, CliError>> {
  const nameResult = extractManifestName(manifest);
  if (!nameResult.ok) {
    return nameResult;
  }
  const name = nameResult.value;

  if (secretsFromEnv) {
    const bindingsResult = extractSecretBindings(manifest);
    if (!bindingsResult.ok) {
      return bindingsResult;
    }
    log(
      `manifests apply --secrets-from-env: found ${bindingsResult.value.length} secret binding(s) in manifest '${name}'`
    );

    const resolvedResult = resolveSecretsFromEnv(bindingsResult.value, env);
    if (!resolvedResult.ok) {
      return resolvedResult;
    }

    for (const binding of resolvedResult.value) {
      log(
        `manifests apply --secrets-from-env: PUT /provisioning/secrets/${binding.name} scope=${binding.scope.kind}:${binding.scope.owner} (value read from env, never logged)`
      );
      try {
        // eslint-disable-next-line no-await-in-loop -- secrets must land before the manifest that references them is applied
        await client.secrets.set(binding.name, binding.value, binding.scope);
      } catch (cause) {
        return err(
          new CliError(
            `manifests apply --secrets-from-env: failed to put secret '${binding.name}'`,
            { cause }
          )
        );
      }
    }
  }

  log(
    `manifests apply: PUT /provisioning/manifests/${name} (storing revision before apply)`
  );
  try {
    await client.manifests.put(name, manifest);
  } catch (cause) {
    return err(
      new CliError(`manifests apply: failed to store manifest '${name}'`, {
        cause,
      })
    );
  }

  log(`manifests apply: POST /provisioning/manifests/${name}/apply`);
  try {
    const result = await client.manifests.apply(name);
    log(
      `manifests apply: appliedCount=${result.appliedCount} noopCount=${result.noopCount} durationMs=${result.durationMs}`
    );
    return ok(result);
  } catch (cause) {
    return err(
      new CliError(`manifests apply: apply request failed for '${name}'`, {
        cause,
      })
    );
  }
}
