import { fail } from "./fail.js";
import { log, step } from "./logging.js";

/**
 * Wraps one numbered pipeline stage (e.g. `01-telegram-channel`,
 * `05-workflow`) with consistent start/finish/failure logging, so every
 * script in this demo reports its own progress the same way. Adapted from
 * the stage-by-stage logging style in
 * `sdk/samples/http-bridge/src/setup.ts` (`step(...)` before each phase).
 *
 * On failure, logs the stage name and the error message via `fail`, then
 * exits — nothing in this demo fails silently.
 */
export async function runStage<T>(
  name: string,
  work: () => Promise<T>
): Promise<T> {
  step(`start: ${name}`);
  try {
    const result = await work();
    log(`done:  ${name}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`stage failed: ${name} — ${message}`);
  }
}
