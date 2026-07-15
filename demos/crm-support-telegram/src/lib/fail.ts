import { err } from "./logging.js";

/**
 * Logs a fatal error and exits the process with a non-zero code. Adapted
 * from `sdk/examples/reference-pattern/src/setup.ts` — every pipeline stage in
 * this demo calls this instead of letting an exception propagate silently.
 */
export function fail(message: string): never {
  err(message);
  process.exit(1);
}
