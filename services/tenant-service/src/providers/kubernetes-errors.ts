interface IKubernetesApiErrorShape {
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly body?: {
    readonly code?: unknown;
    readonly reason?: unknown;
  };
  readonly response?: {
    readonly statusCode?: unknown;
    readonly body?: {
      readonly code?: unknown;
      readonly reason?: unknown;
    };
  };
  readonly message?: unknown;
}

function asApiErrorShape(error: unknown): IKubernetesApiErrorShape {
  if (!error || typeof error !== "object") return {};
  return error as IKubernetesApiErrorShape;
}

function isCode(value: unknown, code: number): boolean {
  return value === code || value === String(code);
}

/**
 * Kubernetes client versions expose API failures with different shapes.
 * Keep conflict handling idempotent across in-cluster and unit-test clients.
 */
export function isKubernetesConflictError(error: unknown): boolean {
  const apiError = asApiErrorShape(error);
  if (
    isCode(apiError.code, 409) ||
    isCode(apiError.statusCode, 409) ||
    isCode(apiError.response?.statusCode, 409) ||
    isCode(apiError.body?.code, 409) ||
    isCode(apiError.response?.body?.code, 409)
  ) {
    return true;
  }

  if (
    apiError.body?.reason === "AlreadyExists" ||
    apiError.response?.body?.reason === "AlreadyExists"
  ) {
    return true;
  }

  if (typeof apiError.message !== "string") return false;
  return (
    apiError.message.includes("HTTP-Code: 409") ||
    apiError.message.includes('"code":409') ||
    apiError.message.includes("AlreadyExists")
  );
}

/**
 * Detects 404/NotFound API failures across the Kubernetes client shapes.
 * Used by the namespace recreation flow to know when a terminating namespace
 * has finished tearing down.
 */
export function isKubernetesNotFoundError(error: unknown): boolean {
  const apiError = asApiErrorShape(error);
  if (
    isCode(apiError.code, 404) ||
    isCode(apiError.statusCode, 404) ||
    isCode(apiError.response?.statusCode, 404) ||
    isCode(apiError.body?.code, 404) ||
    isCode(apiError.response?.body?.code, 404)
  ) {
    return true;
  }

  if (
    apiError.body?.reason === "NotFound" ||
    apiError.response?.body?.reason === "NotFound"
  ) {
    return true;
  }

  if (typeof apiError.message !== "string") return false;
  return (
    apiError.message.includes("HTTP-Code: 404") ||
    apiError.message.includes('"code":404') ||
    apiError.message.includes("NotFound")
  );
}
