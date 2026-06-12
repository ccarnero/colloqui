/**
 * Canonical schedule format detection for the Yoizen platform.
 *
 * Accepted formats:
 *   "once"           → one-shot job
 *   /^\d+$/          → recurring interval in SECONDS (bare positive integer, > 0)
 *   /^interval:\d+$/ → recurring interval in MINUTES (positive integer, > 0)
 *   anything else    → cron expression candidate (consumers validate with a cron library)
 *
 * Invalid forms that must never fall through to "cron":
 *   interval:abc, interval:, interval:0, "0", interval:5.5, whitespace-only, etc.
 */

export type ParsedSchedule =
  | { kind: "once" }
  | { kind: "interval"; intervalMs: number }
  | { kind: "cron"; expression: string }
  | { kind: "invalid"; reason: string };

/**
 * Parses a schedule string into a typed discriminated union.
 * Trims leading/trailing whitespace before classification.
 *
 * @param schedule - The raw schedule string from storage or input.
 * @returns A ParsedSchedule describing the kind and, for interval, the millisecond duration.
 */
export function parseSchedule(schedule: string): ParsedSchedule {
  const s = schedule.trim();

  if (s === "once") {
    return { kind: "once" };
  }

  // Bare integer → seconds. Must be a positive integer (> 0).
  if (/^\d+$/.test(s)) {
    const seconds = Number(s);
    if (seconds === 0) {
      return { kind: "invalid", reason: `Bare integer schedule must be > 0; got "${s}"` };
    }
    const intervalMs = seconds * 1_000;
    if (!Number.isFinite(intervalMs) || intervalMs > 2_147_483_647) {
      return {
        kind: "invalid",
        reason: `Interval exceeds the ~24.85-day setInterval limit (2,147,483,647 ms); got "${s}" seconds`,
      };
    }
    return { kind: "interval", intervalMs };
  }

  // interval:<digits> → minutes. Must match strictly (no floats, no letters, > 0).
  if (/^interval:/.test(s)) {
    const rest = s.slice("interval:".length);
    if (!/^\d+$/.test(rest)) {
      return {
        kind: "invalid",
        reason: `Malformed interval schedule: expected "interval:<positive-integer>", got "${s}"`,
      };
    }
    const minutes = Number(rest);
    if (minutes === 0) {
      return {
        kind: "invalid",
        reason: `Interval schedule minutes must be > 0; got "${s}"`,
      };
    }
    const intervalMs = minutes * 60_000;
    if (!Number.isFinite(intervalMs) || intervalMs > 2_147_483_647) {
      return {
        kind: "invalid",
        reason: `Interval exceeds the ~24.85-day setInterval limit (2,147,483,647 ms); got "${s}" minutes`,
      };
    }
    return { kind: "interval", intervalMs };
  }

  // Anything else is a cron expression candidate.
  // Consumers are responsible for validating the expression with a cron library.
  return { kind: "cron", expression: s };
}
