import { VALID_ENVIRONMENTS, type Environment } from "./platform-environment";

/**
 * Kubernetes namespace name for a tenant in a given platform environment.
 * Pattern: `{tenantId}-{environment}-ns`
 */
export function tenantKubernetesNamespaceName(
  tenantId: string,
  environment: Environment | string,
): string {
  return `${tenantId}-${environment}-ns`;
}

/**
 * User-facing message when `PLATFORM_ENVIRONMENT` is not in {@link VALID_ENVIRONMENTS}.
 */
export function invalidPlatformEnvironmentMessage(env: string): string {
  return `Invalid PLATFORM_ENVIRONMENT: '${env}'. Must be one of: ${VALID_ENVIRONMENTS.join(", ")}`;
}
