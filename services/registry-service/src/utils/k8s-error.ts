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

/**
 * Detects a K8s "not found" error (HTTP 404), e.g. deleting a Knative
 * service that is already gone.
 *
 * Checks both the legacy `@kubernetes/client-node` error shape
 * (`e.response.statusCode`) and the `ApiException`-style shape (`e.code`)
 * thrown by the client-node v1.x generated clients (confirmed against
 * v1.4.0's `ApiException` in
 * `node_modules/@kubernetes/client-node/dist/gen/apis/exception.js`, which
 * has no `response` field and instead sets `code`/`body`/`headers`
 * directly), so detection is correct regardless of which client-node
 * major version is installed at runtime.
 */
export function isK8sNotFound(e: unknown): boolean {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  if ("response" in e) {
    const statusCode = (e as { response?: { statusCode?: number } }).response
      ?.statusCode;
    if (statusCode === 404) {
      return true;
    }
  }
  if ("code" in e) {
    const code = (e as { code?: number }).code;
    if (code === 404) {
      return true;
    }
  }
  if ("statusCode" in e) {
    const statusCode = (e as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      return true;
    }
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
