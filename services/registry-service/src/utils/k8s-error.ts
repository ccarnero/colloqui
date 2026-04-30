/**
 * Extracts human-readable messages from Kubernetes client errors and unknown values.
 */

function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function k8sApiErrorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const msg = (e as { response?: { body?: { message?: string } } }).response
      ?.body?.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return formatUnknownError(e);
}

export function isK8sNotFound(e: unknown): boolean {
  if (typeof e === "object" && e !== null && "response" in e) {
    return (
      (e as { response?: { statusCode?: number } }).response?.statusCode === 404
    );
  }
  return false;
}
