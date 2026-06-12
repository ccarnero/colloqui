import { CronExpressionParser } from "cron-parser";
import { parseSchedule } from "@yoizen/shared";

/**
 * Computes the next run time for a job based on its schedule string.
 *
 * @param schedule - Schedule string in any supported format.
 * @param from     - Reference point for computation (defaults to now). Accept this
 *                   parameter so callers and tests can pass a fixed date without
 *                   mocking global Date.
 * @returns The next run Date, or null for once/invalid schedules.
 */
export function calculateNextRun(schedule: string, from: Date = new Date()): Date | null {
  const parsed = parseSchedule(schedule);

  switch (parsed.kind) {
    case "once":
      return null;

    case "interval":
      return new Date(from.getTime() + parsed.intervalMs);

    case "cron": {
      try {
        const expression = CronExpressionParser.parse(parsed.expression, {
          currentDate: from,
        });
        return expression.next().toDate();
      } catch {
        // Malformed cron expression stored in DB — return null defensively
        // so existing rows with bad schedules don't crash the repository.
        return null;
      }
    }

    case "invalid":
      return null;
  }
}
