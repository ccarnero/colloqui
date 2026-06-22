import { formatDate } from "@angular/common";
import { Pipe, type PipeTransform } from "@angular/core";

/**
 * Formats a date value using Angular's formatDate and appends " UTC" to the
 * output, making it clear to the viewer that the timestamp is in UTC.
 *
 * Usage: {{ value | utcDate }}  or  {{ value | utcDate: "short" }}
 */
@Pipe({ name: "utcDate", standalone: true, pure: true })
export class UtcDatePipe implements PipeTransform {
  transform(
    value: Date | string | number | null | undefined,
    format = "medium",
    locale = "en-US"
  ): string | null {
    if (value == null || value === "") {
      return null;
    }
    const result = formatDate(value, format, locale, "UTC");
    return `${result} UTC`;
  }
}
