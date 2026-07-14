// Result type shared across @yoizen/shared's pure functions. Expected
// failures are returned, never thrown: side effects and framework-specific
// error types stay at each consuming service's edges; this module has none.

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
