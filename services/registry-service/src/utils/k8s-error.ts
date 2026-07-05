/**
 * Extracts human-readable messages from Kubernetes client errors and unknown values.
 */

function formatUnknownError(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

export function k8sApiErrorMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "response" in e) {
    const msg = (e as { response?: { body?: { message?: string } } }).response
      ?.body?.message;
    if (typeof msg === "string" && msg.length > 0) {
      return msg;
    }
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

/**
 * Detects a K8s optimistic-concurrency conflict (HTTP 409), e.g. a
 * `replaceNamespacedCustomObject` call racing Knative's own reconciler.
 *
 * Checks both the legacy `@kubernetes/client-node` error shape
 * (`e.response.statusCode`) used elsewhere in this file, and the
 * `ApiException`-style shape (`e.code`) thrown by the client-node v1.x
 * generated clients, so detection is correct regardless of which
 * client-node major version is installed at runtime.
 */
export function isK8sConflict(e: unknown): boolean {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  if ("response" in e) {
    const statusCode = (e as { response?: { statusCode?: number } }).response
      ?.statusCode;
    if (statusCode === 409) {
      return true;
    }
  }
  if ("code" in e) {
    const code = (e as { code?: number }).code;
    if (code === 409) {
      return true;
    }
  }
  if ("statusCode" in e) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      return true;
    }
  }
  return false;
}
