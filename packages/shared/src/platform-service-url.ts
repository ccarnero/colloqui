const K8S_SUFFIX = "svc.cluster.local";

/**
 * Builds an in-cluster HTTP URL for a platform service in the given environment.
 * @param serviceName - Knative/K8s service name (e.g. "registry-service")
 * @param environment - Platform environment (e.g. "dev", "qa", "production")
 * @returns Full in-cluster URL like `http://registry-service.platform-services-dev.svc.cluster.local`
 */
export function platformServiceUrl(
  serviceName: string,
  environment: string,
): string {
  return `http://${serviceName}.platform-services-${environment}.${K8S_SUFFIX}`;
}
