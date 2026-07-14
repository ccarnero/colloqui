// Result type shared across connector-runtime's pure `src/lib` functions.
// Expected failures are returned, never thrown (SPEC.md code-style contract):
// side effects and framework-specific error types (e.g. Temporal's
// `ApplicationFailure`) stay at the entrypoints; this module has none.

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
