/**
 * Checks whether an error thrown by postgres.js is a unique_violation
 * (PG error code 23505). Works with both typed and untyped catch blocks.
 */
export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}
