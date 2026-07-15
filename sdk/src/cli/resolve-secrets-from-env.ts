import { err, ok, type Result } from "../lib/result.js";
import { CliError } from "./cli-error.js";
import type { CliSecretBinding } from "./extract-secret-bindings.js";

export interface ResolvedSecretBinding extends CliSecretBinding {
  value: string;
}

/**
 * `apply --secrets-from-env` (decision 9): resolves each manifest secret
 * binding's VALUE from the identically-named environment variable — no
 * naming transform is applied (no upper-casing, no prefixing) because
 * decision 7 forbids inventing new mechanisms; the binding's `name` field
 * IS the env var name to read.
 *
 * Fails fast, listing ALL missing env vars in one error (never one at a
 * time) so the caller can fix its environment in one pass instead of
 * repeated trial-and-error runs. Values never touch disk or argv — they
 * flow from `env` straight into the returned array, which the apply
 * command passes directly to `client.secrets.set()`.
 */
export function resolveSecretsFromEnv(
  bindings: CliSecretBinding[],
  env: Record<string, string | undefined>
): Result<ResolvedSecretBinding[], CliError> {
  const missing: string[] = [];
  const resolved: ResolvedSecretBinding[] = [];

  for (const binding of bindings) {
    const value = env[binding.name];
    if (value === undefined || value === "") {
      missing.push(binding.name);
      continue;
    }
    resolved.push({ ...binding, value });
  }

  if (missing.length > 0) {
    return err(
      new CliError(
        `--secrets-from-env: missing environment variable(s) for secret binding(s): ${missing.join(", ")}`,
        { details: { missing } }
      )
    );
  }

  return ok(resolved);
}
