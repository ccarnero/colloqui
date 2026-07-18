import { SdkError } from "../domain/errors.js";

/**
 * Peels a CLI command failure back to the `SdkError` that actually carries
 * the server's response detail. `CliError` (see `cli-error.ts`) wraps the
 * transport-thrown `SdkError` in its `.cause`, so when the passed error is a
 * `CliError` whose `cause` is itself an `SdkError` (the transport error with
 * `details.body`), that inner error is returned. A bare `SdkError` is
 * returned as-is; anything else (a plain `Error` from a network failure, a
 * non-error value) yields `undefined` — the caller then renders no detail
 * rather than guessing.
 */
export function unwrapSdkError(error: unknown): SdkError | undefined {
  if (error instanceof SdkError) {
    if (error.cause instanceof SdkError) {
      return error.cause;
    }
    return error;
  }
  return undefined;
}
