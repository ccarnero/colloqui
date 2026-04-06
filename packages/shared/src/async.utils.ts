/**
 * Resolves after `ms` milliseconds. Use for backoff and test timing.
 *
 * @param ms - Delay in milliseconds (non-negative).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
