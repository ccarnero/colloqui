/**
 * Generic Result type for the CLI layer (`sdk/src/cli/**`, `manual-loops/samples-reorg.md`
 * T05). The SDK's resource clients (`sdk/src/resources/**`) keep their existing
 * throw-based convention (`SdkError` and subclasses in `domain/errors.ts`) —
 * this file does NOT change that. The CLI's own pure helpers (arg parsing,
 * manifest-file reading, env-var resolution) use `Result` instead of
 * exceptions for their EXPECTED failure paths, then translate any thrown
 * `SdkError` from a resource-client call into a `CliError`-wrapped `Result`
 * at the command boundary (see `sdk/src/cli/cli-error.ts`).
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
