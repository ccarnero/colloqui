import { platformServiceUrl } from "@yoizen/shared";

const env = process.env.PLATFORM_ENVIRONMENT ?? "dev";

type ProvisioningServiceConfig = {
  readonly port: number;
  /** Base URLs for the existing internal service APIs the T03 resolver reads. */
  readonly downstreamServiceUrls: {
    readonly channels: string;
    readonly connectors: string;
    readonly agents: string;
    readonly registry: string;
    readonly workflows: string;
  };
};

export const provisioningServiceConfig: ProvisioningServiceConfig = {
  get port() {
    return Number.parseInt(process.env.PORT ?? "3000", 10);
  },
  downstreamServiceUrls: {
    // BUG FIX (found during T04): these fallback hostnames must match the
    // REAL Knative/K8s Service names (`knative/services/base/*.yaml`), not
    // the package/env name — channel-service, connector-admin, and
    // workflow-service all ship their API server as a `-api`-suffixed
    // Knative Service (`channel-service-api.yaml`, `connector-admin-api.yaml`,
    // `workflow-service-api.yaml`); there is no plain `channel-service` /
    // `connector-admin` / `workflow-service` k8s Service to resolve. T03's
    // original fallbacks pointed at the non-existent plain names, which
    // would 404/unreachable every `findByName` call (and now every T04
    // apply write) once run against the real cluster. `agent-admin-service`
    // and `registry-service` ARE the real Knative Service names already, so
    // those two fallbacks are unchanged.
    channels:
      process.env.CHANNEL_SERVICE_URL ??
      platformServiceUrl("channel-service-api", env),
    connectors:
      process.env.CONNECTOR_ADMIN_URL ??
      platformServiceUrl("connector-admin-api", env),
    agents:
      process.env.AGENT_ADMIN_SERVICE_URL ??
      platformServiceUrl("agent-admin-service", env),
    registry:
      process.env.REGISTRY_SERVICE_URL ??
      platformServiceUrl("registry-service", env),
    workflows:
      process.env.WORKFLOW_SERVICE_URL ??
      platformServiceUrl("workflow-service-api", env),
  },
};
