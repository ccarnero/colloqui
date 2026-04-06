import { mock } from "bun:test";
import type { Sql } from "postgres";

/**
 * Shared postgres.js `Sql` test double for adapter-service unit tests.
 */
export function makeSqlTestDouble(
  impl: (
    strings: TemplateStringsArray,
    values: unknown[],
  ) => Promise<unknown>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) =>
    impl(strings, values);
  return Object.assign(fn, {
    json: (x: never) => x,
    unsafe: mock((_q: string, _p: unknown[]) => Promise.resolve(undefined)),
  }) as Sql;
}
