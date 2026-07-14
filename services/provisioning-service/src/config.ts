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
    channels:
      process.env.CHANNEL_SERVICE_URL ??
      platformServiceUrl("channel-service", env),
    connectors:
      process.env.CONNECTOR_ADMIN_URL ??
      platformServiceUrl("connector-admin", env),
    agents:
      process.env.AGENT_ADMIN_SERVICE_URL ??
      platformServiceUrl("agent-admin-service", env),
    registry:
      process.env.REGISTRY_SERVICE_URL ??
      platformServiceUrl("registry-service", env),
    workflows:
      process.env.WORKFLOW_SERVICE_URL ??
      platformServiceUrl("workflow-service", env),
  },
};
