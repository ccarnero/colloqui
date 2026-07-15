import { err, ok, type Result } from "../lib/result.js";
import type {
  SecretScope,
  SecretScopeKind,
} from "../resources/secrets/index.js";
import { CliError } from "./cli-error.js";

/** One `spec.secrets[]` binding read out of a parsed manifest object (name + scope, never a value — manifest v1 never carries secret values). */
export interface CliSecretBinding {
  name: string;
  scope: SecretScope;
}

const VALID_SCOPE_KINDS: readonly SecretScopeKind[] = [
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
];

/**
 * Reads `spec.secrets[]` (name + scope bindings only, per the manifest v1
 * schema — `packages/shared/src/provisioning/manifest.schema.ts`) out of a
 * parsed manifest object. An absent `spec`/`spec.secrets` is not an error —
 * it just means there is nothing to bind for `--secrets-from-env`; a
 * malformed `spec.secrets` entry IS an error (fail fast with a precise
 * path, mirroring the manifest schema's own `.strict()` validation style).
 */
export function extractSecretBindings(
  manifest: Record<string, unknown>
): Result<CliSecretBinding[], CliError> {
  const spec = manifest.spec;
  if (spec === undefined) {
    return ok([]);
  }
  if (typeof spec !== "object" || spec === null) {
    return err(new CliError("manifest 'spec' must be an object"));
  }

  const secrets = (spec as Record<string, unknown>).secrets;
  if (secrets === undefined) {
    return ok([]);
  }
  if (!Array.isArray(secrets)) {
    return err(new CliError("manifest 'spec.secrets' must be an array"));
  }

  const bindings: CliSecretBinding[] = [];
  for (let index = 0; index < secrets.length; index += 1) {
    const entry = secrets[index];
    const path = `spec.secrets[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      return err(new CliError(`manifest '${path}' must be an object`));
    }
    const name = (entry as Record<string, unknown>).name;
    if (typeof name !== "string" || name.length === 0) {
      return err(
        new CliError(`manifest '${path}.name' must be a non-empty string`)
      );
    }
    const scope = (entry as Record<string, unknown>).scope;
    if (typeof scope !== "object" || scope === null) {
      return err(new CliError(`manifest '${path}.scope' must be an object`));
    }
    const kind = (scope as Record<string, unknown>).kind;
    const owner = (scope as Record<string, unknown>).owner;
    if (
      typeof kind !== "string" ||
      !VALID_SCOPE_KINDS.includes(kind as SecretScopeKind)
    ) {
      return err(
        new CliError(
          `manifest '${path}.scope.kind' must be one of ${VALID_SCOPE_KINDS.join(", ")}`
        )
      );
    }
    if (typeof owner !== "string" || owner.length === 0) {
      return err(
        new CliError(
          `manifest '${path}.scope.owner' must be a non-empty string`
        )
      );
    }
    bindings.push({ name, scope: { kind: kind as SecretScopeKind, owner } });
  }

  return ok(bindings);
}
