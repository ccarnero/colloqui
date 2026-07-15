import { SdkError, type SdkErrorOptions } from "../domain/errors.js";

/**
 * CLI-local failure (bad args, unreadable/invalid manifest file, missing env
 * var for `--secrets-from-env` / `secrets put --value-env`). Extends the
 * SDK's existing `SdkError` taxonomy (`domain/errors.ts`) instead of
 * inventing a parallel error shape — same `{ message, code, cause, details }`
 * contract every other SDK error already carries.
 */
export class CliError extends SdkError {
  constructor(message: string, opts: SdkErrorOptions = {}) {
    super(message, { ...opts, code: opts.code ?? "CLI" });
  }
}
