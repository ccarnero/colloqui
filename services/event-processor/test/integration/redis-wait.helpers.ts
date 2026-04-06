import type Redis from "ioredis";

/** @returns Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Polls Redis until `key` exists or `timeoutMs` elapses.
 * @param pollMs Interval between GET attempts.
 */
export async function waitForRedisKey(
  redis: Redis,
  key: string,
  timeoutMs = 10_000,
  pollMs = 200,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await redis.get(key);
    if (val !== null) return val;
    await sleep(pollMs);
  }
  return null;
}
