import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from "class-validator";
import { CronExpressionParser } from "cron-parser";
import { parseSchedule } from "@yoizen/shared";

/**
 * Returns true if the schedule string is a valid platform schedule.
 *
 * Valid values:
 *   "once"           → one-shot job
 *   /^\d+$/          → positive integer of seconds (> 0)
 *   /^interval:\d+$/ → positive integer of minutes (> 0)
 *   anything else    → must be parseable by cron-parser
 */
export function isValidSchedule(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // cron-parser v5 silently treats a falsy/empty expression as "0 * * * * *"
  // instead of throwing, so an empty or whitespace-only string would incorrectly
  // pass the cron branch. Reject it explicitly here; the @Length(1,255) DTO
  // decorator is a second layer of defence but this guard makes the function
  // self-contained.
  if (value.trim() === "") return false;

  const parsed = parseSchedule(value);

  switch (parsed.kind) {
    case "once":
    case "interval":
      return true;

    case "invalid":
      return false;

    case "cron": {
      try {
        CronExpressionParser.parse(parsed.expression);
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Class-validator decorator that validates a schedule field against the
 * canonical platform schedule contract.
 *
 * Accepted formats:
 *   - "once"            (one-shot)
 *   - "3600"            (bare positive integer = seconds)
 *   - "interval:60"     (positive integer = minutes)
 *   - "* /15 * * * *"   (valid cron expression)
 */
export function IsSchedule(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: "isSchedule",
      target: (object as { constructor: Function }).constructor,
      propertyName,
      options: {
        message: (args: ValidationArguments) =>
          `${args.property} must be a valid schedule: "once", a positive integer (seconds), ` +
          `"interval:<positive-integer>" (minutes), or a valid cron expression`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown): boolean {
          return isValidSchedule(value);
        },
      },
    });
  };
}
