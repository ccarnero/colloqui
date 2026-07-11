// to-iso-millis.ts — normalizes a timestamp value (as returned by the
// `postgres` driver, either a JS `Date` for `timestamptz` columns or a
// string) into an ISO-8601 string with millisecond precision.
//
// Bug this fixes (T02 live smoke test, attempt 2): `Date.parse(date)` on a
// `Date` instance coerces the value through `Date.prototype.toString()`
// first, which only carries second precision — milliseconds are silently
// dropped. `Date#toISOString()` always retains milliseconds, so routing
// every input through a real `Date` object and calling `toISOString()`
// keeps ms precision regardless of whether the driver handed us a `Date`
// or an already-ISO string.

export function toIsoMillis(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}
