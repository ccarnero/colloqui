import { err, ok, type Result } from "../lib/result.js";
import type {
  SecretScope,
  SecretScopeKind,
} from "../resources/secrets/index.js";
import { CliError } from "./cli-error.js";

const VALID_SCOPE_KINDS: readonly SecretScopeKind[] = [
  "channel",
  "connector",
  "agent",
  "service",
  "workflow",
];

/** Parses `secrets put`'s `--scope <kind>:<owner>` into a `SecretScope`. */
export function parseScopeArg(raw: string): Result<SecretScope, CliError> {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    return err(new CliError(`--scope must be '<kind>:<owner>', got '${raw}'`));
  }

  const kind = raw.slice(0, separatorIndex);
  const owner = raw.slice(separatorIndex + 1);

  if (!VALID_SCOPE_KINDS.includes(kind as SecretScopeKind)) {
    return err(
      new CliError(
        `--scope kind must be one of ${VALID_SCOPE_KINDS.join(", ")}, got '${kind}'`
      )
    );
  }

  return ok({ kind: kind as SecretScopeKind, owner });
}
