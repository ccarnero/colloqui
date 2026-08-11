import { err, ok, type Result } from "../lib/result.js";
import { CliError } from "./cli-error.js";
import type { CliSecretBinding } from "./extract-secret-bindings.js";

export interface ResolvedSecretBinding extends CliSecretBinding {
  value: string;
}

/** `telegram-bot-token` -> `TELEGRAM_BOT_TOKEN`. */
function upperSnake(name: string): string {
  return name.replace(/-/g, "_").toUpperCase();
}

/**
 * `apply --secrets-from-env`: resolves each manifest secret binding's VALUE
 * from the environment. Lookup order per binding:
 *
 *   1. the exact binding name (`telegram-bot-token`) — wins when set;
 *   2. its UPPER_SNAKE form (`TELEGRAM_BOT_TOKEN`) as a fallback.
 *
 * The exact-name-only behavior was decision 9 of the manifest-gaps round
 * ("no naming transform"); user ruling 2026-08-11 superseded it: POSIX
 * shells cannot `export` hyphenated names, which forced the
 * `env 'name=value' yoizen ...` workaround this fallback retires. An
 * empty-string value counts as unset at BOTH names.
 *
 * Fails fast, listing ALL missing bindings in one error — each with both
 * accepted spellings — so the caller can fix its environment in one pass.
 * `details.missing` stays the plain slug list (stable machine shape).
 * Values never touch disk or argv — they flow from `env` straight into the
 * returned array, which the apply command passes directly to
 * `client.secrets.set()`.
 */
export function resolveSecretsFromEnv(
  bindings: CliSecretBinding[],
  env: Record<string, string | undefined>
): Result<ResolvedSecretBinding[], CliError> {
  const missing: string[] = [];
  const resolved: ResolvedSecretBinding[] = [];

  for (const binding of bindings) {
    const exact = env[binding.name];
    const fallback = env[upperSnake(binding.name)];
    const value = exact !== undefined && exact !== "" ? exact : fallback;
    if (value === undefined || value === "") {
      missing.push(binding.name);
      continue;
    }
    resolved.push({ ...binding, value });
  }

  if (missing.length > 0) {
    const described = missing.map((name) => `${name} (or ${upperSnake(name)})`);
    return err(
      new CliError(
        `--secrets-from-env: missing environment variable(s) for secret binding(s): ${described.join(", ")}`,
        { details: { missing } }
      )
    );
  }

  return ok(resolved);
}
