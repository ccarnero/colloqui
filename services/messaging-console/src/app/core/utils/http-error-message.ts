/**
 * Extracts a user-facing message from Angular HttpClient errors (HttpErrorResponse shape).
 */
export function getHttpErrorMessage(err: unknown, fallback: string): string {
  if (err === null || typeof err !== "object") {
    return fallback;
  }
  const e = err as { error?: unknown; message?: string };
  const nested = e.error;
  if (nested !== null && typeof nested === "object" && "message" in nested) {
    const m = (nested as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) {
      return m;
    }
  }
  if (typeof e.message === "string" && e.message.length > 0) {
    return e.message;
  }
  return fallback;
}
