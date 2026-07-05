import type { Clock } from "../application/ports.js";

/**
 * Real clock. Injectable so tests can drive time deterministically.
 */
export function createSystemClock(): Clock {
  return { now: () => Date.now() };
}
