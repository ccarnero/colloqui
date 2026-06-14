/**
 * Real clock. Injectable so tests can drive time deterministically.
 * @returns {import("../application/ports.js").Clock}
 */
export function createSystemClock() {
  return { now: () => Date.now() };
}
